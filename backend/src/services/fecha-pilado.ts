import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { hoyEc } from "../utils/fechas.js";
import { CORTE_ARRANQUE } from "../utils/corte-mes.js";

// 📅 FECHA DE PILADO (pedido del dueño 2026-10-29): una producción de días anteriores que se registra hoy queda con
// la fecha en que de verdad se piló. Se aplica al CERRAR el proceso, dentro de su misma transacción: el proceso, la
// cáscara que salió y el producto que entró (y el «Proceso guardado» que se retira), el pago del pilador/estibador/
// polvillo, el servicio de pilado y sus cuentas, los sacos, la custodia y el informe del lote. La hora es la de ahora,
// en ese día. Lo ya pagado de la nómina no se toca.

/** Valida la fecha: desde el arranque real (día siguiente al corte) hasta hoy. Devuelve null si es hoy o no vino. */
export function fechaPiladoValida(fecha: string | undefined | null): string | null {
  if (!fecha) return null;
  const hoy = hoyEc();
  if (fecha === hoy) return null;
  if (fecha > hoy) throw new ApiError(400, "La fecha de pilado no puede ser futura.");
  if (fecha <= CORTE_ARRANQUE) throw new ApiError(400, `La fecha de pilado debe ser desde el arranque (después del ${CORTE_ARRANQUE}).`);
  return fecha;
}

// Tablas cuyas filas de este cierre se crean en la MISMA transacción (created_at = now()).
const CREADAS_EN_EL_CIERRE = [
  "third_party_custody", "insumo_movements", "maquila_orders", "accounts_receivable", "accounts_payable",
  "production_yields", "lot_process_reports", "lot_process_report_links", "sack_movements"
];

export async function fecharProcesoEn(client: PoolClient, processingBatchId: string, fecha: string): Promise<void> {
  const ts = (await client.query(
    "SELECT (($1::date + (now() AT TIME ZONE 'America/Guayaquil')::time) AT TIME ZONE 'America/Guayaquil') AS ts",
    [fecha]
  )).rows[0].ts as Date;
  await client.query(
    `UPDATE processing_batches
        SET finished_at = $2, started_at = LEAST(COALESCE(started_at, $2), $2), created_at = LEAST(created_at, $2)
      WHERE id = $1`,
    [processingBatchId, ts]
  );
  // Cáscara que salió y producto que entró (se registran en pasos distintos del proceso).
  await client.query(
    "UPDATE inventory_movements SET created_at = $2 WHERE reference_type = 'processing_batches' AND reference_id = $1",
    [processingBatchId, ts]
  );
  await client.query("UPDATE processing_batch_drying_lots SET created_at = $2 WHERE processing_batch_id = $1", [processingBatchId, ts]);
  // El «Proceso guardado» (sus entradas y el retiro al cerrar) suma cero: va a la misma fecha para no dejar saltos.
  const tuneles = (await client.query(
    `SELECT drying_report_id AS id FROM processing_batches WHERE id = $1 AND drying_report_id IS NOT NULL
     UNION SELECT drying_report_id FROM processing_batch_drying_lots WHERE processing_batch_id = $1 AND drying_report_id IS NOT NULL`,
    [processingBatchId]
  )).rows.map((r) => String(r.id));
  if (tuneles.length) {
    await client.query(
      "UPDATE inventory_movements SET created_at = $2 WHERE reference_type = 'milling_draft' AND reference_id = ANY($1::uuid[])",
      [tuneles, ts]
    );
  }
  await client.query(
    `UPDATE worker_payments SET work_date = $3::date, created_at = $2
      WHERE reference_type = 'processing_batch' AND reference_id = $1 AND status = 'PENDING'`,
    [processingBatchId, ts, fecha]
  );
  await client.query("UPDATE pilado_services SET service_date = $2::date, created_at = $1 WHERE created_at = now()", [ts, fecha]);
  for (const tabla of CREADAS_EN_EL_CIERRE) {
    await client.query(`UPDATE ${tabla} SET created_at = $1 WHERE created_at = now()`, [ts]);
  }
  await client.query(
    `UPDATE production_yields SET rendimiento_snapshot = jsonb_set(rendimiento_snapshot, '{fecha}', to_jsonb($2::text))
      WHERE processing_batch_id = $1 AND rendimiento_snapshot ? 'fecha'`,
    [processingBatchId, new Date(ts).toISOString()]
  );
}
