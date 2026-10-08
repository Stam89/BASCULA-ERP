import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin } from "../../auth/require-auth.js";
import {
  actualizarProductoCatalogo, agregarPresentacion, crearProductoCatalogo, listarCatalogo
} from "../../services/catalogo-productos.js";

export const productsRouter = Router();

const PRODUCT_TYPES = ["FINISHED_GOOD", "PACKAGED_GOOD", "BYPRODUCT", "RAW_MATERIAL"] as const;

const createProductSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(140),
  product_type: z.enum(PRODUCT_TYPES),
  unit: z.string().trim().min(1).max(20).default("QQ")
});

// GET todos los productos
productsRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT id, code, name, product_type, unit, is_active, price_per_pound, venta_detalle FROM products ORDER BY name`
  );
  res.json(result.rows);
}));

// ── CATÁLOGO DE PRODUCTOS (Configuración → 🧺 Catálogo de productos) ─────────
// Va ANTES de "/:id" para que "catalogo" no se tome como un id.
// Lista con presentaciones, sacos enlazados, calidad, tarifa, venta al detalle y stock.
productsRouter.get("/catalogo", asyncRoute(async (_req, res) => {
  res.json(await listarCatalogo(pool));
}));

// Alta completa: el producto y TODO lo que necesita (presentaciones, sacos por peso y
// calidad en una marca; tarifa y venta al detalle en un producto de mostrador).
productsRouter.post("/catalogo", requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    tipo: z.enum(["FINISHED_GOOD", "PACKAGED_GOOD", "BYPRODUCT", "RAW_MATERIAL"]),
    nombre: z.string().trim().min(2).max(140),
    codigo: z.string().trim().max(40).optional(),
    unidad: z.string().trim().max(20).default("QQ"),
    calidad: z.enum(["0.11", "CORRIENTE"]).nullable().optional(),
    pesos: z.array(z.number().positive().max(1000)).max(8).default([]),
    stock_minimo: z.number().int().nonnegative().default(0),
    precio_compra_default: z.number().nonnegative().default(0),
    precio_venta_cliente: z.number().nonnegative().default(0),
    price_per_pound: z.number().nonnegative().max(9999).default(0),
    venta_detalle: z.boolean().default(false)
  }).parse(req.body);
  const out = await inTransaction((client) => crearProductoCatalogo(client, body));
  const [producto] = await listarCatalogo(pool, out.id);
  res.status(201).json({ ...out, producto });
}));

// GET detalle de un producto
productsRouter.get("/:id", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id, code, name, product_type, unit, is_active, price_per_pound, venta_detalle FROM products WHERE id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  res.json(result.rows[0]);
}));

// POST crear producto de inventario. El stock inicial queda en 0 porque
// inventory_stock es una vista sobre movimientos reales y no admite cantidad 0.
productsRouter.post("/", requireAdmin, asyncRoute(async (req, res) => {
  const body = createProductSchema.parse(req.body);
  const normalizedCode = body.code.toUpperCase();
  const normalizedUnit = body.unit.toUpperCase();

  const result = await inTransaction(async (client) => {
    const existing = await client.query(
      `SELECT id, code, name, product_type, unit, is_active, price_per_pound, venta_detalle
       FROM products
       WHERE lower(code) = lower($1)
       LIMIT 1`,
      [normalizedCode]
    );

    if (existing.rowCount && existing.rows[0].is_active !== false) {
      throw new ApiError(409, `Ya existe un producto con el codigo ${normalizedCode}.`);
    }

    if (existing.rowCount) {
      const updated = await client.query(
        `UPDATE products
         SET code = $2,
             name = $3,
             product_type = $4,
             unit = $5,
             is_active = true
         WHERE id = $1
         RETURNING id, code, name, product_type, unit, is_active, price_per_pound, venta_detalle`,
        [existing.rows[0].id, normalizedCode, body.name, body.product_type, normalizedUnit]
      );
      return updated.rows[0];
    }

    const created = await client.query(
      `INSERT INTO products (code, name, product_type, unit, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, code, name, product_type, unit, is_active, price_per_pound, venta_detalle`,
      [normalizedCode, body.name, body.product_type, normalizedUnit]
    );
    return created.rows[0];
  });

  res.status(201).json(result);
}));

// PATCH tarifa por libra (venta al detalle). Solo actualiza el precio por libra;
// no toca nada más del producto ni de Ventas mayoristas. price_per_pound = 0
// significa "sin tarifa" (el cotizador cae al último precio usado). Solo admin,
// igual que la tarjeta de Configuración que la edita.
productsRouter.patch("/:id/tarifa-libra", requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({ price_per_pound: z.coerce.number().min(0) }).parse(req.body);
  const result = await pool.query(
    `UPDATE products SET price_per_pound = $2 WHERE id = $1
     RETURNING id, code, name, product_type, unit, is_active, price_per_pound, venta_detalle`,
    [req.params.id, body.price_per_pound]
  );
  if (!result.rows[0]) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  res.json(result.rows[0]);
}));

// Cambios seguros de un producto del catálogo: activo, tarifa por libra y venta al
// detalle. El nombre y el código NO se cambian (pedidos, kárdex y marcas los usan).
productsRouter.patch("/:id", requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    is_active: z.boolean().optional(),
    price_per_pound: z.number().nonnegative().max(9999).optional(),
    venta_detalle: z.boolean().optional()
  }).parse(req.body);
  if (Object.values(body).every((v) => v === undefined)) throw new ApiError(400, "Nada que actualizar.");
  await inTransaction((client) => actualizarProductoCatalogo(client, String(req.params.id), body));
  const [producto] = await listarCatalogo(pool, String(req.params.id));
  res.json(producto);
}));

// Agrega una presentación (peso en libras); en una marca crea también su saco.
productsRouter.post("/:id/presentaciones", requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({ peso_lb: z.number().positive().max(1000) }).parse(req.body);
  const out = await inTransaction((client) => agregarPresentacion(client, String(req.params.id), body.peso_lb));
  const [producto] = await listarCatalogo(pool, String(req.params.id));
  res.status(201).json({ ...out, producto });
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
