import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { pool as Pool } from "../db/pool.js";
import { ApiError } from "../http/error-handler.js";

// 💵 Préstamo al dueño de la selectora (pedido del dueño 2026-11-06): son fondos por liquidar de la Matriz a su nombre y se
// descuentan de a poco, en el monto que se escriba cada vez, de lo que la Matriz le debe por la selectora. Es un cruce: el
// dinero salió de la caja al entregar el préstamo, así que aquí no hay movimiento de caja. Lo que le deben los socios no entra.
type Db = PoolClient | typeof Pool;
const round2 = (n: number) => Math.round(n * 100) / 100;

const FONDOS_DE_LA_PERSONA = `
  FROM cash_movements m JOIN cash_registers r ON r.id = m.cash_register_id
 WHERE r.accionista_id = $1 AND m.movement = 'EXPENSE' AND m.es_fondo AND m.fondo_estado = 'POR_LIQUIDAR'
   AND m.reversed_at IS NULL AND m.reversal_of IS NULL AND upper(btrim(m.responsable)) = upper(btrim($2))`;
const YA_DESCONTADO = "COALESCE((SELECT SUM(d.monto) FROM prestamo_descuentos d WHERE d.fondo_id = m.id AND d.anulado_at IS NULL), 0)";

/** Lo que falta descontar del préstamo y los descuentos vigentes. */
export async function consultarPrestamo(db: Db, matrizId: string, providerId: string) {
  const prov = (await db.query("SELECT name FROM external_providers WHERE id = $1", [providerId])).rows[0];
  if (!prov) throw new ApiError(404, "Esa persona no está en el catálogo.");
  const saldo = (await db.query(`SELECT COALESCE(SUM(m.amount - ${YA_DESCONTADO}), 0)::float AS s ${FONDOS_DE_LA_PERSONA}`, [matrizId, prov.name])).rows[0].s;
  const descuentos = (await db.query(
    `SELECT d.lote, to_char(MIN(d.created_at) AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD') AS fecha, SUM(d.monto)::float AS monto
       FROM prestamo_descuentos d JOIN selectora_cargos c ON c.payable_id = d.payable_id
      WHERE c.provider_id = $1 AND c.accionista_id = $2 AND d.anulado_at IS NULL
      GROUP BY d.lote ORDER BY MIN(d.created_at) DESC LIMIT 20`,
    [providerId, matrizId]
  )).rows;
  return { proveedor: prov.name as string, saldo: round2(Number(saldo)), descuentos };
}

