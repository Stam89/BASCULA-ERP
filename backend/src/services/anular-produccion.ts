// ↩ Anular un proceso de PRODUCCIÓN ya cerrado (solo administrador).
// Para corregir un cierre mal digitado: se deshace TODO lo que generó el cierre y el lote queda listo para volver a pilarse.
// Frenos (se rechaza con 409 y no se toca nada): parte del arroz producido ya se vendió/usó; el cobro del servicio (o de los
// sacos del servicio) ya tiene abonos o su Por Pagar del socio ya se pagó; algún pago de nómina del proceso ya se pagó.
// Todo ocurre en UNA transacción. El inventario se corrige con movimientos REVERSAL (el kárdex conserva la historia).
import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { lockInventoryStock } from "../db/inventory-lock.js";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type ResultadoAnulacion = {
  batch_id: string;
  batch_number: string;
  salidas_revertidas: number;
  entradas_restauradas: number;
  cuentas_anuladas: number;
  pagos_nomina_eliminados: number;
  sacos_devueltos: number;
  empaque_devuelto: number;
  lotes_restaurados: number;
};

export async function anularProcesoProduccion(
  client: PoolClient,
  batchId: string,
  opts: { motivo: string; userId: string | null }
): Promise<ResultadoAnulacion> {
  const b = (await client.query(
    `SELECT b.*, l.lot_code FROM processing_batches b JOIN lots l ON l.id = b.lot_id WHERE b.id = $1 FOR UPDATE OF b, l`,
    [batchId]
  )).rows[0];
  if (!b) throw new ApiError(404, "Proceso de producción no encontrado.");
  if (b.status === "CANCELLED") throw new ApiError(409, "Este proceso ya fue anulado.");
  if (!b.finished_at) throw new ApiError(409, "Este proceso sigue abierto (no se ha cerrado): no hay un cierre que anular.");

  // ── 1. Frenos ──────────────────────────────────────────────────────────
  const movs = (await client.query(
    `SELECT m.id, m.product_id, m.warehouse_id, m.lot_id, m.movement::text AS movement, m.quantity::float AS quantity,
            m.ownership, m.accionista_id, p.name AS producto
       FROM inventory_movements m JOIN products p ON p.id = m.product_id
      WHERE m.reference_type = 'processing_batches' AND m.reference_id = $1 AND m.movement IN ('PROCESS_INPUT', 'PROCESS_OUTPUT')`,
    [batchId]
  )).rows as Array<{ id: string; product_id: string; warehouse_id: string; lot_id: string | null; movement: string; quantity: number; ownership: string; accionista_id: string | null; producto: string }>;

  // 1a. El arroz producido no puede haberse vendido/usado: tras quitar las salidas, la existencia no puede quedar negativa.
  const grupos = new Map<string, { product_id: string; warehouse_id: string; ownership: string; accionista_id: string | null; producto: string; salida: number }>();
  for (const m of movs.filter((x) => x.movement === "PROCESS_OUTPUT")) {
    const k = [m.product_id, m.warehouse_id, m.ownership, m.accionista_id ?? "-"].join("|");
    const g = grupos.get(k) ?? { product_id: m.product_id, warehouse_id: m.warehouse_id, ownership: m.ownership, accionista_id: m.accionista_id, producto: m.producto, salida: 0 };
    g.salida += m.quantity;
    grupos.set(k, g);
  }
  for (const g of grupos.values()) {
    await lockInventoryStock(client, { productId: g.product_id, warehouseId: g.warehouse_id, accionistaId: g.accionista_id, ownership: g.ownership as "OWNED" | "MAQUILA" | "SERVICE_ONLY" });
    const stock = Number((await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::float AS s FROM inventory_movements
        WHERE product_id = $1 AND warehouse_id = $2 AND ownership = $3 AND accionista_id IS NOT DISTINCT FROM $4`,
      [g.product_id, g.warehouse_id, g.ownership, g.accionista_id]
    )).rows[0].s);
    if (stock - g.salida < -0.001) {
      throw new ApiError(409, `No se puede anular: de «${g.producto}» este proceso produjo ${r2(g.salida)} QQ pero en bodega solo quedan ${r2(stock)} (ya se vendió o usó una parte). Primero corrige esas ventas/usos.`);
    }
  }

  // 1b. Cuentas del servicio: sin abonos.
  const servicios = (await client.query(
    "SELECT id, receivable_id, payable_id FROM pilado_services WHERE processing_batch_id = $1 FOR UPDATE",
    [batchId]
  )).rows as Array<{ id: string; receivable_id: string | null; payable_id: string | null }>;
  const idsCxc = servicios.map((s) => s.receivable_id).filter(Boolean) as string[];
  const idsCxp = servicios.map((s) => s.payable_id).filter(Boolean) as string[];
  const cxcSacos = (await client.query(
    "SELECT id FROM accounts_receivable WHERE reference_type = 'sacos_servicio' AND reference_id = $1", [batchId]
  )).rows.map((x: { id: string }) => x.id);
  idsCxc.push(...cxcSacos);
  const cobros = idsCxc.length ? (await client.query(
    "SELECT id, amount::float AS a, balance::float AS b, status::text AS st FROM accounts_receivable WHERE id = ANY($1::uuid[]) FOR UPDATE", [idsCxc]
  )).rows : [];
  if (cobros.some((c: { a: number; b: number; st: string }) => c.st !== "CANCELLED" && c.b < c.a - 0.005)) {
    throw new ApiError(409, "No se puede anular: el cobro del servicio de pilado (o de sus sacos) ya tiene abonos. Anúlalos primero en Por Cobrar.");
  }
  const pagos = idsCxp.length ? (await client.query(
    "SELECT id, amount::float AS a, balance::float AS b, status::text AS st FROM accounts_payable WHERE id = ANY($1::uuid[]) FOR UPDATE", [idsCxp]
  )).rows : [];
  if (pagos.some((p: { a: number; b: number; st: string }) => p.st !== "CANCELLED" && p.b < p.a - 0.005)) {
    throw new ApiError(409, "No se puede anular: la cuenta por pagar del socio por este servicio ya tiene pagos. Anúlalos primero en Por Pagar.");
  }

  // 1c. Nómina del proceso: nada pagado.
  const nominaPagada = (await client.query(
    "SELECT worker_name FROM worker_payments WHERE reference_type = 'processing_batch' AND reference_id = $1 AND status = 'PAID' LIMIT 1", [batchId]
  )).rows[0];
  if (nominaPagada) {
    throw new ApiError(409, `No se puede anular: el pago de nómina de ${nominaPagada.worker_name} por este proceso ya se pagó. Anula primero ese pago en Caja.`);
  }

  // ── 2. Deshacer ────────────────────────────────────────────────────────
  const nota = `Anulación de producción ${b.batch_number}: ${opts.motivo}`.slice(0, 480);
  let salidasRevertidas = 0, entradasRestauradas = 0;
  for (const m of movs) {
    await client.query(
      `INSERT INTO inventory_movements
         (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id)
       VALUES ($1, $2, $3, 'REVERSAL', $4, 'produccion_anulada', $5, $6, $7, $8, $9)`,
      [m.product_id, m.warehouse_id, m.lot_id, -m.quantity, batchId, m.ownership, nota, opts.userId, m.accionista_id]
    );
    if (m.movement === "PROCESS_OUTPUT") salidasRevertidas++; else entradasRestauradas++;
  }

  // Empaque (insumo) consumido al cerrar → vuelve.
  let empaque = 0;
  const consumos = (await client.query(
    "SELECT insumo_id, quantity::float AS q FROM insumo_movements WHERE reference_type = 'processing_batches' AND reference_id = $1 AND movement = 'CONSUMPTION'", [batchId]
  )).rows as Array<{ insumo_id: string; q: number }>;
  for (const c of consumos) {
    const devolver = Math.abs(c.q);
    await client.query("UPDATE insumos SET stock_actual = stock_actual + $2, updated_at = now() WHERE id = $1", [c.insumo_id, devolver]);
    await client.query(
      `INSERT INTO insumo_movements (insumo_id, movement, quantity, reference_type, reference_id, notes, created_by)
       VALUES ($1, 'ADJUSTMENT', $2, 'produccion_anulada', $3, $4, $5)`,
      [c.insumo_id, devolver, batchId, nota, opts.userId]
    );
    empaque += devolver;
  }

  // Sacos de la planta usados en un servicio de pilada → vuelven (ENTRADA en el kárdex).
  let sacosDevueltos = 0;
  const salidasSacos = (await client.query(
    `SELECT sack_id, SUM(CASE WHEN movement = 'SALIDA' THEN cantidad ELSE -cantidad END)::float AS neto
       FROM sack_movements WHERE ref_batch = $1 GROUP BY sack_id`, [batchId]
  )).rows as Array<{ sack_id: string; neto: number }>;
  for (const s of salidasSacos) {
    if (!(s.neto > 0)) continue;
    await client.query("UPDATE sack_inventory SET stock = stock + $2, updated_at = now() WHERE id = $1", [s.sack_id, s.neto]);
    await client.query(
      "INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_batch) VALUES ($1, 'ENTRADA', $2, $3, $4)",
      [s.sack_id, s.neto, nota.slice(0, 200), batchId]
    );
    sacosDevueltos += s.neto;
  }

  // Cuentas del servicio: se anulan (estado CANCELLED con saldo 0, como el resto del sistema).
  const lotesDelProceso = (await client.query(
    "SELECT DISTINCT lot_id FROM processing_batch_drying_lots WHERE processing_batch_id = $1", [batchId]
  )).rows.map((x: { lot_id: string }) => x.lot_id);
  if (!lotesDelProceso.includes(b.lot_id)) lotesDelProceso.push(b.lot_id);
  let cuentas = 0;
  if (idsCxc.length) cuentas += (await client.query("UPDATE accounts_receivable SET status = 'CANCELLED', balance = 0 WHERE id = ANY($1::uuid[]) AND status <> 'CANCELLED'", [idsCxc])).rowCount ?? 0;
  if (idsCxp.length) cuentas += (await client.query("UPDATE accounts_payable SET status = 'CANCELLED', balance = 0 WHERE id = ANY($1::uuid[]) AND status <> 'CANCELLED'", [idsCxp])).rowCount ?? 0;
  await client.query(
    `UPDATE maquila_orders SET status = 'CANCELLED'
      WHERE lot_id = ANY($1::uuid[]) AND service_type = 'PILADO_MAQUILA' AND status <> 'CANCELLED' AND created_at >= $2`,
    [lotesDelProceso, b.started_at]
  );
  await client.query("DELETE FROM pilado_services WHERE processing_batch_id = $1", [batchId]);

  // Lo derivado del cierre.
  const yieldRow = (await client.query("SELECT id FROM production_yields WHERE processing_batch_id = $1", [batchId])).rows[0];
  await client.query("DELETE FROM lot_process_reports WHERE (reference_type = 'processing_batches' AND reference_id = $1) OR (reference_type = 'production_yields' AND reference_id = $2)", [batchId, yieldRow?.id ?? null]);
  await client.query("DELETE FROM production_yields WHERE processing_batch_id = $1", [batchId]);
  await client.query("DELETE FROM processing_outputs WHERE processing_batch_id = $1", [batchId]);
  await client.query("DELETE FROM processing_losses WHERE processing_batch_id = $1", [batchId]);
  await client.query("DELETE FROM third_party_custody WHERE processing_batch_id = $1", [batchId]);
  const nominaBorrada = (await client.query(
    "DELETE FROM worker_payments WHERE reference_type = 'processing_batch' AND reference_id = $1 AND status <> 'PAID'", [batchId]
  )).rowCount ?? 0;
  await client.query("DELETE FROM processing_batch_drying_lots WHERE processing_batch_id = $1", [batchId]);

  // El lote vuelve a donde estaba antes de producir; el proceso queda ANULADO y «sin cerrar» (así el secado vuelve a estar disponible).
  const previo = String(b.estado_lote_previo ?? "") || "WEIGHED";
  const lotes = await client.query("UPDATE lots SET status = $2::lot_status WHERE id = ANY($1::uuid[]) AND status IN ('PROCESSED', 'IN_PROCESS')", [lotesDelProceso, previo]);
  await client.query(
    `UPDATE processing_batches
        SET status = 'CANCELLED', finished_at = NULL, anulado_at = now(), anulado_por = $2, anulado_motivo = $3,
            drying_report_id_anulado = drying_report_id, drying_report_id = NULL
      WHERE id = $1`,
    [batchId, opts.userId, opts.motivo]
  );

  return {
    batch_id: batchId, batch_number: String(b.batch_number),
    salidas_revertidas: salidasRevertidas, entradas_restauradas: entradasRestauradas,
    cuentas_anuladas: cuentas, pagos_nomina_eliminados: nominaBorrada,
    sacos_devueltos: sacosDevueltos, empaque_devuelto: empaque, lotes_restaurados: lotes.rowCount ?? 0
  };
}
