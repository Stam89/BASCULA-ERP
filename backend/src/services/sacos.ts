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
export function planDeSacos(
  qq: number,
  pesoPresentacion: number,
  tamanos: number[],
  sobranteSacoLb?: number | null
): Array<{ peso: number; sacos: number }> {
  const tam = [...new Set(tamanos.filter((t) => t > 0))].sort((a, b) => a - b);
  if (!(qq > 0) || !(pesoPresentacion > 0) || !tam.length) return [];
  const cabe = (lb: number) => tam.find((t) => t >= lb - 1e-6) ?? tam[tam.length - 1];
  const totalLb = Math.round(qq * 100 * 1000) / 1000;
  const llenos = Math.floor(totalLb / pesoPresentacion + 1e-6);
  const sobrante = Math.round((totalLb - llenos * pesoPresentacion) * 1000) / 1000;
  const plan = new Map<number, number>();
  if (llenos > 0) plan.set(cabe(pesoPresentacion), llenos);
  if (sobrante > 0.01) {
    // El CLIENTE puede pedir el sobrante en otro saco de la marca: se usan los
    // que hagan falta (12 lb en sacos de 10 LB → 2). Si ese saco ya no existe,
    // se vuelve a la regla automática.
    const elegido = sobranteSacoLb && tam.includes(Number(sobranteSacoLb)) ? Number(sobranteSacoLb) : null;
    const t = elegido ?? cabe(sobrante);
    const n = elegido ? Math.ceil(sobrante / elegido - 1e-9) : 1;
    plan.set(t, (plan.get(t) ?? 0) + n);
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
  // Ventas y producción usan SOLO el catálogo de la Matriz (accionista_id NULL);
  // los sacos propios de un socio (envejecido) nunca se tocan desde aquí.
  const marca = await client.query(`SELECT ${COLS_SACO} FROM sack_inventory WHERE activo AND accionista_id IS NULL AND product_id = $1`, [producto.id]);
  if (marca.rowCount) return { modo: "MARCA", sacos: marca.rows };
  const especial = tipoSacoEspecial(producto.code, producto.name);
  if (especial) {
    const r = await client.query(`SELECT ${COLS_SACO} FROM sack_inventory WHERE activo AND accionista_id IS NULL AND tipo = $1 LIMIT 1`, [especial]);
    if (r.rowCount) return { modo: "ESPECIAL", sacos: r.rows };
  }
  const tipoProducto = producto.product_type
    ?? (await client.query("SELECT product_type FROM products WHERE id = $1", [producto.id])).rows[0]?.product_type;
  if (tipoProducto === "PACKAGED_GOOD") return null; // marca sin sacos propios
  const generico = await client.query(`SELECT ${COLS_SACO} FROM sack_inventory WHERE activo AND accionista_id IS NULL AND categoria = 'GENERICO' AND peso_lb > 0`);
  return generico.rowCount ? { modo: "GENERICO", sacos: generico.rows } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SACOS RECUPERADOS (Nómina → Cuadrilla, actividad «CAMBIO DE SACO»): los sacos
// que se sacan al cambiarle el saco al arroz. Si se guardan en bodega (segunda /
// usados) entran a un tipo APARTE «<tipo> (Usado)», categoría USADO, con la misma
// marca/calidad/peso pero SIN product_id: así nunca se mezclan con los nuevos ni
// los toma el empaque de una venta (sacosCandidatos busca por product_id).
// ─────────────────────────────────────────────────────────────────────────────

/** El tipo «(Usado)» de un saco del catálogo de la planta (lo crea si no existe). */
export async function sacoUsadoDe(client: PoolClient, sackId: string): Promise<{ id: string; tipo: string }> {
  const o = (await client.query(
    "SELECT id, tipo, marca, calidad, peso_lb, categoria FROM sack_inventory WHERE id = $1 AND accionista_id IS NULL",
    [sackId]
  )).rows[0];
  if (!o) throw new ApiError(404, "Ese saco no está en el catálogo de sacos de la planta.");
  if (o.categoria === "USADO") return { id: o.id, tipo: o.tipo };
  const tipo = `${String(o.tipo).trim()} (Usado)`;
  const ya = (await client.query(
    "SELECT id, tipo, activo FROM sack_inventory WHERE categoria = 'USADO' AND accionista_id IS NULL AND lower(tipo) = lower($1) LIMIT 1",
    [tipo]
  )).rows[0];
  if (ya) {
    if (!ya.activo) await client.query("UPDATE sack_inventory SET activo = true, updated_at = now() WHERE id = $1", [ya.id]);
    return { id: ya.id, tipo: ya.tipo };
  }
  return (await client.query(
    `INSERT INTO sack_inventory (tipo, stock, categoria, marca, calidad, peso_lb, product_id, stock_minimo, precio_compra_default, precio_venta_cliente, accionista_id)
     VALUES ($1, 0, 'USADO', $2, $3, $4, NULL, 0, 0, 0, NULL) RETURNING id, tipo`,
    [tipo, o.marca, o.calidad, o.peso_lb]
  )).rows[0];
}

/** ENTRADA de sacos recuperados a su tipo «(Usado)», enlazada al registro de cuadrilla. */
export async function registrarSacosRecuperados(
  client: PoolClient,
  o: { sackId: string; cantidad: number; entryId: string; concepto: string }
): Promise<{ saco_usado_id: string; tipo: string; cantidad: number; stock: number }> {
  const usado = await sacoUsadoDe(client, o.sackId);
  const cantidad = round2(o.cantidad);
  const upd = await client.query(
    "UPDATE sack_inventory SET stock = stock + $2, updated_at = now() WHERE id = $1 RETURNING stock::float AS stock",
    [usado.id, cantidad]
  );
  await client.query(
    "INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_cuadrilla) VALUES ($1, 'ENTRADA', $2, $3, $4)",
    [usado.id, cantidad, o.concepto, o.entryId]
  );
  return { saco_usado_id: usado.id, tipo: usado.tipo, cantidad, stock: Number(upd.rows[0]?.stock ?? 0) };
}

/** Revierte (SALIDA) los sacos usados que entraron por un registro de cuadrilla. Idempotente. */
export async function revertirSacosRecuperados(client: PoolClient, entryId: string, motivo: string): Promise<number> {
  const netos = await client.query(
    `SELECT sack_id, SUM(CASE WHEN movement = 'ENTRADA' THEN cantidad ELSE -cantidad END)::float AS neto
       FROM sack_movements WHERE ref_cuadrilla = $1
      GROUP BY sack_id HAVING SUM(CASE WHEN movement = 'ENTRADA' THEN cantidad ELSE -cantidad END) > 0`,
    [entryId]
  );
  for (const r of netos.rows) {
    await client.query("UPDATE sack_inventory SET stock = stock - $2, updated_at = now() WHERE id = $1", [r.sack_id, r.neto]);
    await client.query(
      "INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_cuadrilla) VALUES ($1, 'SALIDA', $2, $3, $4)",
      [r.sack_id, r.neto, motivo, entryId]
    );
  }
  return netos.rowCount ?? 0;
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
  const plan = await planSacosPedido(client, orderId);
  out.sin_saco.push(...plan.sin_saco);
  for (const [sackId, { saco, sacos }] of plan.porSaco) {
    const nuevo = await registrarSalida(client, sackId, sacos, `Venta · Pedido ${numero}`, { refOrder: orderId });
    out.descontados.push({ tipo: saco.tipo, sacos, nuevo_stock: nuevo });
  }
  return out;
}

/**
 * Sacos que ocupará un pedido (por tipo de saco), con la misma regla que se
 * descuenta al Confirmar Preparación. Solo calcula: no mueve inventario.
 */
export async function planSacosPedido(client: PoolClient, orderId: string): Promise<{
  porSaco: Map<string, { saco: SacoRow; sacos: number }>;
  sin_saco: Array<{ producto: string; peso_lb: number; sacos: number }>;
}> {
  const sin_saco: Array<{ producto: string; peso_lb: number; sacos: number }> = [];
  const items = await client.query(
    `SELECT i.product_id, i.presentation_id, i.presentation_name, i.quantity::float AS quantity,
            i.sobrante_saco_lb::float AS sobrante_saco_lb, p.code, p.name, p.product_type
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
    // El ARROZ ENVEJECIDO se empaca en los sacos PROPIOS del socio al recibir el
    // envejecido (Selección): al venderlo no se descuenta otro saco de la Matriz.
    if (String(it.code ?? "").toUpperCase() === "ARROZ-ENVEJECIDO") continue;
    const qq = Number(it.quantity);
    const peso = await pesoDePresentacion(client, it.presentation_id, it.presentation_name);
    if (!sacosParaQq(qq, peso)) continue;
    const cand = await sacosCandidatos(client, { id: it.product_id, code: it.code, name: it.name, product_type: it.product_type });
    if (!cand) {
      sin_saco.push({ producto: it.name, peso_lb: peso, sacos: sacosParaQq(qq, peso) });
      continue;
    }
    if (cand.modo === "ESPECIAL") { // saco de subproducto: uno por bulto
      sumar(cand.sacos[0], sacosParaQq(qq, peso));
      continue;
    }
    // Marca o genérico: plan de empaque con los tamaños registrados.
    const porPeso = new Map(cand.sacos.map((sk) => [Number(sk.peso_lb), sk]));
    for (const { peso: pesoSaco, sacos } of planDeSacos(qq, peso, [...porPeso.keys()], it.sobrante_saco_lb)) {
      sumar(porPeso.get(pesoSaco)!, sacos);
    }
  }
  return { porSaco, sin_saco };
}

export type SacoPorComprar = { id: string; tipo: string; stock: number; necesarios: number; faltan: number; pedidos: string[] };

/**
 * SACOS POR COMPRAR (alerta del Dashboard): los que piden los pedidos pendientes
 * que aún no se preparan, contra el stock de la bodega de la Matriz. Incluye los
 * que ya están en negativo. Nunca bloquea al vendedor: solo avisa la compra.
 */
export async function sacosPorComprar(client: PoolClient): Promise<SacoPorComprar[]> {
  const pendientes = await client.query(
    `SELECT id, order_number FROM sales_orders
      WHERE status = 'PENDING' AND prepared_at IS NULL ORDER BY created_at`
  );
  const necesidad = new Map<string, { necesarios: number; pedidos: string[] }>();
  for (const o of pendientes.rows) {
    const plan = await planSacosPedido(client, o.id);
    for (const [sackId, { sacos }] of plan.porSaco) {
      const acc = necesidad.get(sackId) ?? { necesarios: 0, pedidos: [] };
      acc.necesarios += sacos;
      if (!acc.pedidos.includes(o.order_number)) acc.pedidos.push(o.order_number);
      necesidad.set(sackId, acc);
    }
  }
  const sacos = await client.query(
    `SELECT id, tipo, stock::float AS stock FROM sack_inventory
      WHERE activo AND accionista_id IS NULL AND (stock < 0 OR id = ANY($1::uuid[]))`,
    [[...necesidad.keys()]]
  );
  return sacos.rows
    .map((s: { id: string; tipo: string; stock: number }) => {
      const n = necesidad.get(s.id);
      const necesarios = n?.necesarios ?? 0;
      return { id: s.id, tipo: s.tipo, stock: Number(s.stock), necesarios, faltan: Math.max(0, necesarios - Number(s.stock)), pedidos: n?.pedidos ?? [] };
    })
    .filter((s: SacoPorComprar) => s.faltan > 0)
    .sort((a: SacoPorComprar, b: SacoPorComprar) => b.faltan - a.faltan);
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
      "SELECT id, tipo, precio_venta_cliente::float AS precio FROM sack_inventory WHERE id = $1 AND activo AND accionista_id IS NULL FOR UPDATE",
      [l.sack_id]
    );
    if (!s.rowCount) throw new ApiError(404, "El saco elegido para el servicio no existe o está desactivado.");
    const precio = Number(s.rows[0].precio) || 0;
    const nuevo = await registrarSalida(client, l.sack_id, cantidad, opts.concepto, { refBatch: opts.processingBatchId });
    detalle.push({ tipo: s.rows[0].tipo, sacos: cantidad, precio, subtotal: round2(cantidad * precio), nuevo_stock: nuevo });
  }
  return { detalle, total: round2(detalle.reduce((a, d) => a + d.subtotal, 0)) };
}
