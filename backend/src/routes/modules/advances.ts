import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { nextCode } from "../../utils/codes.js";

export const advancesRouter = Router();

import { round2 } from "../../utils/rice-formulas.js";

const advanceSchema = z.object({
  farmer_id: z.string().uuid(),
  cash_register_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  concept: z.string().min(2),
  apply_to_payables: z.boolean().default(false),
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

    // Si se pide, aplicar el anticipo contra cuentas por pagar pendientes del agricultor
    if (data.apply_to_payables) {
      const payables = await client.query(
        `SELECT * FROM accounts_payable
         WHERE farmer_id = $1 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0
         ORDER BY created_at ASC
         FOR UPDATE`,
        [data.farmer_id]
      );

      let remaining = data.amount;
      const advanceId = advance.rows[0].id;

      for (const ap of payables.rows) {
        if (remaining <= 0) break;
        const applyAmt = Math.min(remaining, Number(ap.balance));
        const newBal = round2(Number(ap.balance) - applyAmt);
        const newStatus = newBal < 0.01 ? "PAID" : "PARTIAL";

        await client.query(
          "UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1",
          [ap.id, newBal, newStatus]
        );

        // Registrar la aplicación en advance_applications vinculada a la liquidación
        if (ap.liquidation_id) {
          await client.query(
            `INSERT INTO advance_applications (advance_id, liquidation_id, amount_applied)
             VALUES ($1, $2, $3)`,
            [advanceId, ap.liquidation_id, applyAmt]
          );
        }

        // Actualizar balance del anticipo
        await client.query(
          "UPDATE farmer_advances SET balance = balance - $2, status = CASE WHEN balance - $2 < 0.01 THEN 'PAID'::document_status ELSE 'PARTIAL'::document_status END WHERE id = $1",
          [advanceId, applyAmt]
        );

        remaining = round2(remaining - applyAmt);
      }
    }

    return advance.rows[0];
  });

  res.status(201).json(result);
}));
