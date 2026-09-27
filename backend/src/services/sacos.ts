import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { tipoSacoEspecial } from "./cargo-empaque.js";

/**
 * INVENTARIO DE SACOS POR MARCA Y PESO (bodega única de la MATRIZ).
 *
 * Regla de negocio vigente:
 *  · Los sacos se descuentan al VENDER, en "Confirmar Preparación" del pedido,
 *    por la marca (producto del pedido) y la presentación (peso) vendidas.
 *    Si se revierte la preparación o se anula el pedido, vuelven al inventario.
 *  · Producción ya NO descuenta sacos (sus conteos solo pagan al estibador),
 *    salvo en un Servicio de Pilada cuando el cliente pide sacos de la planta:
 *    ahí se descuentan y se le cobran (ver `descontarSacosServicio`).
 *  · Si falta stock NO se bloquea: el saldo puede quedar negativo y el Dashboard
 *    alerta (stock ≤ stock mínimo que el usuario fija en Configuración).
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type SacoRow = {
  id: string;
  tipo: string;
  stock: number;
  categoria: string;
  marca: string | null;
  peso_lb: number | null;
  product_id: string | null;
  precio_venta_cliente: number;
  precio_compra_default: number;
};

/** Sacos que ocupa una cantidad en QQ con sacos de `pesoLb` libras. */
export function sacosParaQq(qq: number, pesoLb: number): number {
  if (!(qq > 0) || !(pesoLb > 0)) return 0;
  return Math.max(1, Math.round((qq * 100) / pesoLb));
}

/** Peso de la presentación: por su id, o el número que traiga su nombre ("50lb"); 100 por defecto. */
export async function pesoDePresentacion(
  client: PoolClient,
  presentationId: string | null | undefined,
  presentationName: string | null | undefined
): Promise<number> {
  if (presentationId) {
    const r = await client.query("SELECT weight_lb FROM product_presentations WHERE id = $1", [presentationId]);
    const w = Number(r.rows[0]?.weight_lb);
    if (w > 0) return w;
  }
  const m = String(presentationName ?? "").match(/(\d+(?:[.,]\d+)?)/);
  const w = m ? Number(m[1].replace(",", ".")) : NaN;
  return w > 0 ? w : 100;
}

/**
 * Qué saco corresponde a un producto vendido en un peso dado:
 *  1) el saco de su MARCA en ese peso (Flor 50 LB…);
 *  2) subproductos: su saco especial (Arrocillo → Saco Usado, Polvillo → Saco Negro);
 *  3) arroz SIN marca (producto terminado a granel): un saco genérico "Saco N LB".
 * Una MARCA (producto empacado) sin saco propio NO cae al genérico: se avisa para
 * que se registre su saco en Configuración.
 * Devuelve null si no hay ninguno registrado (no se descuenta; se avisa).
 */
export async function resolverSaco(
  client: PoolClient,
  producto: { id: string; code?: string | null; name?: string | null; product_type?: string | null },
  pesoLb: number
): Promise<SacoRow | null> {
  const cols = `id, tipo, stock::float AS stock, categoria, marca, peso_lb::float AS peso_lb, product_id,
                precio_venta_cliente::float AS precio_venta_cliente, COALESCE(precio_compra_default, 0)::float AS precio_compra_default`;
  const marca = await client.query(
    `SELECT ${cols} FROM sack_inventory WHERE activo AND product_id = $1 AND peso_lb = $2 LIMIT 1`,
    [producto.id, pesoLb]
  );
  if (marca.rowCount) return marca.rows[0];
  const especial = tipoSacoEspecial(producto.code, producto.name);
  if (especial) {
    const r = await client.query(`SELECT ${cols} FROM sack_inventory WHERE activo AND tipo = $1 LIMIT 1`, [especial]);
    if (r.rowCount) return r.rows[0];
  }
  const tipoProducto = producto.product_type
    ?? (await client.query("SELECT product_type FROM products WHERE id = $1", [producto.id])).rows[0]?.product_type;
  if (tipoProducto === "PACKAGED_GOOD") return null; // marca sin saco propio
  const generico = await client.query(
    `SELECT ${cols} FROM sack_inventory WHERE activo AND categoria = 'GENERICO' AND peso_lb = $1 LIMIT 1`,
    [pesoLb]
  );
  return generico.rowCount ? generico.rows[0] : null;
}

type MovRef = { refOrder?: string | null; refBatch?: string | null };

/** Descuenta `cantidad` sacos (SALIDA en el kárdex). Permite saldo negativo. */
async function registrarSalida(client: PoolClient, sackId: string, cantidad: number, concepto: string, ref: MovRef) {
  const upd = await client.query(
    "UPDATE sack_inventory SET stock = stock - $2, updated_at = now() WHERE id = $1 RETURNING stock::float AS stock",
    [sackId, cantidad]
  );
  await client.query(
    `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_order, ref_batch)
     VALUES ($1, 'SALIDA', $2, $3, $4, $5)`,
    [sackId, cantidad, concepto, ref.refOrder ?? null, ref.refBatch ?? null]
  );
  return Number(upd.rows[0]?.stock ?? 0);
}

