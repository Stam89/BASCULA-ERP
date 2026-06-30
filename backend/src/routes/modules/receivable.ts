import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { round2 } from "../../utils/rice-formulas.js";

export const receivableRouter = Router();

// GET cuentas por cobrar pendientes
receivableRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT ar.*,
            c.full_name AS customer_name,
            c.phone     AS customer_phone,
            s.sale_number
     FROM accounts_receivable ar
     LEFT JOIN customers c ON c.id = ar.customer_id
     LEFT JOIN sales s     ON s.id = ar.sale_id
     WHERE ar.status IN ('CONFIRMED','PARTIAL')
       AND ar.balance > 0
     ORDER BY ar.created_at DESC`
  );
  res.json(result.rows);
}));

// GET historial completo (incluye pagadas)
receivableRouter.get("/history", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT ar.*,
            c.full_name AS customer_name,
            s.sale_number
     FROM accounts_receivable ar
     LEFT JOIN customers c ON c.id = ar.customer_id
     LEFT JOIN sales s     ON s.id = ar.sale_id
     ORDER BY ar.created_at DESC
     LIMIT 200`
  );
  res.json(result.rows);
}));

// POST registrar pago de cuenta por cobrar
receivableRouter.post("/:id/pay", asyncRoute(async (req, res) => {
  const body = z.object({
    amount:           z.number().positive(),
    cash_register_id: z.string().uuid().optional(),
    concepto:         z.string().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const ar = await client.query(
      "SELECT * FROM accounts_receivable WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (!ar.rows[0]) throw new Error("Cuenta no encontrada");

    const current = Number(ar.rows[0].balance);
    if (body.amount > current + 0.01) {
      throw new Error(`El monto ($${body.amount}) supera el saldo pendiente ($${current.toFixed(2)})`);
    }

    const newBalance = round2(current - body.amount);
    const newStatus  = newBalance < 0.01 ? "PAID" : "PARTIAL";

    await client.query(
      "UPDATE accounts_receivable SET balance=$2, status=$3 WHERE id=$1",
      [req.params.id, newBalance, newStatus]
    );

    // Registrar ingreso en caja si hay una abierta
    if (body.cash_register_id) {
      const cust = await client.query(
        `SELECT c.full_name, s.sale_number
         FROM accounts_receivable ar
         LEFT JOIN customers c ON c.id = ar.customer_id
         LEFT JOIN sales s ON s.id = ar.sale_id
         WHERE ar.id = $1`,
        [req.params.id]
      );
      await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description)
         VALUES ($1,'INCOME','COBRO_CREDITO','accounts_receivable',$2,$3,$4)`,
        [body.cash_register_id, req.params.id, body.amount,
         `Cobro crédito: ${cust.rows[0]?.full_name ?? "cliente"} - ${cust.rows[0]?.sale_number ?? ""}`]
      );
    }

    return { paid: body.amount, remaining: newBalance, status: newStatus };
  });

  res.json(result);
}));
