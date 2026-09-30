import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Anular desde Caja un pago de NÓMINA lo deja otra vez PENDIENTE en Nómina.
 *
 * Los pagos no guardan el id del egreso: se reconocen porque Nómina los marca
 * pagados en la MISMA transacción que crea el egreso, así que su paid_at /
 * applied_at es exactamente el created_at del egreso (now() de la transacción,
 * al microsegundo) y en la misma caja. La comparación se hace dentro de SQL
 * (un Date de JS pierde los microsegundos).
 *
 *  · worker_payments (pilador, estibador, secador, polvillo): vuelven a PENDING y
 *    los anticipos que ese pago descontó vuelven a PENDING.
 *  · cuadrilla_entries (cuadrilla por persona y 🚚 bajada de carro): vuelven a
 *    no pagadas; lo que el pago descontó de anticipos regresa a su saldo.
 *  · admin_salary_payments (sueldos): el pago queda anulado (anulado_at) y el
 *    sueldo del período vuelve a salir por pagar.
 *  · worker_advances (anticipo): se cancela; si ya se descontó en un pago, hay que
 *    anular primero ese pago.
 *
 * Devuelve un texto para el aviso, o null si el egreso no era de Nómina.
 */
export async function reabrirPagoNomina(
  client: PoolClient,
  m: { id: string; reference_type?: string | null; reference_id?: string | null; amount: string | number }
): Promise<string | null> {
  const ref = String(m.reference_type ?? "");

  if (ref === "worker_payments") {
    const filas = await client.query(
      `UPDATE worker_payments wp SET status = 'PENDING', paid_at = NULL, cash_register_id = NULL
         FROM cash_movements cm
        WHERE cm.id = $1 AND wp.status = 'PAID'
          AND (wp.id = cm.reference_id
               OR (cm.reference_id IS NULL AND wp.cash_register_id = cm.cash_register_id AND wp.paid_at = cm.created_at))
        RETURNING wp.worker_role, wp.worker_name`,
      [m.id]
    );
    if (!filas.rowCount) return null;
    const roles = filas.rows.map((f: { worker_role: string }) => f.worker_role);
    const nombres = filas.rows.map((f: { worker_name: string }) => f.worker_name);
    const anticipos = await client.query(
      `UPDATE worker_advances wa SET status = 'PENDING', applied_at = NULL
         FROM cash_movements cm
        WHERE cm.id = $1 AND wa.status = 'APPLIED' AND wa.applied_at = cm.created_at
          AND (wa.worker_role, wa.worker_name) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
      [m.id, roles, nombres]
    );
    const quien = [...new Set(filas.rows.map((f: { worker_role: string; worker_name: string }) => `${f.worker_name} (${f.worker_role.toLowerCase()})`))].join(", ");
    return `Nómina: el pago de ${quien} vuelve a pendiente (${filas.rowCount} registro${filas.rowCount === 1 ? "" : "s"}` +
      `${anticipos.rowCount ? `, ${anticipos.rowCount} anticipo${anticipos.rowCount === 1 ? "" : "s"} otra vez por descontar` : ""})`;
  }

  if (ref === "cuadrilla_entries") {
    const filas = await client.query(
      `UPDATE cuadrilla_entries ce SET paid_at = NULL, cash_register_id = NULL
         FROM cash_movements cm
        WHERE cm.id = $1 AND ce.cash_register_id = cm.cash_register_id AND ce.paid_at = cm.created_at
        RETURNING ce.worker_name, ce.origen, ce.subtotal::float AS subtotal`,
      [m.id]
    );
    if (!filas.rowCount) return null;
    const rows = filas.rows as Array<{ worker_name: string; origen: string | null; subtotal: number }>;
    if (rows.every((f) => f.origen === "BASCULA")) {
      return `Nómina: la bajada de carro vuelve a pendiente (${rows.length} ticket${rows.length === 1 ? "" : "s"})`;
    }
    // Pago de una cuadrilla (por persona): lo que se descontó de anticipos
    // (bruto − neto pagado) regresa al saldo de sus anticipos.
    const nombre = rows.find((f) => f.origen !== "BASCULA")!.worker_name;
    let resto = r2(rows.reduce((s, f) => s + Number(f.subtotal), 0) - Number(m.amount));
    if (resto > 0.004) {
      const advs = await client.query(
        `SELECT id, amount::float AS amount, balance::float AS balance FROM cuadrilla_advances
          WHERE worker_name = $1 AND balance < amount ORDER BY issued_at DESC FOR UPDATE`,
        [nombre]
      );
      for (const a of advs.rows as Array<{ id: string; amount: number; balance: number }>) {
        if (resto <= 0.004) break;
        const devolver = r2(Math.min(a.amount - a.balance, resto));
        const saldo = r2(a.balance + devolver);
        await client.query("UPDATE cuadrilla_advances SET balance = $2, status = $3 WHERE id = $1",
          [a.id, saldo, saldo >= a.amount - 0.004 ? "PENDING" : "PARTIAL"]);
        resto = r2(resto - devolver);
      }
    }
    return `Nómina: el pago de la cuadrilla ${nombre} vuelve a pendiente (${rows.length} registro${rows.length === 1 ? "" : "s"})`;
  }

  if (ref === "admin_salary_payments") {
    const filas = await client.query(
      `UPDATE admin_salary_payments sp SET anulado_at = now()
         FROM cash_movements cm
        WHERE cm.id = $1 AND sp.anulado_at IS NULL
          AND sp.cash_register_id = cm.cash_register_id AND sp.paid_at = cm.created_at
        RETURNING sp.worker_name, sp.periodo`,
      [m.id]
    );
    if (!filas.rowCount) return null;
    const f = filas.rows[0] as { worker_name: string; periodo: string | null };
    return `Nómina: el sueldo de ${f.worker_name}${f.periodo ? ` (${f.periodo})` : ""} vuelve a estar por pagar`;
  }

  if (ref === "worker_advances" && m.reference_id) {
    const a = await client.query("SELECT status, worker_name FROM worker_advances WHERE id = $1 FOR UPDATE", [m.reference_id]);
    if (!a.rowCount) return null;
    if (a.rows[0].status === "APPLIED") {
      throw new ApiError(409, "Este anticipo ya se descontó en un pago de Nómina. Anula primero ese pago en Caja y luego el anticipo.");
    }
    const up = await client.query("UPDATE worker_advances SET status = 'CANCELLED' WHERE id = $1 AND status = 'PENDING'", [m.reference_id]);
    return up.rowCount ? `Nómina: el anticipo de ${a.rows[0].worker_name} queda cancelado (ya no se descontará)` : null;
  }

  return null;
}
