import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";

export const cashRouter = Router();

// ── Abrir caja ──────────────────────────────────────────────────────────────
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

// ── Caja actual abierta ──────────────────────────────────────────────────────
cashRouter.get("/registers/current", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    "SELECT * FROM cash_registers WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1"
  );
  res.json(result.rows[0] ?? null);
}));

// ── Resumen de caja (balance) ────────────────────────────────────────────────
cashRouter.get("/registers/:id/summary", asyncRoute(async (req, res) => {
  const reg = await pool.query("SELECT * FROM cash_registers WHERE id = $1", [req.params.id]);
  if (!reg.rows[0]) { res.status(404).json({ error: "Caja no encontrada" }); return; }

  const totals = await pool.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE movement = 'INCOME'), 0) AS total_income,
       COALESCE(SUM(amount) FILTER (WHERE movement = 'EXPENSE'), 0) AS total_expense
     FROM cash_movements
     WHERE cash_register_id = $1`,
    [req.params.id]
  );

  const opening = Number(reg.rows[0].opening_balance);
  const income = Number(totals.rows[0].total_income);
  const expense = Number(totals.rows[0].total_expense);

  res.json({
    ...reg.rows[0],
    total_income: income,
    total_expense: expense,
    current_balance: opening + income - expense
  });
}));

// ── Cerrar caja ──────────────────────────────────────────────────────────────
cashRouter.post("/registers/:id/close", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `UPDATE cash_registers SET status = 'CLOSED', closed_at = NOW()
     WHERE id = $1 AND status = 'OPEN'
     RETURNING *`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(400).json({ error: "Caja no está abierta o no existe" }); return; }
  res.json(result.rows[0]);
}));

// ── Movimientos de una caja ──────────────────────────────────────────────────
cashRouter.get("/registers/:id/movements", asyncRoute(async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM cash_movements WHERE cash_register_id = $1 ORDER BY created_at DESC",
    [req.params.id]
  );
  res.json(result.rows);
}));

// ── Registrar movimiento manual (ingreso o egreso) ───────────────────────────
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

// ── Cuentas por pagar pendientes ─────────────────────────────────────────────
cashRouter.get("/payables", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT ap.*, f.full_name AS farmer_name,
            l.liquidation_number
     FROM accounts_payable ap
     JOIN farmers f ON f.id = ap.farmer_id
     LEFT JOIN liquidations l ON l.id = ap.liquidation_id
     WHERE ap.status IN ('CONFIRMED', 'PARTIAL')
     ORDER BY ap.created_at DESC`
  );
  res.json(result.rows);
}));

// ── Pagar cuenta por pagar ───────────────────────────────────────────────────
cashRouter.post("/payables/:id/pay", asyncRoute(async (req, res) => {
  const body = z.object({
    cash_register_id: z.string().uuid(),
    amount: z.number().positive()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const ap = await client.query(
      "SELECT * FROM accounts_payable WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (!ap.rows[0]) throw new Error("Cuenta por pagar no encontrada");

    const current = Number(ap.rows[0].balance);
    if (body.amount > current + 0.001) throw new Error(`El monto supera el saldo pendiente ($${current.toFixed(2)})`);

    const newBalance = Math.max(0, current - body.amount);
    const newStatus = newBalance < 0.01 ? "PAID" : "PARTIAL";

    await client.query(
      "UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1",
      [req.params.id, newBalance, newStatus]
    );

    await client.query(
      `INSERT INTO cash_movements
       (cash_register_id, movement, category, reference_type, reference_id, amount, description)
       VALUES ($1, 'EXPENSE', 'PAGO_AGRICULTOR', 'accounts_payable', $2, $3, $4)`,
      [body.cash_register_id, req.params.id, body.amount,
       `Pago a ${ap.rows[0].farmer_id} - ${ap.rows[0].id.slice(0, 8)}`]
    );

    return { paid: body.amount, remaining: newBalance, status: newStatus };
  });

  res.json(result);
}));
