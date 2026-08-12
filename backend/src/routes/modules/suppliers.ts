import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";

export const suppliersRouter = Router();

// GET busqueda por nombre (autocompletado)
suppliersRouter.get("/search", asyncRoute(async (req, res) => {
  const query = ((req.query.q as string) || "").trim();
  if (query.length < 2) { res.json([]); return; }
  const result = await pool.query(
    `SELECT id, name, identification, phone FROM suppliers
     WHERE is_active = true AND (name ILIKE $1 OR identification ILIKE $1 OR phone ILIKE $1)
     ORDER BY name LIMIT 10`,
    [`%${query}%`]
  );
  res.json(result.rows);
}));

// GET todos (por defecto solo activos; ?all=1 incluye inactivos)
suppliersRouter.get("/", asyncRoute(async (req, res) => {
  const includeAll = req.query.all === "1" || req.query.all === "true";
  const result = await pool.query(
    includeAll
      ? `SELECT * FROM suppliers ORDER BY name`
      : `SELECT * FROM suppliers WHERE is_active = true ORDER BY name`
  );
  res.json(result.rows);
}));

// GET detalle
suppliersRouter.get("/:id", asyncRoute(async (req, res) => {
  const result = await pool.query(`SELECT * FROM suppliers WHERE id = $1`, [req.params.id]);
  if (!result.rows[0]) { res.status(404).json({ error: "Proveedor no encontrado" }); return; }
  res.json(result.rows[0]);
}));

// POST crear proveedor
suppliersRouter.post("/", asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    identification: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    address: z.string().optional(),
    notes: z.string().optional()
  }).parse(req.body);

  const dup = await pool.query("SELECT id FROM suppliers WHERE lower(name) = lower($1) LIMIT 1", [body.name]);
  if (dup.rows[0]) throw new ApiError(409, "Ya existe un proveedor con ese nombre");

  const result = await pool.query(
    `INSERT INTO suppliers (name, identification, phone, email, address, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [body.name, body.identification || null, body.phone || null, body.email || null, body.address || null, body.notes || null]
  );
  res.status(201).json(result.rows[0]);
}));

// PATCH actualizar / baja logica (is_active=false)
suppliersRouter.patch("/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2).optional(),
    identification: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    address: z.string().optional(),
    notes: z.string().optional(),
    is_active: z.boolean().optional()
  }).parse(req.body);

  if (body.name !== undefined) {
    const dup = await pool.query(
      "SELECT id FROM suppliers WHERE lower(name) = lower($1) AND id <> $2 LIMIT 1",
      [body.name, req.params.id]
    );
    if (dup.rows[0]) throw new ApiError(409, "Ya existe un proveedor con ese nombre");
  }

  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;
  for (const key of ["name","identification","phone","email","address","notes","is_active"] as const) {
    if (body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(body[key]); }
  }
  if (fields.length === 0) { res.status(400).json({ error: "Sin cambios" }); return; }

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE suppliers SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  if (!result.rows[0]) { res.status(404).json({ error: "Proveedor no encontrado" }); return; }
  res.json(result.rows[0]);
}));