export type ResultadoSacos = {
  descontados: Array<{ tipo: string; sacos: number; nuevo_stock: number }>;
  sin_saco: Array<{ producto: string; peso_lb: number; sacos: number }>;
};

/**
 * Descuenta los sacos de un PEDIDO al confirmar su preparación. IDEMPOTENTE: si
 * el pedido ya tiene sacos netos descontados, no vuelve a descontar.
 */
export async function descontarSacosPedido(client: PoolClient, orderId: string): Promise<ResultadoSacos> {
  const out: ResultadoSacos = { descontados: [], sin_saco: [] };
  const ya = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN movement = 'SALIDA' THEN cantidad ELSE -cantidad END), 0)::float AS neto
     FROM sack_movements WHERE ref_order = $1`,
    [orderId]
  );
  if (Number(ya.rows[0]?.neto) > 0) return out;

  const order = await client.query("SELECT order_number FROM sales_orders WHERE id = $1", [orderId]);
  const numero = order.rows[0]?.order_number ?? orderId;
  const items = await client.query(
    `SELECT i.product_id, i.presentation_id, i.presentation_name, i.quantity::float AS quantity, p.code, p.name, p.product_type
     FROM sales_order_items i JOIN products p ON p.id = i.product_id
     WHERE i.order_id = $1`,
    [orderId]
  );
  // Agrupa por saco para registrar un solo movimiento por tipo.
  const porSaco = new Map<string, { saco: SacoRow; sacos: number }>();
  for (const it of items.rows) {
    const peso = await pesoDePresentacion(client, it.presentation_id, it.presentation_name);
    const sacos = sacosParaQq(Number(it.quantity), peso);
    if (!sacos) continue;
    const saco = await resolverSaco(client, { id: it.product_id, code: it.code, name: it.name, product_type: it.product_type }, peso);
    if (!saco) {
      out.sin_saco.push({ producto: it.name, peso_lb: peso, sacos });
      continue;
    }
    const acc = porSaco.get(saco.id) ?? { saco, sacos: 0 };
    acc.sacos += sacos;
    porSaco.set(saco.id, acc);
  }
  for (const [sackId, { saco, sacos }] of porSaco) {
    const nuevo = await registrarSalida(client, sackId, sacos, `Venta · Pedido ${numero}`, { refOrder: orderId });
    out.descontados.push({ tipo: saco.tipo, sacos, nuevo_stock: nuevo });
  }
  return out;
}

/**
 * Devuelve al inventario los sacos netos que descontó un pedido (al revertir la
 * preparación o anular el pedido). Idempotente: si el neto ya es 0, no hace nada.
 */
export async function restaurarSacosPedido(client: PoolClient, orderId: string): Promise<number> {
  const netos = await client.query(
    `SELECT sm.sack_id, SUM(CASE WHEN sm.movement = 'SALIDA' THEN sm.cantidad ELSE -sm.cantidad END)::float AS neto,
            (SELECT order_number FROM sales_orders WHERE id = $1) AS numero
     FROM sack_movements sm WHERE sm.ref_order = $1
     GROUP BY sm.sack_id
     HAVING SUM(CASE WHEN sm.movement = 'SALIDA' THEN sm.cantidad ELSE -sm.cantidad END) > 0`,
    [orderId]
  );
  for (const row of netos.rows) {
    await client.query("UPDATE sack_inventory SET stock = stock + $2, updated_at = now() WHERE id = $1", [row.sack_id, row.neto]);
    await client.query(
      `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_order)
       VALUES ($1, 'ENTRADA', $2, $3, $4)`,
      [row.sack_id, row.neto, `Devolución · Pedido ${row.numero ?? orderId} (preparación revertida o anulado)`, orderId]
    );
  }
  return netos.rowCount ?? 0;
}

/**
 * SERVICIO DE PILADA con sacos de la planta: descuenta los sacos elegidos y
 * devuelve el monto a cobrar al cliente (cantidad × precio al cliente del saco).
 */
export async function descontarSacosServicio(
  client: PoolClient,
  lineas: Array<{ sack_id: string; cantidad: number }>,
  opts: { concepto: string; processingBatchId: string }
): Promise<{ detalle: Array<{ tipo: string; sacos: number; precio: number; subtotal: number; nuevo_stock: number }>; total: number }> {
  const detalle: Array<{ tipo: string; sacos: number; precio: number; subtotal: number; nuevo_stock: number }> = [];
  for (const l of lineas) {
    const cantidad = Math.round(Number(l.cantidad));
    if (!(cantidad > 0)) continue;
    const s = await client.query(
      "SELECT id, tipo, precio_venta_cliente::float AS precio FROM sack_inventory WHERE id = $1 AND activo FOR UPDATE",
      [l.sack_id]
    );
    if (!s.rowCount) throw new ApiError(404, "El saco elegido para el servicio no existe o está desactivado.");
    const precio = Number(s.rows[0].precio) || 0;
    const nuevo = await registrarSalida(client, l.sack_id, cantidad, opts.concepto, { refBatch: opts.processingBatchId });
    detalle.push({ tipo: s.rows[0].tipo, sacos: cantidad, precio, subtotal: round2(cantidad * precio), nuevo_stock: nuevo });
  }
  return { detalle, total: round2(detalle.reduce((a, d) => a + d.subtotal, 0)) };
}
