import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { exigirCajaAbiertaDelAccionista } from "../../services/caja.js";
import { nextCode } from "../../utils/codes.js";
import { round2 } from "../../utils/rice-formulas.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { crearVenta } from "./sales.js";
import { cobrarEmpaqueAlDespachar } from "../../services/cargo-empaque.js";
import { descontarSacosPedido, restaurarSacosPedido, type ResultadoSacos } from "../../services/sacos.js";
import { revertCuadrillaDespachoVentaEntry, upsertCuadrillaDespachoVentaEntry } from "./cuadrilla.js";
import { consumeInventoryFIFO } from "../../services/inventory-consume.js";
import { traerDesdeAlla } from "../../services/traer-alla.js";
import { validarFleteRegreso, type FleteEnvejecido } from "../../services/campo-flete-envejecido.js";
import { calculateOrderStockCoverage, CODIGOS_CASCARA, rawBackingCode, RENDIMIENTO_SUBPRODUCTO_DEFECTO, subproductoEsperadoQq } from "../../utils/order-stock-coverage.js";
import { quitarFleteVenta, registrarFleteVenta, validarFleteVenta } from "../../services/campo-flete-venta.js";
import { notificar } from "../../services/notificaciones.js";
import { getMatrizId } from "../../services/matriz.js";

export const ordersRouter = Router();

// Venta en dos tiempos (preventa): primero se TOMA EL PEDIDO —una promesa,
// sin mover inventario ni plata— y después se DESPACHA Y COBRA, momento en el
// que nace la venta real. El despacho reusa crearVenta, la misma lógica de la
// venta directa, para que ambas hagan exactamente lo mismo.

const orderItemSchema = z.object({
  product_id: z.string().uuid(),
  presentation_id: z.string().uuid().optional(),
  presentation_name: z.string().optional(),
  inventory_product_id: z.string().uuid(),
  quantity: z.number().positive(),
  unit_price: z.number().nonnegative(),
  // Saco que pidió el cliente para el SOBRANTE (lb). Vacío = automático.
  sobrante_saco_lb: z.number().positive().nullable().optional(),
  // ARROZ ENVEJECIDO: saco PROPIO del socio que vende (Cecibel…) → se descuenta al preparar.
  // Vacío = en el saco del proveedor (no descuenta).
  sack_id: z.string().uuid().nullable().optional()
});

// El saco propio de una línea debe ser del socio que vende y solo aplica al Arroz Envejecido.
async function validarSacosPropiosDelPedido(
  client: PoolClient, accionistaId: string | undefined, items: Array<{ product_id: string; sack_id?: string | null }>
): Promise<void> {
  for (const it of items) {
    if (!it.sack_id) continue;
    const p = (await client.query("SELECT code FROM products WHERE id = $1", [it.product_id])).rows[0];
    if (String(p?.code ?? "").toUpperCase() !== "ARROZ-ENVEJECIDO") throw new ApiError(400, "El saco propio solo se escoge para el Arroz Envejecido.");
    const s = (await client.query(
      "SELECT 1 FROM sack_inventory WHERE id = $1 AND accionista_id = $2 AND categoria = 'PROPIO' AND activo", [it.sack_id, accionistaId ?? null]
    )).rowCount;
    if (!s) throw new ApiError(400, "Ese saco no es de los sacos propios del socio que vende.");
  }
}

ordersRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT o.*, c.full_name AS customer_name, c.phone AS customer_phone,
            c.identification AS customer_identification, c.address AS customer_address,
            s.sale_number,
            fa.nombre AS flete_activo_nombre,
            (SELECT GREATEST(0, cs.valor - COALESCE(v.saldo_pendiente, cs.valor))::float
               FROM campo_servicios cs LEFT JOIN campo_servicios_saldo v ON v.id = cs.id
              WHERE cs.id = o.flete_servicio_id) AS flete_cobrado,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'product_id', i.product_id,
                       'inventory_product_id', i.inventory_product_id,
                       'presentation_name', i.presentation_name,
                       'sobrante_saco_lb', i.sobrante_saco_lb,
                       'quantity', i.quantity,
                       'unit_price', i.unit_price,
                       'total', i.total,
                       'product_name', p.name
                     ) ORDER BY p.name)
              FROM sales_order_items i
              JOIN products p ON p.id = i.product_id
              WHERE i.order_id = o.id
            ), '[]'::json) AS items
     FROM sales_orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN sales s ON s.id = o.sale_id
     LEFT JOIN campo_activos fa ON fa.id = o.flete_activo_id
     WHERE o.accionista_id = $1
     ORDER BY (o.status = 'PENDING') DESC, o.created_at DESC
     LIMIT 200`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// COLA DE DESPACHOS GLOBAL: los pedidos PENDIENTES de TODOS los accionistas, para
// que bodega vea todo lo que hay que cargar sin importar qué socio esté vendiendo.
// Cada pedido trae su dueño y el stock propio del dueño de los productos que pide
// (para la pista de picking). Las acciones sobre un pedido se envían en nombre de
// su dueño (X-Accionista-Id), así siguen validando permisos y caja de ese socio.
// Desde 2026-10-21: TODOS solo en la MATRIZ (ahí trabaja bodega); en un socio, solo SUS pedidos.
ordersRouter.get("/cola-global", asyncRoute(async (req, res) => {
  const activo = (req as AuthenticatedRequest).accionistaId ?? null;
  const soloDe = activo && activo !== (await getMatrizId()) ? activo : null;
  const result = await pool.query(
    `SELECT o.*, c.full_name AS customer_name, c.phone AS customer_phone,
            c.identification AS customer_identification, c.address AS customer_address,
            a.name AS accionista_name, a.tipo AS accionista_tipo,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'product_id', i.product_id,
                       'inventory_product_id', i.inventory_product_id,
                       'presentation_name', i.presentation_name,
                       'sobrante_saco_lb', i.sobrante_saco_lb,
                       'quantity', i.quantity,
                       'unit_price', i.unit_price,
                       'total', i.total,
                       'product_name', p.name
                     ) ORDER BY p.name)
              FROM sales_order_items i
              JOIN products p ON p.id = i.product_id
              WHERE i.order_id = o.id
            ), '[]'::json) AS items,
            COALESCE((
              SELECT json_object_agg(x.product_id, x.qq) FROM (
                SELECT m.product_id, SUM(m.quantity)::float AS qq
                  FROM inventory_movements m
                 WHERE m.accionista_id = o.accionista_id AND m.ownership = 'OWNED'
                   -- Incluye lo que quedó ALLÁ (selección/envejecido): con el informe ya se puede vender y el
                   -- transportista lo retira allá. Su detalle va en alla_dueno.
                   AND m.product_id IN (SELECT i.inventory_product_id FROM sales_order_items i WHERE i.order_id = o.id)
                 GROUP BY m.product_id
              ) x
            ), '{}'::json) AS stock_dueno,
            COALESCE((
              SELECT json_agg(json_build_object('product_id', x.product_id, 'bodega', x.bodega, 'qq', x.qq) ORDER BY x.bodega)
                FROM (
                SELECT m.product_id, w.name AS bodega, SUM(m.quantity)::float AS qq
                  FROM inventory_movements m JOIN warehouses w ON w.id = m.warehouse_id AND w.type = 'EXTERNO'
                 WHERE m.accionista_id = o.accionista_id AND m.ownership = 'OWNED'
                   AND m.product_id IN (SELECT i.inventory_product_id FROM sales_order_items i WHERE i.order_id = o.id)
                 GROUP BY m.product_id, w.name
                HAVING SUM(m.quantity) > 0.0005
              ) x
            ), '[]'::json) AS alla_dueno,
            COALESCE((
              SELECT json_agg(json_build_object('product_id', x.product_id, 'bodega', x.bodega, 'qq', x.qq) ORDER BY x.bodega)
                FROM (
                SELECT m.product_id, w.name AS bodega, (-SUM(m.quantity))::float AS qq
                  FROM inventory_movements m JOIN warehouses w ON w.id = m.warehouse_id AND w.type = 'EXTERNO'
                 WHERE m.reference_type = 'sales_order' AND m.reference_id = o.id AND m.movement = 'OUT'
                 GROUP BY m.product_id, w.name
              ) x
            ), '[]'::json) AS retirado_alla
     FROM sales_orders o
     JOIN customers c ON c.id = o.customer_id
     JOIN accionistas a ON a.id = o.accionista_id
     WHERE o.status = 'PENDING' AND ($1::uuid IS NULL OR o.accionista_id = $1::uuid)
     ORDER BY o.delivery_date NULLS LAST, o.created_at
     LIMIT 500`,
    [soloDe]
  );
  res.json(result.rows);
}));

// Precio sugerido para una marca+presentación: el ÚLTIMO precio unitario al que
// se vendió/pidió esa combinación para el accionista activo. Es una sugerencia
// editable (no una tarifa fija); si nunca se ha pedido, devuelve null y la UI
// deja el precio en blanco. Se registra en /suggest-price ANTES de /:id para que
// la ruta literal no la capture el parámetro.
ordersRouter.get("/suggest-price", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const productId = typeof req.query.product_id === "string" ? req.query.product_id : null;
  const presentationId = typeof req.query.presentation_id === "string" ? req.query.presentation_id : null;
  if (!productId) throw new ApiError(400, "Falta product_id");
  const r = await pool.query(
    `SELECT i.unit_price
       FROM sales_order_items i
       JOIN sales_orders o ON o.id = i.order_id
      WHERE o.accionista_id = $1
        AND i.product_id = $2
        AND ($3::uuid IS NULL OR i.presentation_id = $3::uuid)
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [accionistaId, productId, presentationId]
  );
  res.json({ unit_price: r.rowCount ? Number(r.rows[0].unit_price) : null });
}));

