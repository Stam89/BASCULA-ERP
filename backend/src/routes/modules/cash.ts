import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";

export const cashRouter = Router();

cashRouter.post("/registers/open", asyncRoute(async (req, res) => {
  const body = z.object({
    branch_id: z.string().uuid().optional(),
    name: z.string().default("Caja Principal"),
    opening_balance: z.number().nonnegative().default(0),
    opened_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO cash_registers (branch_id, name, opening_balance, opened_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [body.branch_id, body.name, body.opening_balance, body.opened_by]
  );
  res.status(201).json(result.rows[0]);
}));

cashRouter.get("/registers/current", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    "SELECT * FROM cash_registers WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1"
  );
  res.json(result.rows[0] ?? null);
}));

cashRouter.post("/movements", asyncRoute(async (req, res) => {
  const body = z.object({
    cash_register_id: z.string().uuid(),
    movement: z.enum(["INCOME", "EXPENSE"]),
    category: z.string(),
    amount: z.number().positive(),
    description: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [body.cash_register_id, body.movement, body.category, body.amount, body.description, body.created_by]
  );
  res.status(201).json(result.rows[0]);
}));

cashRouter.get("/registers/:id/movements", asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM cash_movements WHERE cash_register_id = $1 ORDER BY created_at DESC",
    [req.params.id]
  );
  res.json(result.rows);
}));
