import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const inventoryRouter = Router();

inventoryRouter.get("/stock", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT
       s.product_id,
       s.warehouse_id,
       s.ownership,
       SUM(s.quantity) AS quantity,
       p.code,
       p.name AS product_name,
       p.product_type,
       p.unit,
       w.name AS warehouse_name
     FROM inventory_stock s
     JOIN products p ON p.id = s.product_id
     JOIN warehouses w ON w.id = s.warehouse_id
     WHERE s.accionista_id = $1
     GROUP BY s.product_id, s.warehouse_id, s.ownership, p.code, p.name, p.product_type, p.unit, w.name
     HAVING SUM(s.quantity) <> 0
     ORDER BY p.product_type, p.name, w.name`,
    [accionistaId]
  );
  res.json(result.rows);
}));

inventoryRouter.get("/products", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT * FROM products ORDER BY name ASC");
  res.json(result.rows);
}));

inventoryRouter.get("/warehouses", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT * FROM warehouses ORDER BY name ASC");
  res.json(result.rows);
}));

inventoryRouter.get("/insumos", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT *, stock_actual < nivel_critico AS is_critical
     FROM insumos
     ORDER BY nombre ASC`
  );
  res.json(result.rows);
}));

inventoryRouter.post("/insumos", asyncRoute(async (req, res) => {
  const body = z.object({
    nombre: z.string().min(2),
    stock_actual: z.number().nonnegative().default(0),
    nivel_critico: z.number().nonnegative().default(50),
    unidad: z.string().default("UNIDAD"),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const insumo = await client.query(
      `INSERT INTO insumos (nombre, stock_actual, nivel_critico, unidad)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (nombre) DO UPDATE SET
         stock_actual = EXCLUDED.stock_actual,
         nivel_critico = EXCLUDED.nivel_critico,
         unidad = EXCLUDED.unidad,
         updated_at = now()
       RETURNING *, stock_actual < nivel_critico AS is_critical`,
      [body.nombre, body.stock_actual, body.nivel_critico, body.unidad]
    );

    if (body.stock_actual > 0) {
      await client.query(
        `INSERT INTO insumo_movements
         (insumo_id, movement, quantity, reference_type, notes, created_by)
         VALUES ($1, 'ADJUSTMENT', $2, 'initial_stock', $3, $4)`,
        [insumo.rows[0].id, body.stock_actual, `Stock inicial ${body.nombre}`, body.created_by]
      );
    }

    return insumo.rows[0];
  });

  res.status(201).json(result);
}));

inventoryRouter.post("/insumos/:id/adjustments", asyncRoute(async (req, res) => {
  const body = z.object({
    quantity: z.number(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const current = await client.query(
      "SELECT * FROM insumos WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (!current.rowCount) {
      throw new ApiError(404, "Insumo no encontrado");
    }

    const nextStock = Number(current.rows[0].stock_actual) + body.quantity;
    if (nextStock < 0) {
      throw new ApiError(409, "Stock insuficiente para el ajuste");
    }

    const updated = await client.query(
      `UPDATE insumos
       SET stock_actual = $2, updated_at = now()
       WHERE id = $1
       RETURNING *, stock_actual < nivel_critico AS is_critical`,
      [req.params.id, nextStock]
    );
    await client.query(
      `INSERT INTO insumo_movements
       (insumo_id, movement, quantity, reference_type, notes, created_by)
       VALUES ($1, 'ADJUSTMENT', $2, 'manual_adjustment', $3, $4)`,
      [req.params.id, body.quantity, body.notes, body.created_by]
    );
    return updated.rows[0];
  });

  res.json(result);
}));

inventoryRouter.post("/products", asyncRoute(async (req, res) => {
  const body = z.object({
    code: z.string().min(2),
    name: z.string().min(2),
    product_type: z.string().min(2),
    unit: z.string().default("QQ")
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO products (code, name, product_type, unit)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       product_type = EXCLUDED.product_type,
       unit = EXCLUDED.unit,
       is_active = true
     RETURNING *`,
    [body.code, body.name, body.product_type, body.unit]
  );
  res.status(201).json(result.rows[0]);
}));

inventoryRouter.post("/warehouses", asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    type: z.string().default("GENERAL"),
    branch_id: z.string().uuid().optional()
  }).parse(req.body);

  const existing = await pool.query(
    "SELECT * FROM warehouses WHERE lower(name) = lower($1) LIMIT 1",
    [body.name]
  );

  if (existing.rowCount) {
    const result = await pool.query(
      `UPDATE warehouses
       SET type = $2,
           branch_id = COALESCE($3, branch_id),
           is_active = true
       WHERE id = $1
       RETURNING *`,
      [existing.rows[0].id, body.type, body.branch_id]
    );
    res.json(result.rows[0]);
    return;
  }

  const result = await pool.query(
    `INSERT INTO warehouses (branch_id, name, type)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [body.branch_id, body.name, body.type]
  );
  res.status(201).json(result.rows[0]);
}));

inventoryRouter.post("/adjustments", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    product_id: z.string().uuid(),
    warehouse_id: z.string().uuid(),
    lot_id: z.string().uuid().optional(),
    quantity: z.number(),
    ownership: z.enum(["OWNED", "MAQUILA", "SERVICE_ONLY"]).default("OWNED"),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO inventory_movements
     (product_id, warehouse_id, lot_id, movement, quantity, reference_type, ownership, notes, created_by, accionista_id)
     VALUES ($1, $2, $3, 'ADJUSTMENT', $4, 'manual_adjustment', $5, $6, $7, $8)
     RETURNING *`,
    [body.product_id, body.warehouse_id, body.lot_id, body.quantity, body.ownership, body.notes, body.created_by, accionistaId]
  );
  res.status(201).json(result.rows[0]);
}));

inventoryRouter.get("/movements", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT m.*, p.name AS product_name, w.name AS warehouse_name
     FROM inventory_movements m
     JOIN products p ON p.id = m.product_id
     JOIN warehouses w ON w.id = m.warehouse_id
     WHERE m.accionista_id = $1
     ORDER BY m.created_at DESC
     LIMIT 500`,
    [accionistaId]
  );
  res.json(result.rows);
}));