// Rendimiento de subproductos por QQ de cáscara (para que la pantalla de pedidos muestre el mismo respaldo).
ordersRouter.get("/rendimiento-subproductos", asyncRoute(async (_req, res) => {
  res.json(await rendimientoSubproductos(pool));
}));

ordersRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    customer_id: z.string().uuid(),
    delivery_date: z.string().optional(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional(),
    // Forma de pago acordada al tomar el pedido (la Cola la trae puesta al despachar).
    payment_method: z.enum(["CASH", "TRANSFER", "CARD", "CHECK", "CREDIT"]).optional(),
    items: z.array(orderItemSchema).min(1),
    // 📴 Pedido tomado SIN CONEXIÓN en el celular: llave única del celular (si el envío se repite, se devuelve el
    // mismo pedido) y cuándo se tomó.
    client_key: z.string().trim().min(8).max(80).optional(),
    tomado_sin_conexion_at: z.string().datetime({ offset: true }).optional()
  }).parse(req.body);

  if (body.client_key) {
    const ya = (await pool.query("SELECT * FROM sales_orders WHERE client_key = $1", [body.client_key])).rows[0];
    if (ya) { res.status(200).json({ ...ya, repetido: true }); return; }
  }

  const result = await inTransaction(async (client) => {
    // Dos envíos del mismo pedido a la vez: el segundo espera al primero y devuelve el suyo.
    if (body.client_key) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pedido:${body.client_key}`]);
    if (body.client_key) {
      const ya = (await client.query("SELECT * FROM sales_orders WHERE client_key = $1", [body.client_key])).rows[0];
      if (ya) return { ...ya, repetido: true };
    }
    await validarSacosPropiosDelPedido(client, accionistaId, body.items);
    await validarRespaldoDelPedido(client, accionistaId, body.items);
    const total = round2(body.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
    const order = await client.query(
      `INSERT INTO sales_orders (order_number, customer_id, accionista_id, delivery_date, notes, total_amount, created_by, payment_method, client_key, tomado_sin_conexion_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [nextCode("PED"), body.customer_id, accionistaId, body.delivery_date ?? null, body.notes ?? null, total, body.created_by ?? null, body.payment_method ?? null,
       body.client_key ?? null, body.tomado_sin_conexion_at ?? null]
    );
    for (const item of body.items) {
      await client.query(
        `INSERT INTO sales_order_items
         (order_id, product_id, presentation_id, presentation_name, inventory_product_id, quantity, unit_price, total, sobrante_saco_lb, sack_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          order.rows[0].id, item.product_id, item.presentation_id ?? null, item.presentation_name ?? null,
          item.inventory_product_id, item.quantity, item.unit_price, round2(item.quantity * item.unit_price),
          item.sobrante_saco_lb ?? null, item.sack_id ?? null
        ]
      );
    }
    await crearCobroDelPedido(client, order.rows[0], accionistaId);
    await avisarPedidoNuevo(client, order.rows[0], accionistaId);
    return order.rows[0];
  });

  res.status((result as { repetido?: boolean }).repetido ? 200 : 201).json(result);
}));

// 🔔 Pedido nuevo → aviso en la campanita de la MATRIZ (ahí está la Cola de Despachos y el encargado de
// bodega que lo prepara y despacha), venga de la Matriz o de un socio. Al tocarlo abre la Cola.
async function avisarPedidoNuevo(
  client: PoolClient,
  order: { id: string; order_number: string; customer_id: string; delivery_date: string | Date | null; total_amount: string | number; tomado_sin_conexion_at?: string | Date | null },
  accionistaId: string | null | undefined
): Promise<void> {
  const matrizId = await getMatrizId(client);
  const cliente = (await client.query("SELECT full_name FROM customers WHERE id = $1", [order.customer_id])).rows[0]?.full_name ?? "cliente";
  const vendedor = accionistaId ? (await client.query("SELECT name, tipo FROM accionistas WHERE id = $1", [accionistaId])).rows[0] : null;
  const lineas = (await client.query(
    `SELECT p.name, i.quantity::float AS qq, i.presentation_name
       FROM sales_order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = $1 ORDER BY i.id`,
    [order.id]
  )).rows as Array<{ name: string; qq: number; presentation_name: string | null }>;
  const totalQq = Math.round(lineas.reduce((s, l) => s + Number(l.qq), 0) * 100) / 100;
  const detalle = lineas.slice(0, 3).map((l) => `${Number(l.qq).toFixed(2)} QQ ${l.name}${l.presentation_name ? ` ${l.presentation_name}` : ""}`).join(", ")
    + (lineas.length > 3 ? ` y ${lineas.length - 3} más` : "");
  const entrega = order.delivery_date ? ` · entrega ${String(order.delivery_date instanceof Date ? order.delivery_date.toISOString() : order.delivery_date).slice(0, 10).split("-").reverse().join("/")}` : "";
  await notificar(client, {
    accionistaId: matrizId,
    tipo: "PEDIDO",
    titulo: `🧾 Pedido nuevo ${order.order_number} · ${totalQq.toFixed(2)} QQ`,
    mensaje: `${vendedor && vendedor.tipo !== "MATRIZ" ? `${vendedor.name} vendió a` : "Para"} ${cliente}: ${detalle}${entrega}. Está en la Cola de Despachos.` +
      (order.tomado_sin_conexion_at ? ` 📴 Se tomó sin conexión el ${new Date(order.tomado_sin_conexion_at).toLocaleString("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}.` : ""),
    monto: Number(order.total_amount),
    referenciaTipo: "sales_orders",
    referenciaId: order.id
  });
}

/**
 * Permite tomar pedidos sin producto terminado solamente cuando el mismo socio
 * dispone de cascara del tipo correspondiente. Los pedidos pendientes tambien
 * consumen cobertura comercial, aunque el inventario fisico solo se descuenta
 * al confirmar la preparacion.
 */
/**
 * Rendimiento de cada SUBPRODUCTO por QQ de cáscara pilada: el real de las piladas de los últimos 180 días
 * (kg de subproducto / kg de cáscara) si hay al menos 3; si no, el normal de piladora (RENDIMIENTO_SUBPRODUCTO_DEFECTO).
 * Con él, un pedido de arrocillo/polvillo/rechazo se respalda con la cáscara del socio (se sacará al pilarla).
 */
export async function rendimientoSubproductos(db: { query: PoolClient["query"] }): Promise<{ rendimientos: Record<string, number>; fuente: "historial" | "normal"; piladas: number }> {
  const r = (await db.query(
    `SELECT count(*)::int AS n,
            SUM(broken_rice_kg)::float AS a34, SUM(fine_broken_rice_kg)::float AS fino, SUM(bran_kg)::float AS pol,
            SUM(input_paddy_kg)::float AS entrada
       FROM production_yields
      WHERE created_at > now() - interval '180 days' AND input_paddy_kg > 0`
  )).rows[0] as { n: number; a34: number | null; fino: number | null; pol: number | null; entrada: number | null };
  const rendimientos = { ...RENDIMIENTO_SUBPRODUCTO_DEFECTO };
  if (Number(r?.n) >= 3 && Number(r.entrada) > 0) {
    const f = (kg: number | null) => Math.round((Number(kg || 0) / Number(r.entrada)) * 10000) / 10000;
    if (Number(r.a34) > 0) rendimientos["ARROCILLO-34"] = f(r.a34);
    if (Number(r.fino) > 0) rendimientos["ARROCILLO-FINO"] = f(r.fino);
    if (Number(r.pol) > 0) rendimientos["POLVILLO"] = f(r.pol);
    return { rendimientos, fuente: "historial", piladas: Number(r.n) };
  }
  return { rendimientos, fuente: "normal", piladas: Number(r?.n ?? 0) };
}

async function validarRespaldoDelPedido(
  client: PoolClient,
  accionistaId: string | undefined,
  items: Array<z.infer<typeof orderItemSchema>>,
  excluirPedidoId?: string
): Promise<void> {
  if (!accionistaId) throw new ApiError(400, "Selecciona el socio que realiza la venta.");

  // Serializa los pedidos del socio para impedir que dos solicitudes reserven
  // simultaneamente el mismo producto o la misma cascara.
  const socio = await client.query("SELECT id FROM accionistas WHERE id = $1 FOR UPDATE", [accionistaId]);
  if (!socio.rowCount) throw new ApiError(404, "El socio seleccionado no existe.");

  const solicitadoPorProducto = new Map<string, number>();
  for (const item of items) {
    solicitadoPorProducto.set(
      item.inventory_product_id,
      round2((solicitadoPorProducto.get(item.inventory_product_id) ?? 0) + Number(item.quantity))
    );
  }

  for (const [productId, solicitadoQq] of [...solicitadoPorProducto.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const producto = await client.query(
      "SELECT id, code, name FROM products WHERE id = $1 AND is_active = true",
      [productId]
    );
    if (!producto.rowCount) throw new ApiError(400, "Uno de los productos del pedido no existe o esta inactivo.");

    const rawCode = rawBackingCode(String(producto.rows[0].code));
    const rawProduct = rawCode
      ? await client.query("SELECT id, name FROM products WHERE code = $1 AND is_active = true", [rawCode])
      : null;

    const stockIds = [productId, rawProduct?.rows[0]?.id].filter(Boolean) as string[];
    const saldos = await client.query(
      `SELECT product_id, COALESCE(SUM(quantity), 0)::float AS quantity
         FROM inventory_movements
        WHERE accionista_id = $1
          AND ownership = 'OWNED'
          AND product_id = ANY($2::uuid[])
          -- Lo que quedó ALLÁ (selección/envejecido con informe) también respalda: se retira allá al despachar.
        GROUP BY product_id`,
      [accionistaId, stockIds]
    );
    const saldoPorProducto = new Map(saldos.rows.map((row) => [String(row.product_id), Number(row.quantity)]));
    const terminadoQq = Math.max(0, saldoPorProducto.get(productId) ?? 0);
    const cascaraQq = rawProduct?.rowCount ? Math.max(0, saldoPorProducto.get(String(rawProduct.rows[0].id)) ?? 0) : 0;

    const pendientes = await client.query(
      `SELECT COALESCE(SUM(i.quantity), 0)::float AS quantity
         FROM sales_order_items i
         JOIN sales_orders o ON o.id = i.order_id
        WHERE o.accionista_id = $1
          AND o.status = 'PENDING'
          AND o.prepared_at IS NULL
          AND i.inventory_product_id = $2
          AND ($3::uuid IS NULL OR o.id <> $3::uuid)`,
      [accionistaId, productId, excluirPedidoId ?? null]
    );
    const pendienteQq = Number(pendientes.rows[0]?.quantity || 0);
    // SUBPRODUCTO (arrocillo, polvillo, rechazo): lo respalda la cáscara del socio (0.11 y corriente) por su
    // rendimiento; al pilarla sale. No se descuenta de la cáscara que respalda el arroz: salen juntos.
    const rendSub = RENDIMIENTO_SUBPRODUCTO_DEFECTO[String(producto.rows[0].code)] != null
      ? (await rendimientoSubproductos(client)).rendimientos[String(producto.rows[0].code)] : null;
    let cascaraSubQq = 0;
    if (rendSub != null && !rawCode) {
      const c = (await client.query(
        `SELECT COALESCE(SUM(m.quantity), 0)::float AS q FROM inventory_movements m JOIN products p ON p.id = m.product_id
          WHERE m.accionista_id = $1 AND m.ownership = 'OWNED' AND p.code = ANY($2::text[])`,
        [accionistaId, CODIGOS_CASCARA]
      )).rows[0];
      cascaraSubQq = Math.max(0, Number(c?.q || 0));
    }
    const subEsperadoQq = rendSub != null ? subproductoEsperadoQq(cascaraSubQq, rendSub) : 0;
    const cobertura = calculateOrderStockCoverage(solicitadoQq, pendienteQq, terminadoQq, rawCode ? cascaraQq : subEsperadoQq);
    if (!cobertura.covered && rendSub != null && !rawCode) {
      throw new ApiError(
        409,
        `Respaldo insuficiente para ${producto.rows[0].name}: los pedidos pendientes mas este pedido requieren ${cobertura.requiredQq.toFixed(2)} QQ. ` +
        `El socio tiene ${round2(terminadoQq).toFixed(2)} QQ terminados y ${round2(cascaraSubQq).toFixed(2)} QQ de cáscara, de la que saldrían unos ` +
        `${subEsperadoQq.toFixed(2)} QQ (${(rendSub * 100).toFixed(1)}% por QQ). Faltan ${cobertura.shortageQq.toFixed(2)} QQ.`
      );
    }
    if (!cobertura.covered) {
      const detalleCascara = rawCode
        ? ` y ${round2(cascaraQq).toFixed(2)} QQ de ${rawProduct?.rows[0]?.name ?? rawCode}`
        : "";
      throw new ApiError(
        409,
        `Respaldo insuficiente para ${producto.rows[0].name}: los pedidos pendientes mas este pedido requieren ${cobertura.requiredQq.toFixed(2)} QQ. El socio tiene ${round2(terminadoQq).toFixed(2)} QQ terminados${detalleCascara}. Faltan ${cobertura.shortageQq.toFixed(2)} QQ.`
      );
    }
  }
}

/**
 * El pedido genera su cuenta por cobrar apenas se toma, sin esperar al
 * despacho: es un compromiso en firme del cliente. Al despacharlo, esa misma
 * cuenta se salda (si pagó) o se mantiene (si queda a crédito), nunca se
 * duplica.
 */
async function crearCobroDelPedido(
  client: import("pg").PoolClient,
  order: { id: string; order_number: string; customer_id: string; total_amount: string | number },
  accionistaId: string | undefined
) {
  const cliente = await client.query("SELECT full_name FROM customers WHERE id = $1", [order.customer_id]);
  const desc = `Pedido ${order.order_number} — ${cliente.rows[0]?.full_name ?? "cliente"} (pendiente de despacho)`;
  const ar = await client.query(
    `INSERT INTO accounts_receivable
     (accionista_id, customer_id, reference_type, reference_id, description, amount, balance)
     VALUES ($1, $2, 'sales_order', $3, $4, $5, $5)
     RETURNING id`,
    [accionistaId, order.customer_id, order.id, desc, Number(order.total_amount)]
  );
  await client.query("UPDATE sales_orders SET receivable_id = $2 WHERE id = $1", [order.id, ar.rows[0].id]);
  return ar.rows[0].id;
}

// ── Descuento de inventario al CONFIRMAR LA PREPARACIÓN de un pedido ──────────
// Rebaja el 'Inventario Comercial' al instante (salida por venta), para reflejar
// el saldo real en bodega antes del despacho. La cantidad del pedido ya está en
// QUINTALES. IDEMPOTENTE: si el pedido ya tiene su salida registrada, no vuelve a
// descontar (evita doble descuento). El despacho posterior usa omitirInventario.
type RetiroAlla = { producto: string; bodega: string; qq: number };

async function descontarInventarioPreparacion(
  client: PoolClient,
  opts: {
    orderId: string; accionistaId: string | undefined; warehouseId: string; createdBy?: string | null;
    // «🏭 Ya está en la piladora»: lo que iba a salir de allá YA llegó (nadie registró el viaje). Se registra el
    // viaje de regreso (allá → piladora, con su flete si lo hubo) y todo sale de la piladora (la cuadrilla lo embarca).
    allaYaLlego?: { flete?: FleteEnvejecido | null; orderNumber?: string } | null;
  }
): Promise<{ retiros: RetiroAlla[]; traidos: RetiroAlla[] }> {
  const ya = await client.query(
    "SELECT 1 FROM inventory_movements WHERE reference_type = 'sales_order' AND reference_id = $1 AND movement = 'OUT' LIMIT 1",
    [opts.orderId]
  );
  if (ya.rowCount) return { retiros: [], traidos: [] }; // ya descontado en una preparación previa
  const retiros: RetiroAlla[] = [];
  const traidos: RetiroAlla[] = [];
  // Viajes por proveedor (si «ya llegó»): bodega «Allá» → productos y QQ.
  const viajes = new Map<string, { bodega: string; items: Array<{ product_id: string; quantity: number; producto: string }> }>();
  const salidasPlan: Array<{ productId: string; nombre: string; warehouseId: string; qq: number; bodega?: string }> = [];

  const items = await client.query(
    "SELECT inventory_product_id, product_id, quantity FROM sales_order_items WHERE order_id = $1",
    [opts.orderId]
  );
  // Agrupa por producto de inventario para validar/descontar una vez por producto.
  const porProducto = new Map<string, number>();
  for (const it of items.rows) {
    const pid = String(it.inventory_product_id ?? it.product_id);
    porProducto.set(pid, round2((porProducto.get(pid) ?? 0) + Number(it.quantity || 0)));
  }
  for (const [productId, qq] of [...porProducto.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!(qq > 0)) continue;
    // Sale primero de la bodega de la piladora; si no alcanza, lo que falta se RETIRA ALLÁ (lo que quedó
    // donde el proveedor de selección/envejecido: el transportista lo recoge allá y lo lleva al cliente).
    const enPiladora = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::float AS q FROM inventory_movements
        WHERE product_id = $1 AND warehouse_id = $2 AND accionista_id = $3 AND ownership = 'OWNED'`,
      [productId, opts.warehouseId, opts.accionistaId ?? null]
    );
    const dePiladora = Math.min(qq, Math.max(0, round2(Number(enPiladora.rows[0]?.q ?? 0))));
    let falta = round2(qq - dePiladora);
    const allas = falta > 0.001 ? (await client.query(
      `SELECT w.id, w.name, SUM(m.quantity)::float AS q, MIN(m.created_at) AS desde
         FROM inventory_movements m JOIN warehouses w ON w.id = m.warehouse_id AND w.type = 'EXTERNO'
        WHERE m.product_id = $1 AND m.accionista_id = $2 AND m.ownership = 'OWNED'
        GROUP BY w.id, w.name HAVING SUM(m.quantity) > 0.0005
        ORDER BY MIN(m.created_at), w.name`,
      [productId, opts.accionistaId ?? null]
    )).rows : [];
    const tramos: { warehouseId: string; qq: number; bodega?: string }[] = [];
    for (const a of allas) {
      if (falta <= 0.001) break;
      const toma = round2(Math.min(falta, Number(a.q)));
      tramos.push({ warehouseId: a.id, qq: toma, bodega: a.name });
      falta = round2(falta - toma);
    }
    // Si ni con lo de allá alcanza, la piladora toma todo y consumeInventoryFIFO avisa el faltante (como antes).
    const usarAlla = falta <= 0.001 && tramos.length > 0;
    const salidas = usarAlla
      ? [...(dePiladora > 0.001 ? [{ warehouseId: opts.warehouseId, qq: dePiladora }] : []), ...tramos]
      : [{ warehouseId: opts.warehouseId, qq }];
    const nombre = usarAlla ? (await client.query("SELECT name FROM products WHERE id = $1", [productId])).rows[0]?.name ?? "producto" : "";
    if (usarAlla && opts.allaYaLlego) {
      // Ya llegó: se trae (viaje) y todo sale de la piladora.
      for (const t of tramos) {
        const v = viajes.get(t.warehouseId) ?? { bodega: t.bodega ?? "Allá", items: [] };
        v.items.push({ product_id: productId, quantity: t.qq, producto: nombre });
        viajes.set(t.warehouseId, v);
      }
      salidasPlan.push({ productId, nombre, warehouseId: opts.warehouseId, qq });
    } else {
      for (const s of salidas) salidasPlan.push({ productId, nombre, warehouseId: s.warehouseId, qq: s.qq, bodega: s.bodega });
    }
  }

  // 1) Los viajes de regreso que nadie registró (el flete, si lo hubo, va en el primero).
  let fletePendiente = opts.allaYaLlego?.flete ?? null;
  for (const [warehouseId, v] of viajes) {
    const prov = (await client.query("SELECT external_provider_id FROM warehouses WHERE id = $1", [warehouseId])).rows[0]?.external_provider_id;
    if (!prov || !opts.accionistaId) throw new ApiError(409, `No se encontró el proveedor de ${v.bodega}.`);
    await traerDesdeAlla(client, {
      accionistaId: opts.accionistaId, providerId: prov, plantaId: opts.warehouseId, createdBy: opts.createdBy ?? null,
      items: v.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
      notes: `Ya estaba en la piladora al preparar el pedido${opts.allaYaLlego?.orderNumber ? ` ${opts.allaYaLlego.orderNumber}` : ""} (no se había registrado el viaje)`,
      flete: fletePendiente
    });
    fletePendiente = null;
    for (const i of v.items) traidos.push({ producto: i.producto, bodega: v.bodega, qq: i.quantity });
  }

  // 2) La salida por venta.
  for (const s of salidasPlan) {
    await consumeInventoryFIFO(client, {
      productId: s.productId,
      warehouseId: s.warehouseId,
      accionistaId: opts.accionistaId,
      quantity: s.qq,
      referenceType: "sales_order",
      referenceId: opts.orderId,
      createdBy: opts.createdBy ?? null,
      notes: s.bodega ? `Retirado allá (${s.bodega.replace(/^Allá: /, "")}) por el transportista para el pedido` : null
    });
    if (s.bodega) retiros.push({ producto: s.nombre, bodega: s.bodega, qq: s.qq });
  }
  return { retiros, traidos };
}

// Restaura el inventario descontado en la preparación (al revertir la preparación
// o al anular el pedido). Elimina las salidas por venta de ese pedido.
async function restaurarInventarioPreparacion(client: PoolClient, orderId: string): Promise<number> {
  const r = await client.query(
    "DELETE FROM inventory_movements WHERE reference_type = 'sales_order' AND reference_id = $1 AND movement = 'OUT'",
    [orderId]
  );
  // Los sacos descontados al preparar vuelven a la bodega (ENTRADA en el kárdex).
  await restaurarSacosPedido(client, orderId);
  return r.rowCount ?? 0;
}

/** Detalle de un pedido, para verlo y prepararlo antes de despachar. */
ordersRouter.get("/:id", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const r = await pool.query(
    `SELECT o.*, c.full_name AS customer_name, c.phone AS customer_phone,
            c.identification AS customer_identification, c.address AS customer_address, s.sale_number,
            ar.balance AS saldo_por_cobrar
     FROM sales_orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN sales s ON s.id = o.sale_id
     LEFT JOIN accounts_receivable ar ON ar.id = o.receivable_id
     WHERE o.id = $1 AND o.accionista_id = $2`,
    [req.params.id, accionistaId]
  );
  if (!r.rowCount) throw new ApiError(404, "Pedido no encontrado");
  const items = await pool.query(
    `SELECT i.*, p.name AS product_name
     FROM sales_order_items i
     JOIN products p ON p.id = i.product_id
     WHERE i.order_id = $1`,
    [req.params.id]
  );
  res.json({ ...r.rows[0], items: items.rows });
}));

/** Editar un pedido que aún no se despacha (cantidades, precios, fecha). */
ordersRouter.put("/:id", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    delivery_date: z.string().optional(),
    notes: z.string().optional(),
    payment_method: z.enum(["CASH", "TRANSFER", "CARD", "CHECK", "CREDIT"]).optional(),
    items: z.array(orderItemSchema).min(1)
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const order = await client.query(
      "SELECT * FROM sales_orders WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    if (!order.rowCount) throw new ApiError(404, "Pedido no encontrado");
    if (order.rows[0].status !== "PENDING") {
      throw new ApiError(409, "Solo se puede editar un pedido pendiente: este ya fue despachado o cancelado.");
    }

    if (order.rows[0].prepared_at) {
      throw new ApiError(409, "No se puede editar un pedido ya preparado. Primero revierte su preparacion.");
    }

    await validarSacosPropiosDelPedido(client, accionistaId, body.items);
    await validarRespaldoDelPedido(client, accionistaId, body.items, req.params.id as string);
    if (body.payment_method) {
      await client.query("UPDATE sales_orders SET payment_method = $2 WHERE id = $1", [req.params.id, body.payment_method]);
    }

    const total = round2(body.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
    await client.query("DELETE FROM sales_order_items WHERE order_id = $1", [req.params.id]);
    for (const item of body.items) {
      await client.query(
        `INSERT INTO sales_order_items
         (order_id, product_id, presentation_id, presentation_name, inventory_product_id, quantity, unit_price, total, sobrante_saco_lb, sack_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          req.params.id, item.product_id, item.presentation_id ?? null, item.presentation_name ?? null,
          item.inventory_product_id, item.quantity, item.unit_price, round2(item.quantity * item.unit_price),
          item.sobrante_saco_lb ?? null, item.sack_id ?? null
        ]
      );
    }
    const updated = await client.query(
      `UPDATE sales_orders
       SET delivery_date = $2, notes = $3, total_amount = $4
       WHERE id = $1
       RETURNING *`,
      [req.params.id, body.delivery_date ?? order.rows[0].delivery_date, body.notes ?? order.rows[0].notes, total]
    );

    // La cuenta por cobrar sigue al pedido: si cambia el monto, cambia la deuda
    // (solo la parte que aún no se ha cobrado).
    if (order.rows[0].receivable_id) {
      const ar = await client.query(
        "SELECT amount, balance FROM accounts_receivable WHERE id = $1 FOR UPDATE",
        [order.rows[0].receivable_id]
      );
      if (ar.rowCount) {
        const cobrado = round2(Number(ar.rows[0].amount) - Number(ar.rows[0].balance));
        if (cobrado > total) {
          throw new ApiError(409, `Ya se cobraron $${cobrado.toFixed(2)} de este pedido: no puede quedar en $${total.toFixed(2)}.`);
        }
        await client.query(
          "UPDATE accounts_receivable SET amount = $2, balance = $3 WHERE id = $1",
          [order.rows[0].receivable_id, total, round2(total - cobrado)]
        );
      }
    }
    return updated.rows[0];
  });

  res.json(result);
}));

