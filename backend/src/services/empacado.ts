import type { PoolClient } from "pg";

/**
 * 📦 EMPACADO POR PRESENTACIÓN (pedido del dueño 2026-10-29). Las marcas (Flor, Oso…) se venden desde su
 * arroz base (0.11 / Corriente) y se empacan al preparar el pedido con sacos vacíos de la marca. Pero también
 * hay bultos YA LLENOS de la marca (saldo inicial, traídos de allá…): esos se llevan por peso de saco
 * (inventory_movements.sack_weight_lb) y al preparar un pedido de esa marca y presentación salen PRIMERO,
 * sin gastar sacos vacíos; solo el resto sale del arroz base.
 */

type Db = { query: PoolClient["query"] };
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Peso del saco de la línea SOLO si el pedido nombra la presentación (sin ella no se toman bultos llenos). */
export async function pesoExplicito(db: Db, presentationId: string | null, presentationName: string | null): Promise<number | null> {
  if (presentationId) {
    const w = Number((await db.query("SELECT weight_lb FROM product_presentations WHERE id = $1", [presentationId])).rows[0]?.weight_lb);
    if (w > 0) return w;
  }
  const m = String(presentationName ?? "").match(/(\d+(?:[.,]\d+)?)/);
  const w = m ? Number(m[1].replace(",", ".")) : NaN;
  return w > 0 ? w : null;
}

/** Bultos llenos de la marca con ese peso: primero la piladora, después «Allá» (bodegas EXTERNO). */
export async function bultosLlenosDisponibles(
  db: Db, opts: { productId: string; sackWeightLb: number; accionistaId: string | null | undefined; piladoraId: string }
): Promise<Array<{ warehouseId: string; bodega: string; externo: boolean; qq: number }>> {
  const r = await db.query(
    `SELECT w.id, w.name, (w.type = 'EXTERNO') AS externo, SUM(m.quantity)::float AS q
       FROM inventory_movements m JOIN warehouses w ON w.id = m.warehouse_id
      WHERE m.product_id = $1 AND m.sack_weight_lb = $2::numeric AND m.accionista_id IS NOT DISTINCT FROM $3
        AND m.ownership = 'OWNED' AND (w.id = $4 OR w.type = 'EXTERNO')
      GROUP BY w.id, w.name, w.type HAVING SUM(m.quantity) > 0.0005
      ORDER BY (w.id = $4) DESC, MIN(m.created_at), w.name`,
    [opts.productId, opts.sackWeightLb, opts.accionistaId ?? null, opts.piladoraId]
  );
  return r.rows.map((x) => ({ warehouseId: String(x.id), bodega: String(x.name), externo: Boolean(x.externo), qq: round3(Number(x.q)) }));
}

/** QQ que el pedido ya sacó de bultos llenos, por marca y peso (`${product_id}|${peso}`): no gastan sacos vacíos. */
export async function empacadoTomadoDelPedido(db: Db, orderId: string): Promise<Map<string, number>> {
  const r = await db.query(
    `SELECT product_id, sack_weight_lb::float AS peso, -SUM(quantity)::float AS q
       FROM inventory_movements
      WHERE reference_type = 'sales_order' AND reference_id = $1 AND movement = 'OUT' AND sack_weight_lb IS NOT NULL
      GROUP BY product_id, sack_weight_lb`,
    [orderId]
  );
  return new Map(r.rows.map((x) => [`${x.product_id}|${Number(x.peso)}`, round3(Number(x.q))]));
}

/** Marcas cuyo arroz base es este producto terminado (Flor, Oso… → 0.11; Conejo → Corriente). */
export async function marcasDelArrozBase(db: Db, baseCode: string): Promise<string[]> {
  const calidad = baseCode === "ARROZ-PILADO-011" ? "0.11" : baseCode === "ARROZ-PILADO-CORRIENTE" ? "CORRIENTE" : null;
  if (!calidad) return [];
  const fijas = calidad === "0.11" ? ["FLOR", "OSO", "EXTRA", "LIRA VERDE", "LIRA AZUL"] : ["CONEJO"];
  const r = await db.query(
    `SELECT p.id FROM products p
      WHERE p.product_type = 'PACKAGED_GOOD'
        AND (upper(p.name) = ANY($2::text[])
             OR EXISTS (SELECT 1 FROM sack_inventory s WHERE s.categoria = 'MARCA' AND s.calidad = $1
                          AND (s.product_id = p.id OR upper(s.marca) = upper(p.name))))`,
    [calidad, fijas]
  );
  return r.rows.map((x) => String(x.id));
}
