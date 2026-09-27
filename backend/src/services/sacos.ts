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
 * PLAN DE EMPAQUE (regla física de la planta): cada BULTO de la presentación va en
 * el saco MÁS PEQUEÑO registrado donde cabe; si el total no es múltiplo exacto,
 * el SOBRANTE va en el saco más pequeño que lo contiene.
 *   · 10 QQ en 50 LB sin saco de 50 → 20 bultos × saco 100 LB.
 *   · 100 QQ en 98 LB → 10.000 lb = 102 bultos (9.996 lb) en saco 100 LB
 *                        + sobrante 4 lb en 1 saco de 10 LB.
 * `tamanos` = pesos de saco disponibles (activos) para ese producto.
 */
export function planDeSacos(qq: number, pesoPresentacion: number, tamanos: number[]): Array<{ peso: number; sacos: number }> {
  const tam = [...new Set(tamanos.filter((t) => t > 0))].sort((a, b) => a - b);
  if (!(qq > 0) || !(pesoPresentacion > 0) || !tam.length) return [];
  const cabe = (lb: number) => tam.find((t) => t >= lb - 1e-6) ?? tam[tam.length - 1];
  const totalLb = Math.round(qq * 100 * 1000) / 1000;
  const llenos = Math.floor(totalLb / pesoPresentacion + 1e-6);
  const sobrante = Math.round((totalLb - llenos * pesoPresentacion) * 1000) / 1000;
  const plan = new Map<number, number>();
  if (llenos > 0) plan.set(cabe(pesoPresentacion), llenos);
  if (sobrante > 0.01) {
    const t = cabe(sobrante);
    plan.set(t, (plan.get(t) ?? 0) + 1);
  }
  return [...plan.entries()].map(([peso, sacos]) => ({ peso, sacos })).sort((a, b) => b.peso - a.peso);
}

const COLS_SACO = `id, tipo, stock::float AS stock, categoria, marca, peso_lb::float AS peso_lb, product_id,
                precio_venta_cliente::float AS precio_venta_cliente, COALESCE(precio_compra_default, 0)::float AS precio_compra_default`;

/**
 * Sacos candidatos (activos) para empacar un producto vendido:
 *  1) MARCA: los sacos de esa marca (Flor 100/25/10 LB…);
 *  2) subproductos: su saco especial (Arrocillo → Saco Usado, Polvillo → Saco Negro);
 *  3) arroz SIN marca (producto terminado a granel): los genéricos "Saco N LB".
 * Una MARCA sin sacos propios NO cae al genérico (se avisa para registrarlos).
 */
export async function sacosCandidatos(
  client: PoolClient,
  producto: { id: string; code?: string | null; name?: string | null; product_type?: string | null }
): Promise<{ modo: "MARCA" | "ESPECIAL" | "GENERICO"; sacos: SacoRow[] } | null> {
  const marca = await client.query(`SELECT ${COLS_SACO} FROM sack_inventory WHERE activo AND product_id = $1`, [producto.id]);
  if (marca.rowCount) return { modo: "MARCA", sacos: marca.rows };
  const especial = tipoSacoEspecial(producto.code, producto.name);
  if (especial) {
    const r = await client.query(`SELECT ${COLS_SACO} FROM sack_inventory WHERE activo AND tipo = $1 LIMIT 1`, [especial]);
    if (r.rowCount) return { modo: "ESPECIAL", sacos: r.rows };
  }
  const tipoProducto = producto.product_type
    ?? (await client.query("SELECT product_type FROM products WHERE id = $1", [producto.id])).rows[0]?.product_type;
  if (tipoProducto === "PACKAGED_GOOD") return null; // marca sin sacos propios
  const generico = await client.query(`SELECT ${COLS_SACO} FROM sack_inventory WHERE activo AND categoria = 'GENERICO' AND peso_lb > 0`);
  return generico.rowCount ? { modo: "GENERICO", sacos: generico.rows } : null;
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
  const sumar = (saco: SacoRow, sacos: number) => {
    const acc = porSaco.get(saco.id) ?? { saco, sacos: 0 };
    acc.sacos += sacos;
    porSaco.set(saco.id, acc);
  };
  for (const it of items.rows) {
    const qq = Number(it.quantity);
    const peso = await pesoDePresentacion(client, it.presentation_id, it.presentation_name);
    if (!sacosParaQq(qq, peso)) continue;
    const cand = await sacosCandidatos(client, { id: it.product_id, code: it.code, name: it.name, product_type: it.product_type });
    if (!cand) {
      out.sin_saco.push({ producto: it.name, peso_lb: peso, sacos: sacosParaQq(qq, peso) });
      continue;
    }
    if (cand.modo === "ESPECIAL") { // saco de subproducto: uno por bulto
      sumar(cand.sacos[0], sacosParaQq(qq, peso));
      continue;
    }
    // Marca o genérico: plan de empaque con los tamaños registrados.
    const porPeso = new Map(cand.sacos.map((sk) => [Number(sk.peso_lb), sk]));
    for (const { peso: pesoSaco, sacos } of planDeSacos(qq, peso, [...porPeso.keys()])) {
      sumar(porPeso.get(pesoSaco)!, sacos);
    }
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