// Preparación (picking): paso intermedio de la cola de despachos. El bodeguero
// alista los sacos, confirma la ubicación/lote de donde salen y marca el pedido
// como "Listo para cargar". Al confirmar la preparación se DESCUENTA el inventario
// comercial al instante (salida por venta), para reflejar el saldo real en bodega
// y sacar el pedido de la cola "por preparar". El despacho posterior ya NO vuelve a
// mover inventario. Enviar prepared:false revierte el estado Y restaura el stock.
ordersRouter.patch("/:id/prepare", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    prepared: z.boolean().default(true),
    picking_location: z.string().max(200).optional(),
    prepared_by: z.string().uuid().optional(),
    // Bodega de la que sale el producto (por defecto la de producto terminado).
    warehouse_id: z.string().uuid().optional(),
    // Lo que iba a retirarse allá YA está en la piladora (lo trajeron y no se registró el viaje).
    alla_ya_llego: z.object({
      flete: z.object({
        tipo: z.enum(["propia", "tercero"]),
        monto: z.number().positive(),
        activo_id: z.string().uuid().optional(),
        prestador: z.string().trim().max(120).optional()
      }).optional()
    }).optional()
  }).parse(req.body);
  if (body.alla_ya_llego?.flete) validarFleteRegreso(body.alla_ya_llego.flete as FleteEnvejecido);
  // ↩ Revertir una preparación devuelve arroz y sacos al inventario: solo el administrador (2026-10-21).
  if (!body.prepared && (req as AuthenticatedRequest).user?.role_name !== "ADMINISTRADOR") {
    throw new ApiError(403, "Solo el administrador puede revertir la preparación de un pedido.");
  }

  let sacos: ResultadoSacos | null = null;
  let retirosAlla: RetiroAlla[] = [];
  let traidosAlla: RetiroAlla[] = [];
  const result = await inTransaction(async (client) => {
    const order = await client.query(
      "SELECT id, status, order_number FROM sales_orders WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    if (!order.rowCount) throw new ApiError(404, "Pedido no encontrado para el accionista seleccionado");
    if (order.rows[0].status !== "PENDING") {
      throw new ApiError(409, "Solo se puede preparar un pedido pendiente: este ya fue despachado o cancelado.");
    }

    if (body.prepared) {
      // Descuenta el inventario ahora (idempotente). Requiere bodega: si no se
      // envía, usa la bodega de PRODUCTO TERMINADO.
      let warehouseId = body.warehouse_id ?? null;
      if (!warehouseId) {
        const wh = await client.query(
          "SELECT id FROM warehouses WHERE upper(name) LIKE '%TERMINAD%' ORDER BY created_at ASC LIMIT 1"
        );
        warehouseId = wh.rows[0]?.id ?? null;
      }
      if (!warehouseId) throw new ApiError(400, "No se encontró la bodega de producto terminado para descontar el inventario.");
      ({ retiros: retirosAlla, traidos: traidosAlla } = await descontarInventarioPreparacion(client, {
        orderId: req.params.id as string,
        accionistaId,
        warehouseId,
        createdBy: body.prepared_by ?? null,
        allaYaLlego: body.alla_ya_llego
          ? { flete: (body.alla_ya_llego.flete as FleteEnvejecido | undefined) ?? null, orderNumber: order.rows[0].order_number }
          : null
      }));
      // Los SACOS (marca + peso vendidos) salen de la bodega de la matriz en este
      // mismo momento. Idempotente; si falta stock no bloquea (queda negativo).
      sacos = await descontarSacosPedido(client, req.params.id as string);
    } else {
      // Revertir preparación: restaura el stock descontado (arroz y sacos).
      await restaurarInventarioPreparacion(client, req.params.id as string);
    }

    const location = body.picking_location?.trim() || null;
    const updated = await client.query(
      `UPDATE sales_orders
          SET prepared_at = CASE WHEN $2 THEN COALESCE(prepared_at, now()) ELSE NULL END,
              prepared_by = CASE WHEN $2 THEN $3::uuid ELSE NULL END,
              picking_location = COALESCE($4, picking_location)
        WHERE id = $1
        RETURNING *`,
      [req.params.id, body.prepared, body.prepared_by ?? null, location]
    );
    return updated.rows[0];
  });
  res.json({ ...result, ...(sacos ? { sacos } : {}), retiros_alla: retirosAlla, traidos_alla: traidosAlla });
}));

