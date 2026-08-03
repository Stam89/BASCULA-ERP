import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";

export const catalogsRouter = Router();

catalogsRouter.get("/branches", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT * FROM branches ORDER BY name ASC");
  res.json(result.rows);
}));

catalogsRouter.get("/warehouses", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT * FROM warehouses ORDER BY name ASC");
  res.json(result.rows);
}));

catalogsRouter.post("/warehouses", asyncRoute(async (req, res) => {
  const body = z.object({
    branch_id: z.string().uuid().optional(),
    name: z.string().min(2),
    type: z.string().default("GENERAL")
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO warehouses (branch_id, name, type)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [body.branch_id, body.name, body.type]
  );
  res.status(201).json(result.rows[0]);
}));

catalogsRouter.get("/vehicles", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT * FROM vehicles ORDER BY created_at DESC");
  res.json(result.rows);
}));

catalogsRouter.post("/vehicles", asyncRoute(async (req, res) => {
  const body = z.object({
    plate: z.string().min(3),
    owner_name: z.string().optional(),
    driver_name: z.string().optional(),
    phone: z.string().optional()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO vehicles (plate, owner_name, driver_name, phone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (plate) DO UPDATE SET
       owner_name = EXCLUDED.owner_name,
       driver_name = EXCLUDED.driver_name,
       phone = EXCLUDED.phone
     RETURNING *`,
    [body.plate.toUpperCase(), body.owner_name, body.driver_name, body.phone]
  );
  res.status(201).json(result.rows[0]);
}));

catalogsRouter.get("/customers", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT * FROM customers ORDER BY full_name ASC");
  res.json(result.rows);
}));

catalogsRouter.get("/accionistas", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT id, name, code FROM accionistas WHERE is_active = true ORDER BY name ASC");
  res.json(result.rows);
}));

catalogsRouter.post("/customers", asyncRoute(async (req, res) => {
  const body = z.object({
    identification: z.string().optional(),
    full_name: z.string().min(2),
    phone: z.string().optional(),
    address: z.string().optional(),
    customer_type: z.string().default("RETAIL")
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO customers (identification, full_name, phone, address, customer_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [body.identification, body.full_name, body.phone, body.address, body.customer_type]
  );
  res.status(201).json(result.rows[0]);
}));