/** Reparte el monto de la deuda más vieja a la más nueva y del fondo más viejo al más nuevo. */
export async function descontarPrestamo(client: PoolClient, opts: { matrizId: string; payableIds: string[]; monto: number; userId: string | null }) {
  const cuentas = (await client.query(
    `SELECT ap.id, ap.amount::float AS amount, ap.balance::float AS balance, c.provider_id, pr.name AS proveedor
       FROM accounts_payable ap
       JOIN selectora_cargos c ON c.payable_id = ap.id
       JOIN external_providers pr ON pr.id = c.provider_id
      WHERE ap.id = ANY($1::uuid[]) AND ap.accionista_id = $2 AND ap.reference_type = 'selectora_servicio'
        AND ap.status IN ('CONFIRMED', 'PARTIAL') AND ap.balance > 0
      ORDER BY ap.created_at, ap.id
      FOR UPDATE OF ap`,
    [opts.payableIds, opts.matrizId]
  )).rows as Array<{ id: string; amount: number; balance: number; provider_id: string; proveedor: string }>;
  if (cuentas.length !== new Set(opts.payableIds).size) throw new ApiError(409, "Solo se descuenta de lo que la Matriz debe por la selectora.");
  if (new Set(cuentas.map((c) => c.provider_id)).size !== 1) throw new ApiError(409, "Esas cuentas son de personas distintas.");

  const fondos = (await client.query(
    `SELECT m.id, m.amount::float AS amount ${FONDOS_DE_LA_PERSONA} ORDER BY m.created_at, m.id FOR UPDATE OF m`,
    [opts.matrizId, cuentas[0].proveedor]
  )).rows as Array<{ id: string; amount: number }>;
  const pendientes: Array<{ id: string; saldo: number }> = [];
  for (const f of fondos) {
    const ya = Number((await client.query("SELECT COALESCE(SUM(monto), 0)::float AS s FROM prestamo_descuentos WHERE fondo_id = $1 AND anulado_at IS NULL", [f.id])).rows[0].s);
    pendientes.push({ id: f.id, saldo: round2(f.amount - ya) });
  }
  const saldoPrestamo = round2(pendientes.reduce((s, f) => s + f.saldo, 0));
  const saldoCuentas = round2(cuentas.reduce((s, c) => s + c.balance, 0));
  const monto = round2(opts.monto);
  if (monto > saldoPrestamo + 0.001) throw new ApiError(409, `El préstamo pendiente de ${cuentas[0].proveedor} es $${saldoPrestamo.toFixed(2)}.`);
  if (monto > saldoCuentas + 0.001) throw new ApiError(409, `Lo que se le debe en estas cuentas es $${saldoCuentas.toFixed(2)}.`);

  const lote = randomUUID();
  let falta = monto, c = 0, f = 0;
  while (falta > 0.001) {
    if (cuentas[c].balance < 0.005) { c++; continue; }
    if (pendientes[f].saldo < 0.005) { f++; continue; }
    const parte = round2(Math.min(falta, cuentas[c].balance, pendientes[f].saldo));
    await client.query(
      "INSERT INTO prestamo_descuentos (lote, fondo_id, payable_id, monto, created_by) VALUES ($1, $2, $3, $4, $5)",
      [lote, pendientes[f].id, cuentas[c].id, parte, opts.userId]
    );
    cuentas[c].balance = round2(cuentas[c].balance - parte);
    pendientes[f].saldo = round2(pendientes[f].saldo - parte);
    falta = round2(falta - parte);
  }
  for (const cuenta of cuentas) {
    await client.query(
      "UPDATE accounts_payable SET balance = $2, status = (CASE WHEN $2 < 0.01 THEN 'PAID' WHEN $2 < $3 - 0.005 THEN 'PARTIAL' ELSE 'CONFIRMED' END)::document_status WHERE id = $1",
      [cuenta.id, cuenta.balance, cuenta.amount]
    );
  }
  const cubiertos = pendientes.filter((x) => x.saldo < 0.005).map((x) => x.id);
  if (cubiertos.length) await client.query("UPDATE cash_movements SET fondo_estado = 'LIQUIDADO' WHERE id = ANY($1::uuid[])", [cubiertos]);
  return { lote, monto, proveedor: cuentas[0].proveedor, saldo_prestamo: round2(saldoPrestamo - monto) };
}

/** Deshace un descuento: la cuenta vuelve a deber y el préstamo vuelve a quedar por descontar. */
export async function anularDescuentoPrestamo(client: PoolClient, lote: string, userId: string | null) {
  const filas = (await client.query(
    "SELECT id, fondo_id, payable_id, monto::float AS monto FROM prestamo_descuentos WHERE lote = $1 AND anulado_at IS NULL FOR UPDATE", [lote]
  )).rows as Array<{ id: string; fondo_id: string; payable_id: string; monto: number }>;
  if (!filas.length) throw new ApiError(404, "Ese descuento ya no está vigente.");
  for (const x of filas) {
    await client.query(
      `UPDATE accounts_payable SET balance = balance + $2,
              status = (CASE WHEN balance + $2 >= amount - 0.005 THEN 'CONFIRMED' ELSE 'PARTIAL' END)::document_status
        WHERE id = $1`,
      [x.payable_id, x.monto]
    );
  }
  await client.query("UPDATE cash_movements SET fondo_estado = 'POR_LIQUIDAR' WHERE id = ANY($1::uuid[])", [filas.map((x) => x.fondo_id)]);
  await client.query("UPDATE prestamo_descuentos SET anulado_at = now(), anulado_by = $2 WHERE lote = $1 AND anulado_at IS NULL", [lote, userId]);
  return { ok: true, monto: round2(filas.reduce((s, x) => s + x.monto, 0)) };
}

/** Un fondo que ya se está descontando no se liquida ni se anula a mano. */
export async function exigirFondoSinDescuentos(db: Db, fondoId: string) {
  const r = await db.query("SELECT 1 FROM prestamo_descuentos WHERE fondo_id = $1 AND anulado_at IS NULL LIMIT 1", [fondoId]);
  if (r.rowCount) throw new ApiError(409, "Ese fondo ya tiene descuentos de la selectora: anúlalos primero desde Por Pagar.");
}
