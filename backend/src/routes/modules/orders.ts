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
import { calculateOrderStockCoverage, rawBackingCode } from "../../utils/order-stock-coverage.js";
import { quitarFleteVenta, registrarFleteVenta, validarFleteVenta } from "../../services/campo-flete-venta.js";

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
  sobrante_saco_lb: z.number().positive().nullable().optional()
});

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
ordersRouter.get("/cola-global", asyncRoute(async (_req, res) => {
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
                   AND m.product_id IN (SELECT i.inventory_product_id FROM sales_order_items i WHERE i.order_id = o.id)
                 GROUP BY m.product_id
              ) x
            ), '{}'::json) AS stock_dueno
     FROM sales_orders o
     JOIN customers c ON c.id = o.customer_id
     JOIN accionistas a ON a.id = o.accionista_id
     WHERE o.status = 'PENDING'
     ORDER BY o.delivery_date NULLS LAST, o.created_at
     LIMIT 500`
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

ordersRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    customer_id: z.string().uuid(),
    delivery_date: z.string().optional(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional(),
    items: z.array(orderItemSchema).min(1)
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    await validarRespaldoDelPedido(client, accionistaId, body.items);
    const total = round2(body.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
    const order = await client.query(
      `INSERT INTO sales_orders (order_number, customer_id, accionista_id, delivery_date, notes, total_amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [nextCode("PED"), body.customer_id, accionistaId, body.delivery_date ?? null, body.notes ?? null, total, body.created_by ?? null]
    );
    for (const item of body.items) {
      await client.query(
        `INSERT INTO sales_order_items
         (order_id, product_id, presentation_id, presentation_name, inventory_product_id, quantity, unit_price, total, sobrante_saco_lb)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          order.rows[0].id, item.product_id, item.presentation_id ?? null, item.presentation_name ?? null,
          item.inventory_product_id, item.quantity, item.unit_price, round2(item.quantity * item.unit_price),
          item.sobrante_saco_lb ?? null
        ]
      );
    }
    await crearCobroDelPedido(client, order.rows[0], accionistaId);
    return order.rows[0];
  });

  res.status(201).json(result);
}));

/**
 * Permite tomar pedidos sin producto terminado solamente cuando el mismo socio
 * dispone de cascara del tipo correspondiente. Los pedidos pendientes tambien
 * consumen cobertura comercial, aunque el inventario fisico solo se descuenta
 * al confirmar la preparacion.
 */
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
    const cobertura = calculateOrderStockCoverage(solicitadoQq, pendienteQq, terminadoQq, cascaraQq);
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
async function descontarInventarioPreparacion(
  client: PoolClient,
  opts: { orderId: string; accionistaId: string | undefined; warehouseId: string; createdBy?: string | null }
): Promise<void> {
  const ya = await client.query(
    "SELECT 1 FROM inventory_movements WHERE reference_type = 'sales_order' AND reference_id = $1 AND movement = 'OUT' LIMIT 1",
    [opts.orderId]
  );
  if (ya.rowCount) return; // ya descontado en una preparación previa

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
    await consumeInventoryFIFO(client, {
      productId,
      warehouseId: opts.warehouseId,
      accionistaId: opts.accionistaId,
      quantity: qq,
      referenceType: "sales_order",
      referenceId: opts.orderId,
      createdBy: opts.createdBy ?? null
    });
  }
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

    await validarRespaldoDelPedido(client, accionistaId, body.items, req.params.id as string);

    const total = round2(body.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
    await client.query("DELETE FROM sales_order_items WHERE order_id = $1", [req.params.id]);
    for (const item of body.items) {
      await client.query(
        `INSERT INTO sales_order_items
         (order_id, product_id, presentation_id, presentation_name, inventory_product_id, quantity, unit_price, total, sobrante_saco_lb)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          req.params.id, item.product_id, item.presentation_id ?? null, item.presentation_name ?? null,
          item.inventory_product_id, item.quantity, item.unit_price, round2(item.quantity * item.unit_price),
          item.sobrante_saco_lb ?? null
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
    warehouse_id: z.string().uuid().optional()
  }).parse(req.body);

  let sacos: ResultadoSacos | null = null;
  const result = await inTransaction(async (client) => {
    const order = await client.query(
      "SELECT id, status FROM sales_orders WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
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
      await descontarInventarioPreparacion(client, {
        orderId: req.params.id as string,
        accionistaId,
        warehouseId,
        createdBy: body.prepared_by ?? null
      });
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
  res.json(sacos ? { ...result, sacos } : result);
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

  if (body.payment_method !== "CREDIT" && !body.cash_register_id) {
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
    if (body.payment_method !== "CREDIT" && body.cash_register_id) {
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
        cash_register_id: body.cash_register_id,
        payment_method: body.payment_method,
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
      if (body.payment_method === "CREDIT") {
        await client.query(
          `UPDATE accounts_receivable
           SET sale_id = $2,
               description = REPLACE(description, ' (pendiente de despacho)', ' — despachado a crédito')
           WHERE id = $1`,
          [order.rows[0].receivable_id, sale.id]
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
      quantity_qq: totalQqDespachado,
      work_date: order.rows[0].delivered_at ? new Date(order.rows[0].delivered_at).toISOString().slice(0, 10) : null,
      created_by: body.created_by ?? null,
      accionista_id: accionistaId as string
    });

    // NOTA: los sacos físicos NO se descuentan aquí: ya salieron de la bodega de
    // la matriz al CONFIRMAR LA PREPARACIÓN (descontarSacosPedido). En el despacho
    // solo se registra la venta y, si aplica, el CARGO financiero por empaque.

    return { order_number: order.rows[0].order_number, sale, cargo_empaque: cargoEmpaque, flete };
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

ordersRouter.delete("/:id/flete", asyncRoute(async (req, res) => {
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

ordersRouter.post("/:id/cancel", asyncRoute(async (req, res) => {
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
