import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { nextCode } from "../../utils/codes.js";

export const advancesRouter = Router();

const advanceSchema = z.object({
  farmer_id: z.string().uuid(),
  cash_register_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  concept: z.string().min(2),
  created_by: z.string().uuid().optional()
});

advancesRouter.get("/", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT a.*, f.full_name AS farmer_name
     FROM farmer_advances a
     JOIN farmers f ON f.id = a.farmer_id
     WHERE ($1::uuid IS NULL OR a.farmer_id = $1)
       AND ($2::text IS NULL OR a.status = $2::document_status)
     ORDER BY a.issued_at DESC`,
    [req.query.farmer_id ?? null, req.query.status ?? null]
  );
  res.json(result.rows);
}));

advancesRouter.post("/", asyncRoute(async (req, res) => {
  const data = advanceSchema.parse(req.body);
  const result = await inTransaction(async (client) => {
    const advance = await client.query(
      `INSERT INTO farmer_advances (farmer_id, advance_number, amount, balance, concept, created_by)
       VALUES ($1, $2, $3, $3, $4, $5)
       RETURNING *`,
      [data.farmer_id, nextCode("ANT"), data.amount, data.concept, data.created_by]
    );

    if (data.cash_register_id) {
      await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
         VALUES ($1, 'EXPENSE', 'ANTICIPO_AGRICULTOR', 'farmer_advances', $2, $3, $4, $5)`,
        [data.cash_register_id, advance.rows[0].id, data.amount, data.concept, data.created_by]
      );
    }

    return advance.rows[0];
  });

  res.status(201).json(result);
}));
