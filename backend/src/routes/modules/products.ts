import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";

export const productsRouter = Router();

// GET todos los productos
productsRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT id, code, name, product_type, unit, is_active, price_per_pound FROM products ORDER BY name`
  );
  res.json(result.rows);
}));

// GET detalle de un producto
productsRouter.get("/:id", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id, code, name, product_type, unit, is_active, price_per_pound FROM products WHERE id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  res.json(result.rows[0]);
}));

// PATCH tarifa por libra (venta al detalle). Solo actualiza el precio por libra;
// no toca nada más del producto ni de Ventas mayoristas. price_per_pound = 0
// significa "sin tarifa" (el cotizador cae al último precio usado).
productsRouter.patch("/:id/tarifa-libra", asyncRoute(async (req, res) => {
  const body = z.object({ price_per_pound: z.coerce.number().min(0) }).parse(req.body);
  const result = await pool.query(
    `UPDATE products SET price_per_pound = $2 WHERE id = $1
     RETURNING id, code, name, product_type, unit, is_active, price_per_pound`,
    [req.params.id, body.price_per_pound]
  );
  if (!result.rows[0]) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  res.json(result.rows[0]);
}));

// GET presentaciones de un producto
productsRouter.get("/:id/presentations", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, weight_lb FROM product_presentations
     WHERE product_id = $1 ORDER BY weight_lb`,
    [req.params.id]
  );
  res.json(result.rows);
}));