// Despachar y cobrar: el pedido se convierte en venta en UNA transacción.
// Si algo falla (stock, caja), el pedido sigue PENDIENTE y se puede reintentar.
ordersRouter.post("/:id/deliver", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    payment_method: z.enum(["CASH", "TRANSFER", "CARD", "CHECK", "CREDIT"]).default("CASH"),
    cash_register_id: z.string().uuid().optional(),
    warehouse_id: z.string().uuid(),
    created_by: z.string().uuid().optional(),
    // Si un carro de Transporte y Cosechadora lleva el pedido: ese flete se le cobra al que vende.
    flete: z.object({ activo_id: z.string().uuid(), monto: z.coerce.number().positive().max(100000) }).optional()
  }).parse(req.body);
  if (body.flete) validarFleteVenta(body.flete);
  // TRANSFERENCIA / CHEQUE: el dinero no se da por recibido al despachar. La cuenta del pedido queda «por confirmar»
  // y entra a la caja cuando el de caja confirma que llegó (Caja › Transferencias por confirmar).
  const porConfirmar = body.payment_method === "TRANSFER" || body.payment_method === "CHECK" ? body.payment_method : null;

  if (body.payment_method !== "CREDIT" && !porConfirmar && !body.cash_register_id) {
    throw new ApiError(400, "Abre una caja para cobrar el pedido (o despáchalo a crédito).");
  }

  const result = await inTransaction(async (client) => {
    const order = await client.query(
      "SELECT * FROM sales_orders WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    if (!order.rowCount) throw new ApiError(404, "Pedido no encontrado para el accionista seleccionado");
    if (order.rows[0].status === "DELIVERED") throw new ApiError(409, "Este pedido ya fue despachado.");
    if (order.rows[0].status === "CANCELLED") throw new ApiError(409, "Este pedido fue cancelado.");
    // Flujo de 2 pasos: hay que CONFIRMAR LA PREPARACIÓN (picking) antes de
    // despachar. Evita que se cargue un pedido cuyos sacos no se alistaron.
    if (!order.rows[0].prepared_at) {
      throw new ApiError(409, "Confirma la preparación del pedido (📦 Confirmar Preparación) antes de despacharlo.");
    }
    // El cobro entra a una caja ABIERTA del mismo socio dueño del pedido.
    if (body.payment_method !== "CREDIT" && !porConfirmar && body.cash_register_id) {
      await exigirCajaAbiertaDelAccionista(client, body.cash_register_id, accionistaId);
    }

    const items = await client.query(
      "SELECT * FROM sales_order_items WHERE order_id = $1",
      [req.params.id]
    );
    if (!items.rowCount) throw new ApiError(409, "El pedido no tiene líneas.");

    // El pedido ya generó su cuenta por cobrar al tomarse: la venta no debe
    // crear otra, sería cobrar dos veces lo mismo.
    const sale = await crearVenta(
      client,
      accionistaId,
      {
        customer_id: order.rows[0].customer_id,
        cash_register_id: porConfirmar ? undefined : body.cash_register_id,
        // Por confirmar se registra como a crédito (sin ingreso a caja); la cuenta queda marcada.
        payment_method: porConfirmar ? "CREDIT" : body.payment_method,
        sack_weight_lb: 100,
        created_by: body.created_by,
        // La 'Cantidad' del pedido YA está en QUINTALES (estandarización). NO se
        // pasa presentation_id para que crearVenta NO la reconvierta por peso de
        // saco (eso descontaría mal el stock). La presentación es solo metadato de
        // la Guía de Remisión. El descuento de inventario es exactamente en QQ.
        items: items.rows.map((item) => ({
          product_id: item.inventory_product_id,
          warehouse_id: body.warehouse_id,
          presentation_id: undefined,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price)
        }))
      },
      // El inventario YA se descontó al confirmar la preparación (salida por venta
      // ligada al pedido). El despacho no debe volver a mover stock: solo registra
      // la venta, sus líneas y el cobro/caja.
      { omitirCuentaPorCobrar: Boolean(order.rows[0].receivable_id), omitirInventario: true }
    );

    // Qué pasa con la cuenta del pedido al despachar:
    //  · cobrado ahora  -> se salda y el dinero entra a la caja.
    //  · a crédito      -> sigue viva, ahora enlazada a la venta.
    if (order.rows[0].receivable_id) {
      if (body.payment_method === "CREDIT" || porConfirmar) {
        await client.query(
          `UPDATE accounts_receivable
           SET sale_id = $2,
               description = REPLACE(description, ' (pendiente de despacho)', $3),
               por_confirmar = $4, por_confirmar_desde = CASE WHEN $4::text IS NULL THEN NULL ELSE now() END
           WHERE id = $1`,
          [order.rows[0].receivable_id, sale.id,
           porConfirmar ? (porConfirmar === "CHECK" ? " — despachado, cheque por confirmar" : " — despachado, transferencia por confirmar") : " — despachado a crédito",
           porConfirmar]
        );
      } else {
        // El dinero ya entró a la caja dentro de crearVenta; aquí solo se
        // salda la cuenta del pedido. Registrarlo otra vez duplicaría el
        // ingreso (se detectó en pruebas: la caja recibía el doble).
        await client.query(
          `UPDATE accounts_receivable
           SET balance = 0, status = 'PAID', sale_id = $2,
               description = REPLACE(description, ' (pendiente de despacho)', ' — despachado y cobrado')
           WHERE id = $1`,
          [order.rows[0].receivable_id, sale.id]
        );
      }
    }

    // Pedido viejo sin cuenta propia: la venta a crédito creó la suya; se marca por confirmar.
    if (!order.rows[0].receivable_id && porConfirmar) {
      await client.query(
        "UPDATE accounts_receivable SET por_confirmar = $2, por_confirmar_desde = now() WHERE sale_id = $1 AND status <> 'CANCELLED'",
        [sale.id, porConfirmar]
      );
    }
    await client.query(
      "UPDATE sales_orders SET status = 'DELIVERED', sale_id = $2, delivered_at = now() WHERE id = $1",
      [req.params.id, sale.id]
    );

    // Cargo automático por empaque: si un SOCIO despachó sacos de 10/25/50 lb,
    // la matriz (CEYRO) le cobra por su uso. Genera CxC (CEYRO) + CxP (socio)
    // pendientes, en espejo, dentro de esta misma transacción. Si no aplica
    // (matriz, sin sacos elegibles o tarifas en $0) devuelve null.
    const ordRef = { id: order.rows[0].id as string, order_number: order.rows[0].order_number as string };
    const cargoEmpaque = await cobrarEmpaqueAlDespachar(client, ordRef, accionistaId as string);

    const customer = await client.query("SELECT full_name FROM customers WHERE id = $1", [order.rows[0].customer_id]);
    const totalQqDespachado = round2(items.rows.reduce((sum, item) => sum + Number(item.quantity || 0), 0));
    // Lo que el transportista retiró ALLÁ (selección/envejecido) no lo carga la cuadrilla de la piladora.
    const qqRetiradoAlla = round2(Number((await client.query(
      `SELECT COALESCE(-SUM(m.quantity), 0)::float AS q FROM inventory_movements m
         JOIN warehouses w ON w.id = m.warehouse_id AND w.type = 'EXTERNO'
        WHERE m.reference_type = 'sales_order' AND m.reference_id = $1 AND m.movement = 'OUT'`,
      [req.params.id]
    )).rows[0]?.q ?? 0));

    // Flete con carro de Transporte y Cosechadora: CxC de Transporte + Por Pagar del que vende.
    const flete = body.flete
      ? await registrarFleteVenta(client, {
          orderId: ordRef.id, orderNumber: ordRef.order_number, accionistaId: accionistaId as string,
          fecha: (await client.query("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text AS d")).rows[0].d,
          qq: totalQqDespachado, cliente: customer.rows[0]?.full_name ?? null, flete: body.flete, createdBy: body.created_by ?? null
        })
      : null;
    await upsertCuadrillaDespachoVentaEntry(client, {
      order_id: order.rows[0].id,
      order_number: order.rows[0].order_number,
      guia_number: order.rows[0].guia_number,
      customer_name: customer.rows[0]?.full_name ?? null,
      quantity_qq: Math.max(0, round2(totalQqDespachado - qqRetiradoAlla)),
      work_date: order.rows[0].delivered_at ? new Date(order.rows[0].delivered_at).toISOString().slice(0, 10) : null,
      created_by: body.created_by ?? null,
      accionista_id: accionistaId as string
    });

    // NOTA: los sacos físicos NO se descuentan aquí: ya salieron de la bodega de
    // la matriz al CONFIRMAR LA PREPARACIÓN (descontarSacosPedido). En el despacho
    // solo se registra la venta y, si aplica, el CARGO financiero por empaque.

    return { order_number: order.rows[0].order_number, sale, cargo_empaque: cargoEmpaque, flete, por_confirmar: porConfirmar };
  });

  res.json(result);
}));

