// 🚚 TRAER A LA PILADORA lo que quedó ALLÁ donde el proveedor de selección/envejecido (un viaje):
// sale de «Allá: <proveedor>», entra a la bodega de producto terminado y, si alguien cobró el viaje, se
// registra el flete de regreso (carro de Transporte y Cosechadora o externo). Lo usan Selección («Traer a
// piladora») y la preparación de un pedido cuando ese arroz YA había llegado y nadie registró el viaje.
import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { registrarFleteEnvejecido, type FleteEnvejecido } from "./campo-flete-envejecido.js";
import { consumeInventoryFIFO } from "./inventory-consume.js";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function traerDesdeAlla(tx: PoolClient, input: {
  accionistaId: string;
  providerId: string;
  items: Array<{ product_id: string; quantity: number }>;
  fecha?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  flete?: FleteEnvejecido | null;
  /** Bodega de la piladora a la que entra (por defecto la primera de producto terminado). */
  plantaId?: string | null;
}) {
  const alla = await tx.query("SELECT id, name FROM warehouses WHERE external_provider_id = $1", [input.providerId]);
  if (!alla.rowCount) throw new ApiError(404, "No hay nada registrado allá con ese proveedor.");
  const plantaId = input.plantaId ?? (await tx.query("SELECT id FROM warehouses WHERE type = 'FINISHED_GOODS' AND is_active = true ORDER BY name LIMIT 1")).rows[0]?.id;
  if (!plantaId) throw new ApiError(400, "No existe la bodega de producto terminado de la piladora.");
  const totalQq = round3(input.items.reduce((s, i) => s + i.quantity, 0));
  const traida = await tx.query(
    `INSERT INTO selection_traidas (accionista_id, provider_id, fecha, items, total_qq, notes, created_by)
     VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4::jsonb, $5, $6, $7) RETURNING id`,
    [input.accionistaId, input.providerId, input.fecha ?? null, JSON.stringify(input.items.map((i) => ({ product_id: i.product_id, quantity: round3(i.quantity) }))),
     totalQq, input.notes ?? null, input.createdBy ?? null]
  );
  const traidaId: string = traida.rows[0].id;
  for (const it of input.items) {
    const qty = round3(it.quantity);
    // Sale de «Allá» (valida que haya: no se trae más de lo que quedó)…
    await consumeInventoryFIFO(tx, {
      productId: it.product_id, warehouseId: alla.rows[0].id, accionistaId: input.accionistaId, quantity: qty,
      referenceType: "selection_traida", referenceId: traidaId,
      notes: `Traído a la piladora desde ${alla.rows[0].name}`, createdBy: input.createdBy ?? null
    });
    // …y entra a la piladora.
    await tx.query(
      `INSERT INTO inventory_movements
       (product_id, warehouse_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id)
       VALUES ($1, $2, 'IN', $3, 'selection_traida', $4, 'OWNED', $5, $6, $7)`,
      [it.product_id, plantaId, qty, traidaId, `Llegó a la piladora desde ${alla.rows[0].name}`, input.createdBy ?? null, input.accionistaId]
    );
  }
  let flete: Awaited<ReturnType<typeof registrarFleteEnvejecido>> | null = null;
  if (input.flete) {
    const fecha = input.fecha ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
    flete = await registrarFleteEnvejecido(tx, {
      batchId: traidaId, batchNumber: `regreso desde ${alla.rows[0].name.replace(/^Allá: /, "")} ${fecha}`, accionistaId: input.accionistaId, fecha,
      qq: totalQq, flete: input.flete, createdBy: input.createdBy ?? null, origen: "envejecido_regreso"
    });
    await tx.query(
      `UPDATE selection_traidas SET flete_tipo = $2, flete_monto = $3, flete_activo_id = $4, flete_prestador = $5, flete_payable_id = $6 WHERE id = $1`,
      [traidaId, flete.tipo, flete.monto, flete.activo_id, flete.prestador, flete.payable_id]
    );
  }
  return { id: traidaId, total_qq: totalQq, flete, proveedor: String(alla.rows[0].name).replace(/^Allá: /, "") };
}
