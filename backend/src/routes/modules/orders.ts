import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { nextCode } from "../../utils/codes.js";
import { round2 } from "../../utils/rice-formulas.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import { crearVenta } from "./sales.js";

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
  unit_price: z.number().nonnegative()
});

ordersRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT o.*, c.full_name AS customer_name, c.phone AS customer_phone,
            s.sale_number,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'product_id', i.product_id,
                       'presentation_name', i.presentation_name,
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
     WHERE o.accionista_id = $1
     ORDER BY (o.status = 'PENDING') DESC, o.created_at DESC
     LIMIT 200`,
    [accionistaId]
  );
  res.json(result.rows);
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
         (order_id, product_id, presentation_id, presentation_name, inventory_product_id, quantity, unit_price, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          order.rows[0].id, item.product_id, item.presentation_id ?? null, item.presentation_name ?? null,
          item.inventory_product_id, item.quantity, item.unit_price, round2(item.quantity * item.unit_price)
        ]
      );
    }
    return order.rows[0];
  });

  res.status(201).json(result);
}));

// Despachar y cobrar: el pedido se convierte en venta en UNA transacción.
// Si algo falla (stock, caja), el pedido sigue PENDIENTE y se puede reintentar.
ordersRouter.post("/:id/deliver", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    payment_method: z.enum(["CASH", "TRANSFER", "CARD", "CHECK", "CREDIT"]).default("CASH"),
    cash_register_id: z.string().uuid().optional(),
    warehouse_id: z.string().uuid(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

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

    const items = await client.query(
      "SELECT * FROM sales_order_items WHERE order_id = $1",
      [req.params.id]
    );
    if (!items.rowCount) throw new ApiError(409, "El pedido no tiene líneas.");

    const sale = await crearVenta(client, accionistaId, {
      customer_id: order.rows[0].customer_id,
      cash_register_id: body.cash_register_id,
      payment_method: body.payment_method,
      sack_weight_lb: 100,
      created_by: body.created_by,
      items: items.rows.map((item) => ({
        product_id: item.inventory_product_id,
        warehouse_id: body.warehouse_id,
        presentation_id: item.presentation_id ?? undefined,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price)
      }))
    });

    await client.query(
      "UPDATE sales_orders SET status = 'DELIVERED', sale_id = $2, delivered_at = now() WHERE id = $1",
      [req.params.id, sale.id]
    );

    return { order_number: order.rows[0].order_number, sale };
  });

  res.json(result);
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
    const updated = await client.query(
      "UPDATE sales_orders SET status = 'CANCELLED' WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    return updated.rows[0];
  });
  res.json(result);
}));