// Guía de Remisión: guarda los datos del transportista en un pedido YA
// despachado y le asigna un número de guía la primera vez. Solo persiste datos
// de transporte para el documento; no toca inventario ni contabilidad.
ordersRouter.put("/:id/guia", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    transportista_nombre: z.string().min(1).max(120),
    transportista_cedula: z.string().max(20).optional(),
    vehiculo_placa: z.string().max(15).optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const order = await client.query(
      "SELECT * FROM sales_orders WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    if (!order.rowCount) throw new ApiError(404, "Pedido no encontrado para el accionista seleccionado");
    if (order.rows[0].status !== "DELIVERED") {
      throw new ApiError(409, "La guía de remisión solo se emite para pedidos despachados.");
    }

    // Número de guía: se asigna una sola vez (se conserva si ya existía).
    let guiaNumber: string = order.rows[0].guia_number;
    if (!guiaNumber) {
      const seq = await client.query("SELECT COALESCE((SELECT guia_prefix FROM app_settings WHERE socio_id IS NULL LIMIT 1), '001-001-') || LPAD(nextval('guia_remision_seq')::text, 9, '0') AS n");
      guiaNumber = seq.rows[0].n;
    }

    const updated = await client.query(
      `UPDATE sales_orders
       SET transportista_nombre = $2, transportista_cedula = $3, vehiculo_placa = $4,
           guia_number = $5,
           guia_emitida_at = COALESCE(guia_emitida_at, now())
       WHERE id = $1
       RETURNING *`,
      [req.params.id, body.transportista_nombre.trim(),
       body.transportista_cedula?.trim() || null, body.vehiculo_placa?.trim() || null, guiaNumber]
    );
    return updated.rows[0];
  });

  res.json(result);
}));

