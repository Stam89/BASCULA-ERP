// 💳 GASTO PAGADO CON EL BANCO / TARJETA DE DÉBITO DE LA PROPIA EMPRESA (pedido del dueño 2026-10-30, columna «FOMENTO»
// de su Excel). El banco no se lleva en el ERP: el gasto se registra normal y, en la MISMA transacción, entra lo mismo
// como «Retiro del banco a caja» (RETIRO_BANCO, reference_type 'pagado_con_banco' → el gasto). La gaveta no cambia.
// Las dos líneas se anulan juntas desde el gasto (la entrada del banco sola no se anula).
import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";

export const REF_PAGADO_CON_BANCO = "pagado_con_banco";

export async function registrarPagoConBanco(client: PoolClient, opts: {
  cajaId: string; gastoId: string; monto: number; concepto: string; userId?: string | null;
}): Promise<string> {
  const gasto = (await client.query(
    `SELECT m.movement, m.amount::float AS amount, m.medio, r.tipo
       FROM cash_movements m JOIN cash_registers r ON r.id = m.cash_register_id
      WHERE m.id = $1 AND m.cash_register_id = $2`,
    [opts.gastoId, opts.cajaId]
  )).rows[0] as { movement: string; amount: number; medio: string | null; tipo: string } | undefined;
  if (!gasto) throw new ApiError(404, "No se encontró el gasto pagado con el banco.");
  if (gasto.movement !== "EXPENSE") throw new ApiError(400, "Solo un EGRESO se paga con el banco.");
  if (gasto.tipo === "MIXTO") throw new ApiError(400, "En la caja mixta elige 🏦 Banco como medio: ahí el banco sí se lleva.");
  if (gasto.tipo === "BANCO") throw new ApiError(400, "Esta caja ya es de banco.");
  const entra = await client.query(
    `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by, medio)
     VALUES ($1, 'INCOME', 'RETIRO_BANCO', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [opts.cajaId, REF_PAGADO_CON_BANCO, opts.gastoId, opts.monto,
     `💳 Pagado con banco / tarjeta de débito (no salió de la gaveta): ${opts.concepto}`.slice(0, 500), opts.userId ?? null, gasto.medio]
  );
  return String(entra.rows[0].id);
}

/** Al anular el gasto: se anula también su entrada del banco (si la tiene). */
export async function anularPagoConBanco(client: PoolClient, opts: {
  gastoId: string; cajaDestino: string; motivo: string; userId?: string | null;
}): Promise<boolean> {
  const par = (await client.query(
    `SELECT * FROM cash_movements
      WHERE reference_type = $1 AND reference_id = $2 AND reversed_at IS NULL AND reversal_of IS NULL FOR UPDATE`,
    [REF_PAGADO_CON_BANCO, opts.gastoId]
  )).rows[0];
  if (!par) return false;
  await client.query(
    `INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, reference_type, reference_id, reversal_of, created_by, medio)
     VALUES ($1, 'EXPENSE', $2, $3, $4, 'reversal', $5, $5, $6, $7)`,
    [opts.cajaDestino, par.category, par.amount, `Anulación: ${opts.motivo} (lo que se pagó con el banco)`, par.id, opts.userId ?? null, par.medio]
  );
  await client.query("UPDATE cash_movements SET reversed_at = now(), reversed_by = $2, reversed_reason = $3 WHERE id = $1",
    [par.id, opts.userId ?? null, opts.motivo]);
  return true;
}
