import type { PoolClient } from "pg";
import type { Request as ExpressRequest } from "express";
import { ApiError } from "../http/error-handler.js";
import { avisarSobregiro } from "./caja.js";
import { deudasDe } from "./cruce-socios.js";
import { deshacerCrucesYDeuda } from "./cuentas-vinculadas.js";
import { dinero, notificar } from "./notificaciones.js";

/**
 * 🤝 CUENTAS ENTRE SOCIOS (pedido del dueño 2026-10-21: «este enredo es el que no me deja utilizar la caja»).
 * La Matriz y los socios se pagan cosas y se prestan dinero. Cada movimiento se anota UNA vez y:
 *  · lo que A paga POR B (una deuda o un gasto de B) o le DA a B primero BAJA lo que A le debía a B — cualquier deuda
 *    entre los dos (saldo inicial, cobros, préstamos…), de la más vieja a la más nueva — sin mover más caja;
 *  · lo que pase de eso queda como deuda de B con A ('pago_por_socio', reference_id = el egreso de A).
 * Las deudas por concepto (pilada, sacos, selección…) NO se cruzan solas: eso es el botón «Cruzar» (cruce-socios.ts).
 * Cada descuento queda en cruces_entre_socios con el egreso, para deshacerlo al anular (deshacerCrucesYDeuda).
 */

type Db = Pick<PoolClient, "query">;
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Reparte un monto entre deudas (en su orden) sin pasarse de cada saldo. Lógica pura (con pruebas). */
export function repartirEnOrden(saldos: number[], monto: number): { partes: number[]; resto: number } {
  let falta = r2(monto);
  const partes = saldos.map((s) => {
    const m = falta > 0.005 ? r2(Math.min(falta, Math.max(0, Number(s)))) : 0;
    falta = r2(falta - m);
    return m;
  });
  return { partes, resto: Math.max(0, falta) };
}

/** Saldo único de un par: > 0 = A le debe a B; < 0 = B le debe a A. Lógica pura (con pruebas). */
export function saldoUnico(aDebeB: number, bDebeA: number): number {
  return r2(Number(aDebeB) - Number(bDebeA));
}

