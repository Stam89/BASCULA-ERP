import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { dinero, notificar } from "./notificaciones.js";

/**
 * CUENTAS ESPEJO ENTRE ACCIONISTAS (socios, Matriz y Transporte y Cosechadora)
 *
 * Varias operaciones crean DOS caras de la misma deuda: una cuenta por cobrar
 * (el que cobra) y una por pagar (el que debe). Un abono en cualquiera de las
 * dos debe reflejarse en la otra, en la caja del otro socio y avisarle con una
 * notificación; si no, los libros se desincronizan.
 *
 * Enlaces conocidos (buscarCuentaHermana):
 *  · pilado_services / lot_transfers / matriz_service_charges /
 *    matriz_packaging_charges → tabla puente con receivable_id + payable_id.
 *  · fomento_cruce / retencion_matriz / saldo_inicial_socio → la CxC y la CxP comparten
 *    reference_type + reference_id (una en cada accionista).
 *  · campo_servicio → la Por Pagar del socio espeja un servicio de Transporte
 *    (su saldo lo mantiene un trigger; ver espejarPagoATransporte).
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Tipos cuya CxC y CxP hermanas comparten reference_type + reference_id. */
const PARES_POR_REFERENCIA = ["fomento_cruce", "retencion_matriz", "saldo_inicial_socio"];

/** Id de la cuenta contraparte (la otra cara de la misma deuda), o null. */
export async function buscarCuentaHermana(
  client: PoolClient,
  desde: "receivable" | "payable",
  cuentaId: string
): Promise<string | null> {
  const puentes =
    desde === "payable"
      ? `SELECT ps.receivable_id AS id FROM pilado_services ps WHERE ps.payable_id = $1
         UNION ALL SELECT lt.receivable_id FROM lot_transfers lt WHERE lt.payable_id = $1
         UNION ALL SELECT msc.receivable_id FROM matriz_service_charges msc WHERE msc.payable_id = $1
         UNION ALL SELECT mpc.receivable_id FROM matriz_packaging_charges mpc WHERE mpc.payable_id = $1`
      : `SELECT ps.payable_id AS id FROM pilado_services ps WHERE ps.receivable_id = $1
         UNION ALL SELECT lt.payable_id FROM lot_transfers lt WHERE lt.receivable_id = $1
         UNION ALL SELECT msc.payable_id FROM matriz_service_charges msc WHERE msc.receivable_id = $1
         UNION ALL SELECT mpc.payable_id FROM matriz_packaging_charges mpc WHERE mpc.receivable_id = $1`;
  const r = await client.query(puentes, [cuentaId]);
  const porPuente = r.rows.find((x) => x.id)?.id;
  if (porPuente) return porPuente;

  // Pares por referencia compartida (misma operación, otro accionista).
  const origen = desde === "payable" ? "accounts_payable" : "accounts_receivable";
  const otra = desde === "payable" ? "accounts_receivable" : "accounts_payable";
  const par = await client.query(
    `SELECT h.id
       FROM ${origen} o
       JOIN ${otra} h ON h.reference_type = o.reference_type AND h.reference_id = o.reference_id
                     AND h.accionista_id IS DISTINCT FROM o.accionista_id
                     AND h.status <> 'CANCELLED'
      WHERE o.id = $1 AND o.reference_type = ANY($2::text[]) AND o.reference_id IS NOT NULL
      ORDER BY h.created_at
      LIMIT 1`,
    [cuentaId, PARES_POR_REFERENCIA]
  );
  return par.rows[0]?.id ?? null;
}

type Resultado = {
  accionista: string;
  cuenta: "por cobrar" | "por pagar" | "Transporte y Cosechadora";
  caja_registrada: boolean;
};

async function nombreAccionista(client: PoolClient, id: string | null | undefined): Promise<string> {
  if (!id) return "el otro accionista";
  return (await client.query("SELECT name FROM accionistas WHERE id = $1", [id])).rows[0]?.name ?? "el otro accionista";
}

/**
 * Refleja un abono en la cuenta contraparte y en la caja del otro accionista, y
 * le envía una notificación. Se llama DENTRO de la transacción del pago original.
 *
 * - Abono en la POR PAGAR  → baja la POR COBRAR hermana + INGRESO en la caja
 *   abierta del que cobra + aviso "X te pagó".
 * - Abono en la POR COBRAR → baja la POR PAGAR hermana + EGRESO en la caja
 *   abierta del que paga + aviso "X registró tu pago".
 * - Por Pagar a Transporte y Cosechadora → registra el cobro en Transporte.
 *
 * Si el otro socio no tiene caja abierta, los saldos igual se espejan (la
 * deuda es un hecho); solo queda sin registrar el movimiento de caja.
 */
