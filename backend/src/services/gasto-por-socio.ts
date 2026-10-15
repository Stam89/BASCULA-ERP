import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { round2 } from "../utils/rice-formulas.js";
import { dinero, notificar } from "./notificaciones.js";

/**
 * GASTO DE UN SOCIO PAGADO CON LA CAJA DE LA MATRIZ (Caja › «¿De quién es este gasto?», pedido del dueño 2026-10-15).
 * Ej.: la caja de CEYRO paga el diésel de ROVINSON. La plata sale de la caja de CEYRO, pero el gasto es de ROVINSON:
 *  · Caja de CEYRO: egreso GASTO_POR_SOCIO (no es costo suyo), con por_cuenta_de = el socio y la categoría real
 *    (categoria_por_cuenta) para que el gasto aparezca en los informes del socio.
 *  · Primero se DESCUENTA de lo que CEYRO ya le debía a ese socio (cuentas entre socios por referencia), sin mover
 *    más caja; cada descuento queda en cruces_entre_socios para deshacerlo al anular.
 *  · Lo que pase queda como deuda del socio con CEYRO ('pago_por_socio', reference_id = el egreso).
 * Anular el egreso en Caja lo deshace todo (anularPagoPorSocio).
 */

// Cuentas cuya Por Cobrar y Por Pagar comparten reference_type + reference_id (ver cuentas-vinculadas.ts).
const PARES = ["fomento_cruce", "retencion_matriz", "saldo_inicial_socio", "compra_producto_socio", "cobro_por_socio", "pago_por_socio"];

type Db = { query: PoolClient["query"] };

const DEUDAS_SQL = `
  SELECT p.id AS pid, p.balance::float AS pb, r.id AS rid, r.balance::float AS rb
    FROM accounts_payable p
    JOIN accounts_receivable r ON r.reference_type = p.reference_type AND r.reference_id = p.reference_id
   WHERE p.reference_type = ANY($3::text[]) AND p.accionista_id = $1 AND r.accionista_id = $2
     AND p.status IN ('CONFIRMED', 'PARTIAL') AND r.status IN ('CONFIRMED', 'PARTIAL')
     AND p.balance > 0.005 AND r.balance > 0.005
   ORDER BY p.created_at, p.id`;

/** Cuánto le debe hoy el que paga (la Matriz) a ese socio: se descontará del gasto. */
export async function cuantoLeDebeAlSocio(db: Db, pagadorId: string, socioId: string): Promise<number> {
  const rows = (await db.query(DEUDAS_SQL, [pagadorId, socioId, PARES])).rows as Array<{ pb: number; rb: number }>;
  return round2(rows.reduce((s, d) => s + Math.min(Number(d.pb), Number(d.rb)), 0));
}

export async function validarSocioDelGasto(client: Db, pagadorId: string, socioId: string): Promise<{ id: string; name: string }> {
  if (socioId === pagadorId) throw new ApiError(400, "El gasto es de esta misma caja: no elijas otro socio.");
  const s = (await client.query("SELECT id, name, tipo FROM accionistas WHERE id = $1 AND is_active = true", [socioId])).rows[0];
  if (!s) throw new ApiError(404, "Ese socio no existe o está inactivo.");
  if (s.tipo === "MATRIZ") throw new ApiError(400, "Elige un socio (no la Matriz).");
  return { id: s.id, name: s.name };
}

/**
 * Después de insertar el egreso GASTO_POR_SOCIO: descuenta de lo que el pagador le debía al socio y deja el resto
 * como deuda del socio. Va DENTRO de la transacción del egreso.
 */
export async function cruzarGastoPorSocio(client: PoolClient, o: {
  movimientoId: string; pagadorId: string; socio: { id: string; name: string }; monto: number; concepto: string;
}): Promise<{ descontado: number; por_cobrar: number }> {
  const pagador = (await client.query("SELECT name FROM accionistas WHERE id = $1", [o.pagadorId])).rows[0]?.name ?? "la Matriz";
  const deudas = (await client.query(DEUDAS_SQL + " FOR UPDATE OF p, r", [o.pagadorId, o.socio.id, PARES])).rows as Array<{ pid: string; pb: number; rid: string; rb: number }>;
  let falta = round2(o.monto);
  let descontado = 0;
  for (const d of deudas) {
    if (falta <= 0.005) break;
    const m = round2(Math.min(falta, d.pb, d.rb));
    if (m <= 0.005) continue;
    const np = round2(d.pb - m), nr = round2(d.rb - m);
    await client.query("UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1", [d.pid, np, np < 0.01 ? "PAID" : "PARTIAL"]);
    await client.query("UPDATE accounts_receivable SET balance = $2, status = $3 WHERE id = $1", [d.rid, nr, nr < 0.01 ? "PAID" : "PARTIAL"]);
    await client.query(
      "INSERT INTO cruces_entre_socios (cash_movement_id, payable_id, receivable_id, monto) VALUES ($1, $2, $3, $4)",
      [o.movimientoId, d.pid, d.rid, m]
    );
    falta = round2(falta - m);
    descontado = round2(descontado + m);
  }
  const porCobrar = falta > 0.005 ? falta : 0;
  if (porCobrar > 0) {
    await client.query(
      `INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status)
       VALUES ($1, 'pago_por_socio', $2, $3, $4, $4, 'CONFIRMED')`,
      [o.socio.id, o.movimientoId, `${pagador} pagó un gasto tuyo: ${o.concepto}`, porCobrar]
    );
    await client.query(
      `INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status)
       VALUES ($1, 'pago_por_socio', $2, $3, $4, $4, 'CONFIRMED')`,
      [o.pagadorId, o.movimientoId, `Pagaste un gasto de ${o.socio.name}: ${o.concepto}`, porCobrar]
    );
  }
  await notificar(client, {
    accionistaId: o.socio.id, tipo: "PAGO",
    titulo: `${pagador} pagó un gasto tuyo`,
    mensaje: `${pagador} pagó ${dinero(o.monto)} de ${o.concepto}. Queda en tus gastos.` +
      (descontado > 0 ? ` Se descontaron ${dinero(descontado)} de lo que ${pagador} te debía.` : "") +
      (porCobrar > 0 ? ` Le debes ${dinero(porCobrar)} a ${pagador} (Por Pagar).` : ""),
    monto: o.monto, referenciaTipo: "cash_movements", referenciaId: o.movimientoId
  });
  return { descontado, por_cobrar: porCobrar };
}