async function bajarSaldo(client: Db, tabla: "accounts_payable" | "accounts_receivable", id: string, monto: number) {
  const c = (await client.query(`SELECT balance::float AS b FROM ${tabla} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  const nuevo = r2(Number(c?.b ?? 0) - monto);
  if (!c || nuevo < -0.005) throw new ApiError(409, "Una cuenta entre socios cambió mientras se registraba: vuelve a intentarlo.");
  await client.query(`UPDATE ${tabla} SET balance = $2, status = $3 WHERE id = $1`, [id, Math.max(0, nuevo), nuevo < 0.01 ? "PAID" : "PARTIAL"]);
}

/**
 * Lo que `deudorId` paga o da a `acreedorId` (movimiento `movimientoId`): baja primero lo que le debía (las dos caras
 * de cada deuda, la más vieja primero) y devuelve cuánto se descontó y cuánto sobra. Va DENTRO de la transacción.
 */
export async function bajarDeudasDe(client: PoolClient, o: { movimientoId: string; deudorId: string; acreedorId: string; monto: number }):
  Promise<{ descontado: number; resto: number }> {
  const deudas = await deudasDe(client, o.deudorId, o.acreedorId, true);
  const { partes, resto } = repartirEnOrden(deudas.map((d) => d.saldo), o.monto);
  let descontado = 0;
  for (let i = 0; i < deudas.length; i++) {
    const m = partes[i];
    if (m <= 0.005) continue;
    const d = deudas[i];
    await bajarSaldo(client, "accounts_payable", d.id, m);
    await bajarSaldo(client, "accounts_receivable", d.hermana_id, m);
    await client.query(
      "INSERT INTO cruces_entre_socios (cash_movement_id, payable_id, receivable_id, monto) VALUES ($1, $2, $3, $4)",
      [o.movimientoId, d.id, d.hermana_id, m]
    );
    descontado = r2(descontado + m);
  }
  return { descontado, resto };
}

/** Deuda nueva entre dos accionistas (las dos caras), nacida del movimiento `movimientoId`. */
export async function crearDeudaEntreSocios(client: Db, o: {
  movimientoId: string; deudorId: string; acreedorId: string; monto: number; descDeudor: string; descAcreedor: string;
}): Promise<void> {
  if (o.monto <= 0.005) return;
  await client.query(
    `INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status)
     VALUES ($1, 'pago_por_socio', $2, $3, $4, $4, 'CONFIRMED')`,
    [o.deudorId, o.movimientoId, o.descDeudor, r2(o.monto)]
  );
  await client.query(
    `INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status)
     VALUES ($1, 'pago_por_socio', $2, $3, $4, $4, 'CONFIRMED')`,
    [o.acreedorId, o.movimientoId, o.descAcreedor, r2(o.monto)]
  );
}

type Acc = { id: string; name: string; tipo: string };
async function accionista(client: Db, id: string): Promise<Acc> {
  const a = (await client.query("SELECT id, name, tipo FROM accionistas WHERE id = $1 AND is_active = true", [id])).rows[0];
  if (!a) throw new ApiError(404, "Ese socio no existe o está inactivo.");
  return a as Acc;
}
async function cajaAbierta(client: Db, acc: Acc, para: "sale" | "entra"): Promise<{ id: string }> {
  const c = (await client.query(
    "SELECT id FROM cash_registers WHERE accionista_id = $1 AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE", [acc.id]
  )).rows[0];
  if (!c) throw new ApiError(409, `${acc.name} no tiene la caja abierta: ábrela para registrar el dinero que ${para === "sale" ? "sale de" : "entra a"} su caja.`);
  return c;
}

/**
 * 💵 `de` le da dinero a `para` (abono a lo que le debe o préstamo). Se anota UNA vez y mueve las DOS cajas (el medio
 * —efectivo o banco— lo pone el disparador con app.medio_pago de la petición). Primero baja lo que `de` le debía a
 * `para`; lo que pase queda como deuda de `para` con `de` (préstamo).
 */
export async function registrarDineroEntreSocios(client: PoolClient, req: Pick<ExpressRequest, "headers">, o: {
  deId: string; paraId: string; monto: number; nota?: string | null; userId: string | null; actorId: string | null;
}) {
  if (o.deId === o.paraId) throw new ApiError(400, "Elige dos socios distintos.");
  const monto = r2(o.monto);
  if (!(monto > 0)) throw new ApiError(400, "El monto debe ser mayor a 0.");
  const de = await accionista(client, o.deId);
  const para = await accionista(client, o.paraId);
  const cajaDe = await cajaAbierta(client, de, "sale");
  const cajaPara = await cajaAbierta(client, para, "entra");
  await avisarSobregiro(client, cajaDe.id, monto, req);
  const nota = o.nota?.trim() ? ` · ${o.nota.trim()}` : "";

  const id = (await client.query(
    `INSERT INTO dinero_entre_socios (de_id, para_id, monto, medio, nota, created_by)
     VALUES ($1, $2, $3, current_setting('app.medio_pago', true), $4, $5) RETURNING id`,
    [de.id, para.id, monto, o.nota?.trim() || null, o.userId]
  )).rows[0].id as string;
  const movDe = (await client.query(
    `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
     VALUES ($1, 'EXPENSE', 'PAGO_ENTRE_SOCIOS', 'dinero_entre_socios', $2, $3, $4, $5) RETURNING id`,
    [cajaDe.id, id, monto, `Dinero a ${para.name}${nota}`, o.userId]
  )).rows[0].id as string;
  const movPara = (await client.query(
    `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
     VALUES ($1, 'INCOME', 'COBRO_ENTRE_SOCIOS', 'dinero_entre_socios', $2, $3, $4, $5) RETURNING id`,
    [cajaPara.id, id, monto, `Dinero de ${de.name}${nota}`, o.userId]
  )).rows[0].id as string;

  const { descontado, resto } = await bajarDeudasDe(client, { movimientoId: movDe, deudorId: de.id, acreedorId: para.id, monto });
  await crearDeudaEntreSocios(client, {
    movimientoId: movDe, deudorId: para.id, acreedorId: de.id, monto: resto,
    descDeudor: `${de.name} te dio dinero (préstamo)${nota}`,
    descAcreedor: `Le diste dinero a ${para.name} (préstamo)${nota}`
  });
  await client.query(
    "UPDATE dinero_entre_socios SET mov_de_id = $2, mov_para_id = $3, descontado = $4, prestamo = $5 WHERE id = $1",
    [id, movDe, movPara, descontado, resto]
  );

  const detalle = (quien: "de" | "para") => [
    descontado > 0 ? (quien === "de" ? ` Bajó ${dinero(descontado)} de lo que le debías a ${para.name}.` : ` Bajó ${dinero(descontado)} de lo que ${de.name} te debía.`) : "",
    resto > 0.005 ? (quien === "de" ? ` ${dinero(resto)} quedan como préstamo: ${para.name} te los debe (Por Cobrar).` : ` ${dinero(resto)} quedan como préstamo: se los debes a ${de.name} (Por Pagar).`) : ""
  ].join("");
  for (const [aviso, quien] of [[para, "para"], [de, "de"]] as const) {
    if (aviso.id === o.actorId) continue;
    await notificar(client, {
      accionistaId: aviso.id, tipo: "PAGO",
      titulo: quien === "para" ? `${de.name} te dio dinero` : `Le diste dinero a ${para.name}`,
      mensaje: (quien === "para" ? `Entraron ${dinero(monto)} de ${de.name} a tu caja.` : `Salieron ${dinero(monto)} de tu caja para ${para.name}.`) + detalle(quien),
      monto, referenciaTipo: "dinero_entre_socios", referenciaId: id
    });
  }
  return { id, de: de.name, para: para.name, monto, descontado, prestamo: resto };
}

/**
 * Anula un «dinero entre socios»: devuelve lo descontado, anula el préstamo (si no tiene abonos) y pone el
 * contra-asiento en las cajas cuyo movimiento sigue vivo (la de origen ya puede venir anulada desde Caja).
 */
export async function anularDineroEntreSocios(client: PoolClient, o: { id: string; motivo: string; userId: string | null }) {
  const d = (await client.query("SELECT * FROM dinero_entre_socios WHERE id = $1 FOR UPDATE", [o.id])).rows[0];
  if (!d) throw new ApiError(404, "Ese movimiento entre socios no existe.");
  if (d.anulado_at) throw new ApiError(409, "Ese movimiento entre socios ya está anulado.");
  if (d.mov_de_id) await deshacerCrucesYDeuda(client, d.mov_de_id);
  for (const movId of [d.mov_de_id, d.mov_para_id].filter(Boolean) as string[]) {
    const m = (await client.query("SELECT * FROM cash_movements WHERE id = $1 FOR UPDATE", [movId])).rows[0];
    if (!m || m.reversed_at) continue;
    const caja = (await client.query("SELECT id, status, accionista_id FROM cash_registers WHERE id = $1", [m.cash_register_id])).rows[0];
    let destino = m.cash_register_id as string;
    if (caja?.status !== "OPEN") {
      const abierta = (await client.query(
        "SELECT id FROM cash_registers WHERE accionista_id = $1 AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1", [caja?.accionista_id ?? null]
      )).rows[0];
      if (!abierta) throw new ApiError(409, "Una de las dos cajas ya se cerró y no hay otra abierta: abre la caja de hoy para anular.");
      destino = abierta.id;
    }
    await client.query(
      `INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, reference_type, reference_id, reversal_of, created_by, medio)
       VALUES ($1, $2, $3, $4, $5, 'reversal', $6, $6, $7, $8)`,
      [destino, m.movement === "INCOME" ? "EXPENSE" : "INCOME", m.category, m.amount, `Anulación: ${o.motivo} (dinero entre socios)`, m.id, o.userId, m.medio]
    );
    await client.query("UPDATE cash_movements SET reversed_at = now(), reversed_by = $2, reversed_reason = $3 WHERE id = $1", [m.id, o.userId, o.motivo]);
  }
  await client.query("UPDATE dinero_entre_socios SET anulado_at = now(), anulado_motivo = $2 WHERE id = $1", [o.id, o.motivo]);
  const nombres = (await client.query("SELECT id, name FROM accionistas WHERE id = ANY($1::uuid[])", [[d.de_id, d.para_id]])).rows as Array<{ id: string; name: string }>;
  const n = (id: string) => nombres.find((x) => x.id === id)?.name ?? "el socio";
  for (const quien of [d.de_id, d.para_id]) {
    await notificar(client, {
      accionistaId: quien,
      titulo: "Se anuló un dinero entre socios",
      mensaje: `Se anuló el dinero de ${dinero(Number(d.monto))} de ${n(d.de_id)} a ${n(d.para_id)} (${o.motivo}). Las cajas y las deudas vuelven a como estaban.`,
      monto: Number(d.monto), referenciaTipo: "dinero_entre_socios", referenciaId: o.id
    });
  }
}

// Concepto legible de cada tipo de deuda entre socios.
const CONCEPTOS: Record<string, string> = {
  saldo_inicial_socio: "Saldo inicial",
  pilado_service: "Servicio de pilada",
  packaging_charge: "Sacos",
  service_charge: "Servicios (secado, flete…)",
  lot_transfer: "Traspaso de lote",
  retencion_matriz: "Retención de báscula",
  fomento_cruce: "Fomentos cruzados",
  compra_producto_socio: "Producto que se quedó",
  cobro_por_socio: "Cobros que recibió por el otro",
  pago_por_socio: "Pagos por su cuenta y préstamos"
};
export const conceptoDeuda = (referenceType: string | null) => CONCEPTOS[String(referenceType ?? "")] ?? "Otros";

export type LadoCuenta = { total: number; conceptos: Array<{ concepto: string; monto: number; cuentas: number }> };
export type ParCuenta = { a: Acc; b: Acc; a_debe_b: LadoCuenta; b_debe_a: LadoCuenta; saldo: number; cruzable: number };

/**
 * Lo que se deben los accionistas entre sí (Por Cobrar vivas cuya otra cara es de otro accionista), por pareja y por
 * concepto. `visibles` = accionistas que el usuario puede ver (las parejas fuera de eso no salen).
 */
export async function resumenCuentasEntreSocios(db: Db, visibles: string[]): Promise<ParCuenta[]> {
  const accs = (await db.query(
    "SELECT id, name, tipo FROM accionistas WHERE is_active = true AND id = ANY($1::uuid[]) ORDER BY (tipo = 'MATRIZ') DESC, name",
    [visibles]
  )).rows as Acc[];
  const filas = (await db.query(
    `SELECT ar.accionista_id AS acreedor_id,
            COALESCE(par.accionista_id, lt.to_accionista_id, ps.client_accionista_id, msc.client_accionista_id, mpc.client_accionista_id, liq_ret.accionista_id) AS deudor_id,
            ar.reference_type, count(*)::int AS cuentas, round(sum(ar.balance)::numeric, 2)::float AS saldo
       FROM accounts_receivable ar
       LEFT JOIN lot_transfers lt ON lt.receivable_id = ar.id
       LEFT JOIN pilado_services ps ON ps.receivable_id = ar.id
       LEFT JOIN matriz_service_charges msc ON msc.receivable_id = ar.id
       LEFT JOIN matriz_packaging_charges mpc ON mpc.receivable_id = ar.id
       LEFT JOIN liquidations liq_ret ON ar.reference_type = 'retencion_matriz' AND liq_ret.id = ar.reference_id
       LEFT JOIN LATERAL (SELECT h.accionista_id FROM accounts_payable h
                           WHERE h.reference_type = ar.reference_type AND h.reference_id = ar.reference_id
                             AND h.accionista_id IS DISTINCT FROM ar.accionista_id AND h.status <> 'CANCELLED' LIMIT 1) par ON true
      WHERE ar.status IN ('CONFIRMED', 'PARTIAL') AND ar.balance > 0.005
        AND COALESCE(ar.reference_type, '') <> 'campo_servicio'
      GROUP BY 1, 2, 3`
  )).rows as Array<{ acreedor_id: string; deudor_id: string | null; reference_type: string | null; cuentas: number; saldo: number }>;

  const lado = (deudor: string, acreedor: string): LadoCuenta => {
    const mias = filas.filter((f) => f.deudor_id === deudor && f.acreedor_id === acreedor);
    const porConcepto = new Map<string, { monto: number; cuentas: number }>();
    for (const f of mias) {
      const c = conceptoDeuda(f.reference_type);
      const x = porConcepto.get(c) ?? { monto: 0, cuentas: 0 };
      porConcepto.set(c, { monto: r2(x.monto + Number(f.saldo)), cuentas: x.cuentas + Number(f.cuentas) });
    }
    const conceptos = [...porConcepto.entries()].map(([concepto, v]) => ({ concepto, ...v })).sort((x, y) => y.monto - x.monto);
    return { total: r2(conceptos.reduce((s, c) => s + c.monto, 0)), conceptos };
  };
  const out: ParCuenta[] = [];
  for (let i = 0; i < accs.length; i++) {
    for (let j = i + 1; j < accs.length; j++) {
      const a = accs[i], b = accs[j];
      const a_debe_b = lado(a.id, b.id), b_debe_a = lado(b.id, a.id);
      out.push({ a, b, a_debe_b, b_debe_a, saldo: saldoUnico(a_debe_b.total, b_debe_a.total), cruzable: r2(Math.min(a_debe_b.total, b_debe_a.total)) });
    }
  }
  return out;
}

/** Últimos movimientos entre dos accionistas: dinero, pagos y gastos por su cuenta, y cruces. */
export async function historialEntreSocios(db: Db, aId: string, bId: string) {
  const dineros = (await db.query(
    `SELECT d.id, 'dinero' AS tipo, d.created_at AS fecha, d.monto::float AS monto, d.descontado::float AS descontado,
            d.prestamo::float AS prestamo, d.nota, d.anulado_at, de.name AS de, pa.name AS para
       FROM dinero_entre_socios d JOIN accionistas de ON de.id = d.de_id JOIN accionistas pa ON pa.id = d.para_id
      WHERE (d.de_id = $1 AND d.para_id = $2) OR (d.de_id = $2 AND d.para_id = $1)
      ORDER BY d.created_at DESC LIMIT 40`, [aId, bId]
  )).rows;
  const pagos = (await db.query(
    `SELECT cm.id, CASE WHEN cm.category = 'GASTO_POR_SOCIO' THEN 'gasto' ELSE 'pago' END AS tipo, cm.created_at AS fecha,
            cm.amount::float AS monto, cm.description AS nota, cm.reversed_at AS anulado_at, pg.name AS de, so.name AS para,
            COALESCE((SELECT sum(c.monto) FROM cruces_entre_socios c WHERE c.cash_movement_id = cm.id AND c.anulado_at IS NULL), 0)::float AS descontado
       FROM cash_movements cm
       JOIN cash_registers cr ON cr.id = cm.cash_register_id
       JOIN accionistas pg ON pg.id = cr.accionista_id
       LEFT JOIN accounts_payable ap ON cm.category = 'PAGO_POR_SOCIO' AND ap.id = cm.reference_id
       JOIN accionistas so ON so.id = COALESCE(cm.por_cuenta_de, ap.accionista_id)
      WHERE cm.category IN ('PAGO_POR_SOCIO', 'GASTO_POR_SOCIO') AND cm.reversal_of IS NULL
        AND ((cr.accionista_id = $1 AND so.id = $2) OR (cr.accionista_id = $2 AND so.id = $1))
      ORDER BY cm.created_at DESC LIMIT 40`, [aId, bId]
  )).rows;
  const cruces = (await db.query(
    `SELECT c.id, 'cruce' AS tipo, c.created_at AS fecha, c.monto::float AS monto, c.nota, c.anulado_at, x.name AS de, y.name AS para
       FROM cruces_cuentas_socios c JOIN accionistas x ON x.id = c.accionista_id JOIN accionistas y ON y.id = c.contraparte_id
      WHERE (c.accionista_id = $1 AND c.contraparte_id = $2) OR (c.accionista_id = $2 AND c.contraparte_id = $1)
      ORDER BY c.created_at DESC LIMIT 40`, [aId, bId]
  )).rows;
  return [...dineros, ...pagos, ...cruces]
    .sort((x, y) => new Date(y.fecha).getTime() - new Date(x.fecha).getTime())
    .slice(0, 60);
}

