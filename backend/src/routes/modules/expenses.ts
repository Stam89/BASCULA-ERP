import { Router } from "express";
import { z } from "zod";
import { inTransaction } from "../../db/transaction.js";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { avisarSobregiro, exigirCajaAbiertaDelAccionista } from "../../services/caja.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const expensesRouter = Router();

expensesRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    category_id: z.string().uuid().optional(),
    cash_register_id: z.string().uuid().optional(),
    amount: z.number().positive(),
    description: z.string().min(2),
    paid_to: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    if (body.cash_register_id) {
      await exigirCajaAbiertaDelAccionista(client, body.cash_register_id, accionistaId);
      await avisarSobregiro(client, body.cash_register_id, body.amount, req);
    }
    const expense = await client.query(
      `INSERT INTO expenses (category_id, cash_register_id, amount, description, paid_to, created_by, accionista_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [body.category_id, body.cash_register_id, body.amount, body.description, body.paid_to, body.created_by, accionistaId]
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

// RETIRADO (auditoría de Caja 2026-10-08): pagaba cuadrilla por fuera de Nómina › Cuadrilla (se podía pagar dos
// veces) y en dos pasos sueltos. La cuadrilla se paga en Nómina.
expensesRouter.post("/labor-payments", asyncRoute(async (_req, res) => {
  res.status(410).json({ error: "El pago de cuadrilla se registra en Nómina › Cuadrilla (así no se paga dos veces)." });
}));

expensesRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    "SELECT * FROM expenses WHERE accionista_id = $1 ORDER BY created_at DESC LIMIT 500",
    [accionistaId]
  );
  res.json(result.rows);
}));
