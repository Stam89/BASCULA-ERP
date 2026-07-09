import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";

export const customersRouter = Router();

// GET buscar clientes por nombre (autocompletado)
customersRouter.get("/search", asyncRoute(async (req, res) => {
  const query = (req.query.q as string || "").trim();

  if (query.length < 2) {
    res.json([]);
    return;
  }

  const result = await pool.query(
    `SELECT id, full_name, phone FROM customers
     WHERE full_name ILIKE $1 OR phone ILIKE $1
     LIMIT 10`,
    [`%${query}%`]
  );
  res.json(result.rows);
}));

// GET todos los clientes
customersRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT id, full_name, phone, identification, customer_type FROM customers ORDER BY full_name`
  );
  res.json(result.rows);
}));

// GET detalle de un cliente
customersRouter.get("/:id", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM customers WHERE id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: "Cliente no encontrado" }); return; }
  res.json(result.rows[0]);
}));

// POST crear cliente rápido (solo nombre y teléfono)
customersRouter.post("/quick", asyncRoute(async (req, res) => {
  const body = z.object({
    full_name: z.string().min(2),
    phone: z.string().optional()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO customers (full_name, phone, customer_type)
     VALUES ($1, $2, 'RETAIL')
     RETURNING id, full_name, phone, customer_type, created_at`,
    [body.full_name, body.phone || null]
  );
  res.status(201).json(result.rows[0]);
}));

// POST crear cliente completo
customersRouter.post("/", asyncRoute(async (req, res) => {
  const body = z.object({
    full_name: z.string().min(2),
    phone: z.string().optional(),
    identification: z.string().optional(),
    address: z.string().optional(),
    customer_type: z.string().default("RETAIL")
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO customers (full_name, phone, identification, address, customer_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [body.full_name, body.phone || null, body.identification || null, body.address || null, body.customer_type]
  );
  res.status(201).json(result.rows[0]);
}));

// GET presentaciones de un producto
customersRouter.get("/product/:productId/presentations", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, weight_lb FROM product_presentations
     WHERE product_id = $1 ORDER BY weight_lb`,
    [req.params.productId]
  );
  res.json(result.rows);
}));
