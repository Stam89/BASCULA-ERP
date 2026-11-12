import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { hoyEc } from "../utils/fechas.js";

// 📅 FECHA DE DESPACHO (pedido del dueño 2026-11-12): un pedido que salió un día anterior y se registra después queda
// con el día en que de verdad se despachó: la venta, el inventario que salió, el cobro en caja, las cuentas, el flete,
// el pago de la cuadrilla y el propio pedido. Se aplica al final del despacho, dentro de su misma transacción: todo lo
// que esa transacción creó tiene created_at = now(). La hora es la de ahora, en ese día.

/** Hasta 30 días atrás y nunca en el futuro. Devuelve null si es hoy o no vino. */
export function fechaDespachoValida(fecha: string | undefined | null): string | null {
  if (!fecha) return null;
  const hoy = hoyEc();
  if (fecha === hoy) return null;
  if (fecha > hoy) throw new ApiError(400, "La fecha del despacho no puede ser futura.");
  const limite = new Date(`${hoy}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - 30);
  if (fecha < limite.toISOString().slice(0, 10)) throw new ApiError(400, "La fecha del despacho no puede tener más de 30 días.");
  return fecha;
}

const CREADAS_EN_EL_DESPACHO = [
  "sales", "inventory_movements", "cash_movements", "cash_movement_cuentas", "accounts_receivable", "accounts_payable",
  "campo_movimientos", "campo_servicios"
];

export async function fecharDespachoEn(client: PoolClient, orderId: string, fecha: string): Promise<void> {
  const ts = (await client.query(
    "SELECT (($1::date + (now() AT TIME ZONE 'America/Guayaquil')::time) AT TIME ZONE 'America/Guayaquil') AS ts",
    [fecha]
  )).rows[0].ts as Date;
  for (const tabla of CREADAS_EN_EL_DESPACHO) {
    await client.query(`UPDATE ${tabla} SET created_at = $1 WHERE created_at = now()`, [ts]);
  }
  // Transporte guarda además su día (fecha) en el flete.
  await client.query("UPDATE campo_movimientos SET fecha = $1::date WHERE created_at = $2", [fecha, ts]);
  await client.query("UPDATE campo_servicios SET fecha = $1::date WHERE created_at = $2", [fecha, ts]);
  // La cuadrilla cobra la carga por el día en que salió el camión (solo si aún no se le pagó).
  await client.query(
    "UPDATE worker_payments SET work_date = $1::date WHERE created_at = now() AND status = 'PENDING'",
    [fecha]
  );
  await client.query("UPDATE sales_orders SET delivered_at = $2 WHERE id = $1", [orderId, ts]);
}
