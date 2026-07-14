import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";

export const piladoRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;

// El proveedor del servicio es siempre el accionista principal (CEYRO).
const CEYRO_ID = "00000000-0000-0000-0000-000000000001";

// Lista servicios de pilado en un rango, con nombres de accionistas.
piladoRouter.get("/services", asyncRoute(async (req, res) => {
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const today = new Date();
  const from = q.from ?? new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = q.to ?? today.toISOString().slice(0, 10);

  const result = await pool.query(
    `SELECT s.id, s.service_date, s.quintals, s.rate_per_qq, s.total, s.notes,
            COALESCE(pc.name, s.client_name, 'Cliente') AS cliente,
            (s.client_accionista_id IS NULL) AS externo,
            COALESCE(ar.balance, 0)::float AS saldo,
            COALESCE(ar.status, 'PAID') AS estado
     FROM pilado_services s
     LEFT JOIN accionistas pc ON pc.id = s.client_accionista_id
     LEFT JOIN accounts_receivable ar ON ar.id = s.receivable_id
     WHERE s.service_date BETWEEN $1 AND $2
     ORDER BY s.service_date DESC, s.created_at DESC`,
    [from, to]
  );
  const total = result.rows.reduce((sm, r) => sm + Number(r.total), 0);
  const pendiente = result.rows.reduce((sm, r) => sm + Number(r.saldo), 0);
  res.json({ range: { from, to }, rows: result.rows, total: round2(total), pendiente: round2(pendiente) });
}));

// Saldo pendiente que cada cliente (accionista o externo) le debe a CEYRO.
piladoRouter.get("/balances", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT COALESCE(a.name, s.client_name, 'Cliente') AS name,
            (s.client_accionista_id IS NULL) AS externo,
            COALESCE(SUM(ar.balance), 0)::float AS saldo
     FROM pilado_services s
     JOIN accounts_receivable ar ON ar.id = s.receivable_id
     LEFT JOIN accionistas a ON a.id = s.client_accionista_id
     WHERE ar.status IN ('CONFIRMED', 'PARTIAL') AND ar.balance > 0
     GROUP BY 1, 2
     ORDER BY saldo DESC`
  );
  res.json(result.rows);
}));

// Registra un servicio de pilado (secado + pilado) que CEYRO le presta a otro
// accionista: genera cuenta por cobrar para CEYRO y por pagar para el cliente.
piladoRouter.post("/services", asyncRoute(async (req, res) => {
  const body = z.object({
    client_accionista_id: z.string().uuid().optional(),
    client_name: z.string().optional(),
    service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    quintals: z.number().positive(),
    rate_per_qq: z.number().nonnegative(),
    lot_id: z.string().uuid().optional(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  // Cliente: un accionista (genera también cuenta por pagar) o uno externo por
  // nombre (solo cuenta por cobrar para CEYRO).
  let clientName: string;
  if (body.client_accionista_id) {
    if (body.client_accionista_id === CEYRO_ID) throw new ApiError(400, "El servicio se le cobra a otro cliente, no a CEYRO.");
    const client = await pool.query("SELECT name FROM accionistas WHERE id = $1", [body.client_accionista_id]);
    if (!client.rowCount) throw new ApiError(404, "Accionista cliente no encontrado");
    clientName = client.rows[0].name;
  } else {
    const name = (body.client_name ?? "").trim();
    if (name.length < 2) throw new ApiError(400, "Elige un accionista o escribe el nombre del cliente externo.");
    clientName = name;
  }

  const total = round2(body.quintals * body.rate_per_qq);
  const desc = `Servicio de pilado (secado + pilado) a ${clientName}: ${body.quintals} QQ`;

  const result = await inTransaction(async (tx) => {
    // Ingreso / cuenta por cobrar para CEYRO (siempre).
    const ar = await tx.query(
      `INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance)
       VALUES ($1, 'pilado_service', NULL, $2, $3, $3)
       RETURNING id`,
      [CEYRO_ID, desc, total]
    );
    // Cuenta por pagar solo si el cliente es un accionista.
    let payableId: string | null = null;
    if (body.client_accionista_id) {
      const ap = await tx.query(
        `INSERT INTO accounts_payable (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance)
         VALUES ($1, NULL, 'pilado_service', NULL, $2, $3, $3)
         RETURNING id`,
        [body.client_accionista_id, desc, total]
      );
      payableId = ap.rows[0].id;
    }
    const service = await tx.query(
      `INSERT INTO pilado_services
         (service_date, provider_accionista_id, client_accionista_id, client_name, lot_id, quintals, rate_per_qq, total, receivable_id, payable_id, notes, created_by)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [body.service_date ?? null, CEYRO_ID, body.client_accionista_id ?? null, body.client_accionista_id ? null : clientName,
       body.lot_id ?? null, body.quintals, body.rate_per_qq, total, ar.rows[0].id, payableId, body.notes ?? null, body.created_by ?? null]
    );
    await tx.query("UPDATE accounts_receivable SET reference_id = $2 WHERE id = $1", [ar.rows[0].id, service.rows[0].id]);
    if (payableId) await tx.query("UPDATE accounts_payable SET reference_id = $2 WHERE id = $1", [payableId, service.rows[0].id]);
    return service.rows[0];
  });

  res.status(201).json({ ...result, cliente: clientName, total });
}));

// Registra el pago (total o parcial) de un servicio: salda por cobrar y por pagar.
piladoRouter.post("/services/:id/settle", asyncRoute(async (req, res) => {
  const body = z.object({ amount: z.number().positive().optional() }).parse(req.body);

  const result = await inTransaction(async (tx) => {
    const svc = await tx.query("SELECT receivable_id, payable_id FROM pilado_services WHERE id = $1", [req.params.id]);
    if (!svc.rowCount) throw new ApiError(404, "Servicio no encontrado");
    const { receivable_id, payable_id } = svc.rows[0];

    // La cuenta por cobrar de CEYRO existe siempre; es la fuente del saldo.
    const ar = await tx.query("SELECT balance FROM accounts_receivable WHERE id = $1 FOR UPDATE", [receivable_id]);
    const balance = Number(ar.rows[0]?.balance ?? 0);
    if (balance <= 0) throw new ApiError(400, "Este servicio ya está pagado.");

    const pay = round2(Math.min(body.amount ?? balance, balance));
    const newBalance = round2(balance - pay);
    const newStatus = newBalance < 0.01 ? "PAID" : "PARTIAL";

    await tx.query("UPDATE accounts_receivable SET balance = $2, status = $3 WHERE id = $1", [receivable_id, newBalance, newStatus]);
    if (payable_id) {
      await tx.query("UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1", [payable_id, newBalance, newStatus]);
    }
    return { paid: pay, remaining: newBalance, status: newStatus };
  });

  res.json(result);
}));
