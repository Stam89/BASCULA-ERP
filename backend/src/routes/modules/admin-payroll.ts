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

// ── Pendientes de cobro del período de corte ─────────────────────────────────
// El sueldo administrativo NO se acumula a diario: solo se habilita el cobro en
// las fechas de corte → día 15 (Quincena) o el ÚLTIMO día del mes (Fin de Mes).
// Fuera de esas fechas devuelve lista vacía (fecha_habilitada:false). En un corte
// válido, excluye al personal que YA cobró dentro de la ventana del corte:
//   · Quincena  → ventana [día 1 .. día 15]
//   · Fin de mes → ventana [día 16 .. último día]
adminPayrollRouter.get("/pending", asyncRoute(async (req, res) => {
  const accionista = accId(req);
  const meta = await pool.query(
    `SELECT EXTRACT(DAY FROM CURRENT_DATE)::int AS dom,
            EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day'))::int AS last_dom,
            to_char(CURRENT_DATE, 'YYYY-MM') AS ym`
  );
  const dom = Number(meta.rows[0].dom);
  const lastDom = Number(meta.rows[0].last_dom);
  const esQuincena = dom === 15;
  const esFinMes = dom === lastDom;
  if (!esQuincena && !esFinMes) {
    res.json({ fecha_habilitada: false, corte: null, periodo: null, dia_del_mes: dom, ultimo_dia_mes: lastDom, staff: [] });
    return;
  }
  const corte = esQuincena ? "QUINCENA" : "FIN_DE_MES";
  const periodo = `${meta.rows[0].ym}-${esQuincena ? "Q1" : "Q2"}`;
  // Ventana del corte actual (calculada en SQL desde CURRENT_DATE, coherente con
  // la decisión de arriba). El día 16 = inicio del mes + 15 días.
  const result = await pool.query(
    `WITH win AS (
       SELECT date_trunc('month', CURRENT_DATE)::date AS mstart,
              (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date AS mend
     ),
     ventana AS (
       SELECT
         CASE WHEN $2 THEN mstart ELSE (mstart + INTERVAL '15 days')::date END AS win_start,
         CASE WHEN $2 THEN (mstart + INTERVAL '15 days')::date ELSE (mend + INTERVAL '1 day')::date END AS win_end
       FROM win
     )
     SELECT s.id, s.cargo, s.worker_name, s.base_salary::float AS base_salary
     FROM admin_staff s, ventana v
     WHERE s.accionista_id = $1 AND s.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM admin_salary_payments p
         WHERE p.staff_id = s.id AND p.paid_at >= v.win_start AND p.paid_at < v.win_end
       )
     ORDER BY s.worker_name`,
    [accionista, esQuincena]
  );
  res.json({ fecha_habilitada: true, corte, periodo, dia_del_mes: dom, ultimo_dia_mes: lastDom, staff: result.rows });
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

    // Período de corte legible (Quincena / Fin de mes del mes en curso) si no se
    // indicó uno. paid_at (fecha_pago) lo pone la BD por defecto (now()).
    let periodo = body.periodo ?? null;
    if (!periodo) {
      const m = await client.query(
        `SELECT to_char(CURRENT_DATE, 'YYYY-MM') AS ym, EXTRACT(DAY FROM CURRENT_DATE)::int AS dom,
                EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day'))::int AS last_dom`
      );
      const dom = Number(m.rows[0].dom);
      periodo = `${m.rows[0].ym} · ${dom < 16 ? "Quincena" : "Fin de mes"}`;
    }

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
      [accionista, body.staff_id, staff.rows[0].worker_name, staff.rows[0].cargo, base, incentivo, descuentos, net, periodo, body.cash_register_id, user?.id ?? null]
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
