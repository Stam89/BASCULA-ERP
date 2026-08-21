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
import { cobrarEmpaqueAlDespachar } from "../../services/cargo-empaque.js";

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
    await crearCobroDelPedido(client, order.rows[0], accionistaId);
    return order.rows[0];
  });

  res.status(201).json(result);
}));

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

/** Detalle de un pedido, para verlo y prepararlo antes de despachar. */
ordersRouter.get("/:id", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const r = await pool.query(
    `SELECT o.*, c.full_name AS customer_name, c.phone AS customer_phone, s.sale_number,
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

    const total = round2(body.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
    await client.query("DELETE FROM sales_order_items WHERE order_id = $1", [req.params.id]);
    for (const item of body.items) {
      await client.query(
        `INSERT INTO sales_order_items
         (order_id, product_id, presentation_id, presentation_name, inventory_product_id, quantity, unit_price, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.params.id, item.product_id, item.presentation_id ?? null, item.presentation_name ?? null,
          item.inventory_product_id, item.quantity, item.unit_price, round2(item.quantity * item.unit_price)
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
        items: items.rows.map((item) => ({
          product_id: item.inventory_product_id,
          warehouse_id: body.warehouse_id,
          presentation_id: item.presentation_id ?? undefined,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price)
        }))
      },
      { omitirCuentaPorCobrar: Boolean(order.rows[0].receivable_id) }
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
    const cargoEmpaque = await cobrarEmpaqueAlDespachar(
      client,
      { id: order.rows[0].id as string, order_number: order.rows[0].order_number as string },
      accionistaId as string
    );

    return { order_number: order.rows[0].order_number, sale, cargo_empaque: cargoEmpaque };
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
      const seq = await client.query("SELECT '001-001-' || LPAD(nextval('guia_remision_seq')::text, 9, '0') AS n");
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

    const updated = await client.query(
      "UPDATE sales_orders SET status = 'CANCELLED' WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    return updated.rows[0];
  });
  res.json(result);
}));
