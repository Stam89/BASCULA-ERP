import { Router } from "express";
import { z } from "zod";
import { inTransaction } from "../../db/transaction.js";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";

export const expensesRouter = Router();

expensesRouter.post("/", asyncRoute(async (req, res) => {
  const body = z.object({
    category_id: z.string().uuid().optional(),
    cash_register_id: z.string().uuid().optional(),
    amount: z.number().positive(),
    description: z.string().min(2),
    paid_to: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const expense = await client.query(
      `INSERT INTO expenses (category_id, cash_register_id, amount, description, paid_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [body.category_id, body.cash_register_id, body.amount, body.description, body.paid_to, body.created_by]
    );

    if (body.cash_register_id) {
      await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
         VALUES ($1, 'EXPENSE', 'GASTO_OPERATIVO', 'expenses', $2, $3, $4, $5)`,
        [body.cash_register_id, expense.rows[0].id, body.amount, body.description, body.created_by]
      );
    }

    return expense.rows[0];
  });

  res.status(201).json(result);
}));

expensesRouter.post("/labor-payments", asyncRoute(async (req, res) => {
  const body = z.object({
    cash_register_id: z.string().uuid().optional(),
    worker_group: z.string().min(2),
    sacks_moved: z.number().positive(),
    price_per_sack: z.number().nonnegative(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const total = roundCurrency(body.sacks_moved * body.price_per_sack);
  const result = await pool.query(
    `INSERT INTO labor_payments
     (cash_register_id, worker_group, sacks_moved, price_per_sack, total_amount, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [body.cash_register_id, body.worker_group, body.sacks_moved, body.price_per_sack, total, body.created_by]
  );
  res.status(201).json(result.rows[0]);
}));

expensesRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT * FROM expenses ORDER BY created_at DESC LIMIT 500");
  res.json(result.rows);
}));

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
