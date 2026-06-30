import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";

export const customersRouter = Router();

const customerSchema = z.object({
  full_name:     z.string().min(2),
  identification: z.string().optional(),
  phone:         z.string().optional(),
  address:       z.string().optional(),
  customer_type: z.enum(["NATURAL","EMPRESA"]).default("NATURAL")
});

customersRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT * FROM customers ORDER BY full_name");
  res.json(result.rows);
}));

customersRouter.post("/", asyncRoute(async (req, res) => {
  const data = customerSchema.parse(req.body);
  const result = await pool.query(
    `INSERT INTO customers (full_name, identification, phone, address, customer_type)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [data.full_name, data.identification ?? null, data.phone ?? null,
     data.address ?? null, data.customer_type]
  );
  res.status(201).json(result.rows[0]);
}));

customersRouter.delete("/:id", asyncRoute(async (req, res) => {
  await pool.query("DELETE FROM customers WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));
