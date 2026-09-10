import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

// Nómina administrativa (personal de oficina) POR ACCIONISTA. Cada accionista
// (matriz y socios) administra su propio personal y le paga de su propia caja.
// Sueldo fijo QUINCENAL + incentivo opcional − descuentos. Todo lo scope el
// accionista activo (req.accionistaId, que deja resolveAccionista).
export const adminPayrollRouter = Router();

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function accId(req: unknown): string {
  const id = (req as AuthenticatedRequest).accionistaId;
  if (!id) throw new ApiError(400, "Selecciona un accionista activo");
  return id;
}

// ── Personal (staff) ────────────────────────────────────────────────────────
adminPayrollRouter.get("/staff", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT id, cargo, worker_name, base_salary::float AS base_salary, is_active
     FROM admin_staff
     WHERE accionista_id = $1 AND is_active = true
     ORDER BY worker_name`,
    [accId(req)]
  );
  res.json(result.rows);
}));

adminPayrollRouter.post("/staff", asyncRoute(async (req, res) => {
  const body = z.object({
    cargo: z.string().max(80).optional().default(""),
    worker_name: z.string().min(2),
    base_salary: z.coerce.number().min(0)
  }).parse(req.body);
  const result = await pool.query(
    `INSERT INTO admin_staff (accionista_id, cargo, worker_name, base_salary)
     VALUES ($1, $2, $3, $4)
     RETURNING id, cargo, worker_name, base_salary::float AS base_salary, is_active`,
    [accId(req), body.cargo.trim(), body.worker_name.trim(), body.base_salary]
  );
  res.status(201).json(result.rows[0]);
}));

adminPayrollRouter.put("/staff/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    cargo: z.string().max(80).optional(),
    worker_name: z.string().min(2).optional(),
    base_salary: z.coerce.number().min(0).optional()
  }).parse(req.body);
  const result = await pool.query(
    `UPDATE admin_staff SET
        cargo = COALESCE($3, cargo),
        worker_name = COALESCE($4, worker_name),
        base_salary = COALESCE($5, base_salary)
     WHERE id = $1 AND accionista_id = $2
     RETURNING id, cargo, worker_name, base_salary::float AS base_salary, is_active`,
    [req.params.id, accId(req), body.cargo?.trim() ?? null, body.worker_name?.trim() ?? null, body.base_salary ?? null]
  );
  if (!result.rows[0]) throw new ApiError(404, "Empleado no encontrado");
  res.json(result.rows[0]);
}));

// Baja lógica (no borra el histórico de pagos).
adminPayrollRouter.delete("/staff/:id", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `UPDATE admin_staff SET is_active = false WHERE id = $1 AND accionista_id = $2 RETURNING id`,
    [req.params.id, accId(req)]
  );
  if (!result.rows[0]) throw new ApiError(404, "Empleado no encontrado");
  res.json({ ok: true });
}));

// ── Pago de sueldo (sale de la caja del accionista activo) ───────────────────
adminPayrollRouter.post("/pay", asyncRoute(async (req, res) => {
  const body = z.object({
    staff_id: z.string().uuid(),
    incentivo: z.coerce.number().min(0).optional().default(0),
    descuentos: z.coerce.number().min(0).optional().default(0),
    periodo: z.string().max(40).optional(),
    cash_register_id: z.string().uuid()
  }).parse(req.body);
  const accionista = accId(req);
  const user = (req as AuthenticatedRequest).user;

  const result = await inTransaction(async (client) => {
    // La caja debe ser del accionista activo y estar abierta.
    const reg = await client.query(
      "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2 FOR UPDATE",
      [body.cash_register_id, accionista]
    );
    if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
    if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no está abierta");

    const staff = await client.query(
      "SELECT id, cargo, worker_name, base_salary::float AS base_salary FROM admin_staff WHERE id = $1 AND accionista_id = $2",
      [body.staff_id, accionista]
    );
    if (!staff.rows[0]) throw new ApiError(404, "Empleado no encontrado");

    const base = round2(Number(staff.rows[0].base_salary));
    const incentivo = round2(body.incentivo);
    const descuentos = round2(body.descuentos);
    const net = round2(Math.max(0, base + incentivo - descuentos));
    if (net <= 0) throw new ApiError(400, "El neto a pagar debe ser mayor a 0");

    await client.query(
      `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, amount, description, created_by)
       VALUES ($1, 'EXPENSE', 'PAGO_MANO_OBRA', 'admin_salary_payments', $2, $3, $4)`,
      [body.cash_register_id, net,
       `Sueldo ${staff.rows[0].cargo ? staff.rows[0].cargo + " " : ""}${staff.rows[0].worker_name}`, user?.id ?? null]
    );

    const pay = await client.query(
      `INSERT INTO admin_salary_payments
         (accionista_id, staff_id, worker_name, cargo, base_salary, incentivo, descuentos, net_amount, periodo, cash_register_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, worker_name, cargo, net_amount::float AS net_amount, paid_at`,
      [accionista, body.staff_id, staff.rows[0].worker_name, staff.rows[0].cargo, base, incentivo, descuentos, net, body.periodo ?? null, body.cash_register_id, user?.id ?? null]
    );
    return { base, incentivo, descuentos, paid: net, payment: pay.rows[0] };
  });

  res.json(result);
}));

// ── Historial de sueldos pagados ─────────────────────────────────────────────
adminPayrollRouter.get("/history", asyncRoute(async (req, res) => {
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const conds = ["accionista_id = $1"];
  const params: unknown[] = [accId(req)];
  if (q.from) { params.push(q.from); conds.push(`paid_at >= $${params.length}`); }
  if (q.to) { params.push(q.to); conds.push(`paid_at < ($${params.length}::date + 1)`); }
  const result = await pool.query(
    `SELECT id, worker_name, cargo,
            base_salary::float AS base_salary, incentivo::float AS incentivo,
            descuentos::float AS descuentos, net_amount::float AS net_amount,
            periodo, paid_at
     FROM admin_salary_payments
     WHERE ${conds.join(" AND ")}
     ORDER BY paid_at DESC
     LIMIT 500`,
    params
  );
  res.json(result.rows);
}));
