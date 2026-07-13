import { Router } from "express";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const [
    farmers,
    tickets,
    stock,
    pendingAdvances,
    pendingPayables,
    salesToday,
    cash
  ] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM farmers WHERE is_active = true"),
    pool.query("SELECT COUNT(*)::int AS count FROM weighing_tickets WHERE created_at::date = CURRENT_DATE AND accionista_id = $1", [accionistaId]),
    pool.query("SELECT COALESCE(SUM(quantity), 0)::numeric AS quantity FROM inventory_stock WHERE ownership = 'OWNED' AND accionista_id = $1", [accionistaId]),
    pool.query("SELECT COALESCE(SUM(balance), 0)::numeric AS amount FROM farmer_advances WHERE status IN ('CONFIRMED', 'PARTIAL') AND accionista_id = $1", [accionistaId]),
    pool.query("SELECT COALESCE(SUM(balance), 0)::numeric AS amount FROM accounts_payable WHERE status IN ('CONFIRMED', 'PARTIAL') AND accionista_id = $1", [accionistaId]),
    pool.query("SELECT COALESCE(SUM(total_amount), 0)::numeric AS amount FROM sales WHERE created_at::date = CURRENT_DATE AND accionista_id = $1", [accionistaId]),
    pool.query(
      `SELECT *
       FROM cash_registers
       WHERE status = 'OPEN' AND accionista_id = $1
       ORDER BY opened_at DESC
       LIMIT 1`,
      [accionistaId]
    )
  ]);

  res.json({
    active_farmers: farmers.rows[0].count,
    tickets_today: tickets.rows[0].count,
    owned_stock: Number(stock.rows[0].quantity),
    pending_advances: Number(pendingAdvances.rows[0].amount),
    pending_payables: Number(pendingPayables.rows[0].amount),
    sales_today: Number(salesToday.rows[0].amount),
    current_cash_register: cash.rows[0] ?? null
  });
}));