// Flete de un pedido YA despachado (si se olvidó al despachar o hay que corregirlo). Cambiarlo =
// quitar el anterior (solo si Transporte aún no cobró nada de él) y registrar el nuevo.
ordersRouter.put("/:id/flete", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    activo_id: z.string().uuid(),
    monto: z.coerce.number().positive().max(100000),
    created_by: z.string().uuid().optional()
  }).parse(req.body);
  validarFleteVenta(body);
  const out = await inTransaction(async (client) => {
    const order = (await client.query(
      `SELECT o.id, o.order_number, o.status, o.delivered_at, c.full_name AS cliente
         FROM sales_orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.id = $1 AND o.accionista_id = $2 FOR UPDATE OF o`,
      [req.params.id, accionistaId]
    )).rows[0];
    if (!order) throw new ApiError(404, "Pedido no encontrado para el accionista seleccionado");
    if (order.status !== "DELIVERED") throw new ApiError(409, "El flete se registra al despachar el pedido.");
    await quitarFleteVenta(client, order.id);
    const qq = Number((await client.query("SELECT COALESCE(sum(quantity), 0)::float AS q FROM sales_order_items WHERE order_id = $1", [order.id])).rows[0].q);
    const fecha = order.delivered_at
      ? (await client.query("SELECT ($1::timestamptz AT TIME ZONE 'America/Guayaquil')::date::text AS d", [order.delivered_at])).rows[0].d
      : (await client.query("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text AS d")).rows[0].d;
    return registrarFleteVenta(client, {
      orderId: order.id, orderNumber: order.order_number, accionistaId: accionistaId as string,
      fecha, qq, cliente: order.cliente, flete: { activo_id: body.activo_id, monto: body.monto }, createdBy: body.created_by ?? null
    });
  });
  res.json({ ok: true, flete: out });
}));

