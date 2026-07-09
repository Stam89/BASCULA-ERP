import { Router } from "express";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";

export const productsRouter = Router();

// GET todos los productos
productsRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT id, code, name, product_type, unit, is_active FROM products ORDER BY name`
  );
  res.json(result.rows);
}));

// GET detalle de un producto
productsRouter.get("/:id", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id, code, name, product_type, unit, is_active FROM products WHERE id = $1`,
    [req.params.id]
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
