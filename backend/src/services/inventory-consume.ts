import type { PoolClient } from "pg";
import { lockInventoryStock } from "../db/inventory-lock.js";
import { ApiError } from "../http/error-handler.js";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

type ConsumeInventoryOptions = {
  productId: string;
  warehouseId: string;
  accionistaId?: string | null;
  ownership?: string;
  quantity: number;
  referenceType: string;
  referenceId: string;
  createdBy?: string | null;
  notes?: string | null;
  preferredLotId?: string | null;
  /** 📦 Solo los bultos llenos de ese peso de saco (marca por presentación). Sin él, sale primero lo «sin presentación». */
  sackWeightLb?: number | null;
};

/** Lo que salió de cada tramo (lote + peso del saco), para quien deba volver a ingresarlo igual (ej. traer de allá). */
export type TramoConsumido = { lot_id: string | null; quantity: number; sack_weight_lb: number | null };

export async function consumeInventoryFIFO(
  client: PoolClient,
  opts: ConsumeInventoryOptions
): Promise<TramoConsumido[]> {
  const tramos: TramoConsumido[] = [];
  const quantity = round3(Number(opts.quantity) || 0);
  if (quantity <= 0) return tramos;
  const ownership = opts.ownership ?? "OWNED";

  await lockInventoryStock(client, {
    productId: opts.productId,
    warehouseId: opts.warehouseId,
    accionistaId: opts.accionistaId,
    ownership
  });

  const product = await client.query("SELECT name FROM products WHERE id = $1", [opts.productId]);
  const productName = product.rows[0]?.name ?? "este producto";

  const stockArgs: unknown[] = [opts.productId, opts.warehouseId, opts.accionistaId ?? null, ownership];
  let lotFilter = "";
  if (opts.preferredLotId) { stockArgs.push(opts.preferredLotId); lotFilter += ` AND lot_id = $${stockArgs.length}::uuid`; }
  if (opts.sackWeightLb != null) { stockArgs.push(opts.sackWeightLb); lotFilter += ` AND sack_weight_lb = $${stockArgs.length}::numeric`; }

  const available = await client.query(
    `SELECT lot_id, sack_weight_lb::float AS sack_weight_lb, COALESCE(SUM(quantity), 0)::float AS quantity, MIN(created_at) AS first_at
     FROM inventory_movements
     WHERE product_id = $1
       AND warehouse_id = $2
       AND accionista_id = $3
       AND ownership = $4
       ${lotFilter}
     GROUP BY lot_id, sack_weight_lb
     HAVING COALESCE(SUM(quantity), 0) > 0.001
     ORDER BY (sack_weight_lb IS NOT NULL), (lot_id IS NULL), MIN(created_at), lot_id, sack_weight_lb`,
    stockArgs
  );

  const totalAvailable = round3(available.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0));
  if (totalAvailable + 0.001 < quantity) {
    throw new ApiError(
      409,
      `Stock insuficiente de ${productName}: hay ${totalAvailable.toFixed(2)} QQ y la salida requiere ${quantity.toFixed(2)} QQ.`
    );
  }

  let remaining = quantity;
  for (const row of available.rows) {
    if (remaining <= 0.001) break;
    const take = round3(Math.min(remaining, Number(row.quantity) || 0));
    if (take <= 0) continue;
    await client.query(
      `INSERT INTO inventory_movements
       (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id, sack_weight_lb)
       VALUES ($1, $2, $3, 'OUT', $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        opts.productId,
        opts.warehouseId,
        row.lot_id ?? null,
        -take,
        opts.referenceType,
        opts.referenceId,
        ownership,
        opts.notes ?? null,
        opts.createdBy ?? null,
        opts.accionistaId ?? null,
        row.sack_weight_lb ?? null
      ]
    );
    tramos.push({ lot_id: row.lot_id ?? null, quantity: take, sack_weight_lb: row.sack_weight_lb ?? null });
    remaining = round3(remaining - take);
  }

  if (remaining > 0.001) {
    throw new ApiError(409, `No se pudo completar la salida de inventario de ${productName}. Faltan ${remaining.toFixed(2)} QQ.`);
  }
  return tramos;
}