export async function espejarAbonoEnContraparte(
  client: PoolClient,
  opts: { desde: "receivable" | "payable"; cuentaId: string; monto: number; descripcion: string }
): Promise<Resultado | null> {
  if (opts.desde === "payable") {
    const ap = await client.query("SELECT reference_type FROM accounts_payable WHERE id = $1", [opts.cuentaId]);
    if (ap.rows[0]?.reference_type === "campo_servicio") {
      await espejarPagoATransporte(client, opts.cuentaId, opts.monto);
      return { accionista: "Transporte y Cosechadora", cuenta: "Transporte y Cosechadora", caja_registrada: true };
    }
  }

  const hermanaId = await buscarCuentaHermana(client, opts.desde, opts.cuentaId);
  if (!hermanaId) return null; // cuenta sin contraparte (venta, liquidación…)

  const tabla = opts.desde === "payable" ? "accounts_receivable" : "accounts_payable";
  const tablaOrigen = opts.desde === "payable" ? "accounts_payable" : "accounts_receivable";
  const cuenta = await client.query(
    `SELECT id, balance, accionista_id, description FROM ${tabla} WHERE id = $1 FOR UPDATE`,
    [hermanaId]
  );
  if (!cuenta.rowCount) return null;
  const actorId = (await client.query(`SELECT accionista_id FROM ${tablaOrigen} WHERE id = $1`, [opts.cuentaId])).rows[0]?.accionista_id;

  const saldo = Number(cuenta.rows[0].balance);
  const abono = Math.min(saldo, round2(opts.monto));
  const nuevoSaldo = round2(saldo - abono);
  await client.query(
    `UPDATE ${tabla} SET balance = $2, status = $3 WHERE id = $1`,
    [hermanaId, nuevoSaldo, nuevoSaldo < 0.01 ? "PAID" : "PARTIAL"]
  );

  const duenoId = cuenta.rows[0].accionista_id;
  const dueno = await nombreAccionista(client, duenoId);

  // La caja abierta del otro socio (efectivo primero). Puede no haber.
  const caja = await client.query(
    `SELECT id FROM cash_registers
     WHERE accionista_id = $1 AND status = 'OPEN'
     ORDER BY (tipo = 'EFECTIVO') DESC, opened_at DESC
     LIMIT 1`,
    [duenoId]
  );

  let cajaRegistrada = false;
  if (caja.rowCount && abono > 0) {
    await client.query(
      `INSERT INTO cash_movements
       (cash_register_id, movement, category, reference_type, reference_id, amount, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        caja.rows[0].id,
        opts.desde === "payable" ? "INCOME" : "EXPENSE",
        opts.desde === "payable" ? "COBRO_ENTRE_SOCIOS" : "PAGO_ENTRE_SOCIOS",
        tabla,
        hermanaId,
        abono,
        opts.descripcion
      ]
    );
    cajaRegistrada = true;
  }

  if (abono > 0) {
    const actor = await nombreAccionista(client, actorId);
    const concepto = cuenta.rows[0].description ? ` · ${cuenta.rows[0].description}` : "";
    await notificar(client, opts.desde === "receivable"
      ? {
        accionistaId: duenoId,
        titulo: `${actor} registró tu pago`,
        mensaje: `${actor} registró un cobro de ${dinero(abono)}${concepto}. Tu Por Pagar quedó en ${dinero(nuevoSaldo)}${cajaRegistrada ? " y se descontó de tu caja abierta" : " (no tenías caja abierta: registra el egreso si salió dinero)"}.`,
        monto: abono, referenciaTipo: "accounts_payable", referenciaId: hermanaId
      }
      : {
        accionistaId: duenoId,
        tipo: "PAGO",
        titulo: `${actor} te pagó`,
        mensaje: `${actor} registró un pago de ${dinero(abono)}${concepto}. Tu Por Cobrar quedó en ${dinero(nuevoSaldo)}${cajaRegistrada ? " y entró a tu caja abierta" : " (no tenías caja abierta: registra el ingreso)"}.`,
        monto: abono, referenciaTipo: "accounts_receivable", referenciaId: hermanaId
      });
  }

  return {
    accionista: dueno,
    cuenta: opts.desde === "payable" ? "por cobrar" : "por pagar",
    caja_registrada: cajaRegistrada
  };
}

/**
 * Baja la POR PAGAR hermana de una CxC SIN mover caja (cruce pagado con
 * producto) y avisa al que debía. Devuelve el id de la hermana, si había.
 */
export async function bajarPayableHermanaSinCaja(client: PoolClient, receivableId: string, abono: number, motivo: string): Promise<string | null> {
  if (abono <= 0) return null;
  const hermanaId = await buscarCuentaHermana(client, "receivable", receivableId);
  if (!hermanaId) return null;
  const ap = await client.query("SELECT balance, accionista_id, description FROM accounts_payable WHERE id = $1 FOR UPDATE", [hermanaId]);
  if (!ap.rowCount) return null;
  const saldo = Number(ap.rows[0].balance);
  const baja = Math.min(saldo, round2(abono));
  const nuevo = round2(saldo - baja);
  await client.query("UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1", [hermanaId, nuevo, nuevo < 0.01 ? "PAID" : "PARTIAL"]);
  if (baja > 0) {
    const actorId = (await client.query("SELECT accionista_id FROM accounts_receivable WHERE id = $1", [receivableId])).rows[0]?.accionista_id;
    const actor = await nombreAccionista(client, actorId);
    await notificar(client, {
      accionistaId: ap.rows[0].accionista_id,
      titulo: `${actor} aplicó un cruce a tu deuda`,
      mensaje: `${actor} registró ${dinero(baja)} por ${motivo}${ap.rows[0].description ? ` · ${ap.rows[0].description}` : ""}. Tu Por Pagar quedó en ${dinero(nuevo)} (sin movimiento de caja).`,
      monto: baja, referenciaTipo: "accounts_payable", referenciaId: hermanaId
    });
  }
  return hermanaId;
}

/**
 * El socio paga desde su POR PAGAR una deuda con Transporte y Cosechadora: el
 * cobro se registra en la CAJA de Transporte contra el servicio (su CxC). El
 * trigger de campo_movimientos re-sincroniza el saldo; la marca de sesión
 * 'bascula.origen_pago = erp' evita que el trigger vuelva a sacar el dinero de
 * la caja del socio (ya lo hizo el pago del ERP).
 */
export async function espejarPagoATransporte(client: PoolClient, payableId: string, monto: number): Promise<void> {
  const ap = (await client.query(
    "SELECT reference_id, description FROM accounts_payable WHERE id = $1",
    [payableId]
  )).rows[0];
  if (!ap?.reference_id) return;
  const serv = (await client.query(
    `SELECT s.id, s.cliente_id, v.saldo_pendiente::float AS saldo
       FROM campo_servicios s JOIN campo_servicios_saldo v ON v.id = s.id
      WHERE s.id = $1 FOR UPDATE OF s`,
    [ap.reference_id]
  )).rows[0];
  if (!serv) throw new ApiError(404, "El servicio de Transporte de esta cuenta ya no existe.");
  const abono = round2(Math.min(monto, Number(serv.saldo)));
  if (!(abono > 0)) return;
  const caja = (await client.query("SELECT id FROM campo_cuentas WHERE nombre = 'CAJA' LIMIT 1")).rows[0]?.id;
  if (!caja) throw new ApiError(409, "Transporte y Cosechadora no tiene la cuenta CAJA configurada.");
  const sesion = await client.query("SELECT 1 FROM campo_caja_sesiones WHERE estado = 'ABIERTA' LIMIT 1");
  if (!sesion.rowCount) {
    throw new ApiError(409, "La caja de Transporte y Cosechadora está cerrada: ábrela para recibir este pago.");
  }
  // La marca es LOCAL a la transacción; si algo falla, todo se revierte igual.
  await client.query("SELECT set_config('bascula.origen_pago', 'erp', true)");
  await client.query(
    `INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, servicio_id, cliente_id)
     VALUES (CURRENT_DATE, $1, 'entrada', $2, $3, $4, $5)`,
    [caja, abono, `Pago recibido desde Por Pagar del socio · ${ap.description ?? "flete/cosecha"}`, serv.id, serv.cliente_id]
  );
  await client.query("SELECT set_config('bascula.origen_pago', '', true)");
}