ordersRouter.delete("/:id/flete", requireAdmin, asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const out = await inTransaction(async (client) => {
    const order = (await client.query(
      "SELECT id FROM sales_orders WHERE id = $1 AND accionista_id = $2 FOR UPDATE", [req.params.id, accionistaId]
    )).rows[0];
    if (!order) throw new ApiError(404, "Pedido no encontrado para el accionista seleccionado");
    return quitarFleteVenta(client, order.id);
  });
  res.json({ ok: true, ...out });
}));

// ── ANULAR UNA VENTA YA DESPACHADA (solo administrador) ──────────────────────
// Deshace todo lo que hizo el despacho, en UNA transacción:
//  · arroz y sacos vuelven a la bodega (salidas de la preparación);
//  · dinero: contado → se anula el ingreso de la venta en su caja (si sigue abierta) o, si ya se cerró,
//    se registra la DEVOLUCIÓN en la caja abierta que se elija; crédito → la cuenta por cobrar se anula
//    (si el cliente ya abonó, primero se anulan esos abonos en Caja);
//  · flete de Transporte y cargo de empaque entre socios: se quitan (si ya se cobraron → 409);
//  · cuadrilla del despacho: se quita si aún no se pagó (si ya se pagó, queda: el trabajo se hizo).
// El pedido queda CANCELLED con motivo, fecha y quién; la venta, sale_status CANCELLED. Nada se borra.
ordersRouter.post("/:id/anular-despacho", requireAdmin, asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const user = (req as AuthenticatedRequest).user;
  const body = z.object({
    motivo: z.string().trim().min(5, "Escribe el motivo (mínimo 5 letras)."),
    cash_register_id: z.string().uuid().optional()
  }).parse(req.body);

  const out = await inTransaction(async (client) => {
    const order = (await client.query(
      "SELECT * FROM sales_orders WHERE id = $1 AND accionista_id = $2 FOR UPDATE", [req.params.id, accionistaId]
    )).rows[0];
    if (!order) throw new ApiError(404, "Pedido no encontrado para el accionista seleccionado");
    if (order.status === "CANCELLED") throw new ApiError(409, "Este pedido ya está anulado.");
    if (order.status !== "DELIVERED" || !order.sale_id) throw new ApiError(409, "Solo se anula así un pedido ya despachado. Uno pendiente se cancela normal.");
    const sale = (await client.query("SELECT * FROM sales WHERE id = $1 FOR UPDATE", [order.sale_id])).rows[0];
    if (!sale) throw new ApiError(404, "No se encontró la venta de este pedido.");
    const total = round2(Number(sale.total_amount));
    const esCredito = sale.payment_status === "CONFIRMED" || sale.payment_status === "PARTIAL";

    // 1) Cargo de empaque entre socios (si lo hubo): sin pagos se anula; con pagos → 409.
    const cargo = (await client.query(
      "SELECT * FROM matriz_packaging_charges WHERE order_id = $1 AND status <> 'ANULADO' FOR UPDATE", [order.id]
    )).rows[0];
    if (cargo) {
      const ar = (await client.query("SELECT amount, balance, status FROM accounts_receivable WHERE id = $1 FOR UPDATE", [cargo.receivable_id])).rows[0];
      const ap = (await client.query("SELECT amount, balance, status FROM accounts_payable WHERE id = $1 FOR UPDATE", [cargo.payable_id])).rows[0];
      const pagado = (c?: { amount: string; balance: string; status: string }) => !!c && c.status !== "CANCELLED" && Number(c.balance) + 0.005 < Number(c.amount);
      if (pagado(ar) || pagado(ap)) throw new ApiError(409, "El cargo de empaque de este despacho ya tiene pagos: anúlalos primero en Caja.");
      await client.query("UPDATE accounts_receivable SET balance = 0, status = 'CANCELLED' WHERE id = $1", [cargo.receivable_id]);
      await client.query("UPDATE accounts_payable SET balance = 0, status = 'CANCELLED' WHERE id = $1", [cargo.payable_id]);
      await client.query("UPDATE matriz_packaging_charges SET status = 'ANULADO' WHERE id = $1", [cargo.id]);
    }

    // 2) Flete de Transporte (si lo hubo). Con cobros en Transporte lanza 409.
    await quitarFleteVenta(client, order.id);

    // 3) El dinero.
    let devolucion: { tipo: "anulado_en_caja" | "devuelto_en_otra_caja" | "credito_anulado"; caja_id: string | null } ;
    const cuentas = (await client.query(
      "SELECT id, amount, balance, status FROM accounts_receivable WHERE (id = $1 OR sale_id = $2) AND status <> 'CANCELLED' FOR UPDATE",
      [order.receivable_id, sale.id]
    )).rows as Array<{ id: string; amount: string; balance: string; status: string }>;
    if (esCredito) {
      if (cuentas.some((c) => Number(c.balance) + 0.005 < Number(c.amount))) {
        throw new ApiError(409, "El cliente ya abonó a esta venta: anula primero esos abonos en Caja (o deja la venta y regístrale una devolución).");
      }
      devolucion = { tipo: "credito_anulado", caja_id: null };
    } else {
      const ingreso = (await client.query(
        `SELECT m.*, cr.status AS caja_estado FROM cash_movements m JOIN cash_registers cr ON cr.id = m.cash_register_id
          WHERE m.reference_type = 'sales' AND m.reference_id = $1 AND m.movement = 'INCOME'
            AND m.reversed_at IS NULL AND m.reversal_of IS NULL
          ORDER BY m.created_at LIMIT 1 FOR UPDATE OF m`, [sale.id]
      )).rows[0];
      if (ingreso && ingreso.caja_estado === "OPEN") {
        await client.query(
          `INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, reference_type, reference_id, reversal_of, created_by)
           VALUES ($1, 'EXPENSE', $2, $3, $4, 'reversal', $5, $5, $6)`,
          [ingreso.cash_register_id, ingreso.category, ingreso.amount, `Anulación de venta ${sale.sale_number}: ${body.motivo}`, ingreso.id, user?.id ?? null]
        );
        await client.query("UPDATE cash_movements SET reversed_at = now(), reversed_by = $2, reversed_reason = $3 WHERE id = $1",
          [ingreso.id, user?.id ?? null, `Venta anulada: ${body.motivo}`]);
        devolucion = { tipo: "anulado_en_caja", caja_id: ingreso.cash_register_id };
      } else {
        if (!body.cash_register_id) {
          throw new ApiError(409, "La caja donde entró esta venta ya está cerrada: elige una caja abierta para registrar la devolución del dinero.");
        }
        await exigirCajaAbiertaDelAccionista(client, body.cash_register_id, accionistaId);
        await client.query(
          `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
           VALUES ($1, 'EXPENSE', 'DEVOLUCION_VENTA', 'sales', $2, $3, $4, $5)`,
          [body.cash_register_id, sale.id, total, `Devolución por venta anulada ${sale.sale_number}: ${body.motivo}`, user?.id ?? null]
        );
        devolucion = { tipo: "devuelto_en_otra_caja", caja_id: body.cash_register_id };
      }
    }
    for (const c of cuentas) {
      await client.query("UPDATE accounts_receivable SET balance = 0, status = 'CANCELLED' WHERE id = $1", [c.id]);
    }

    // 4) Cuadrilla del despacho (solo si aún no se pagó).
    const cuadrillaQuitada = await revertCuadrillaDespachoVentaEntry(client, order.id);

    // 5) Arroz y sacos vuelven a la bodega.
    await restaurarInventarioPreparacion(client, order.id);

    // 6) Estados finales (nada se borra).
    await client.query("UPDATE sales SET sale_status = 'CANCELLED' WHERE id = $1", [sale.id]);
    await client.query(
      `UPDATE sales_orders SET status = 'CANCELLED', anulado_at = now(), anulado_motivo = $2, anulado_by = $3 WHERE id = $1`,
      [order.id, body.motivo, user?.id ?? null]
    );
    return {
      order_number: order.order_number, sale_number: sale.sale_number, total,
      devolucion, cargo_empaque_anulado: !!cargo, cuadrilla_quitada: cuadrillaQuitada > 0
    };
  });
  res.json({ ok: true, ...out });
}));

ordersRouter.post("/:id/cancel", requireAdmin, asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await inTransaction(async (client) => {
    const order = await client.query(
      "SELECT * FROM sales_orders WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [req.params.id, accionistaId]
    );
    if (!order.rowCount) throw new ApiError(404, "Pedido no encontrado para el accionista seleccionado");
    if (order.rows[0].status === "DELIVERED") throw new ApiError(409, "Ya fue despachado: cancela desde ventas si hace falta.");

    // Si ya se cobró algo del pedido, cancelarlo dejaría plata sin respaldo.
    if (order.rows[0].receivable_id) {
      const ar = await client.query(
        "SELECT amount, balance FROM accounts_receivable WHERE id = $1 FOR UPDATE",
        [order.rows[0].receivable_id]
      );
      const cobrado = round2(Number(ar.rows[0]?.amount ?? 0) - Number(ar.rows[0]?.balance ?? 0));
      if (cobrado > 0) {
        throw new ApiError(409, `Ya se cobraron $${cobrado.toFixed(2)} de este pedido. Devuelve ese abono antes de cancelarlo.`);
      }
      await client.query(
        "UPDATE accounts_receivable SET balance = 0, status = 'CANCELLED' WHERE id = $1",
        [order.rows[0].receivable_id]
      );
    }

    await revertCuadrillaDespachoVentaEntry(client, String(req.params.id));
    // Si el pedido ya había descontado inventario en la preparación, se restaura
    // (no se vende lo que no se despachó).
    await restaurarInventarioPreparacion(client, String(req.params.id));

    const updated = await client.query(
      "UPDATE sales_orders SET status = 'CANCELLED' WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    return updated.rows[0];
  });
  res.json(result);
}));
