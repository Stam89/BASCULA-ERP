import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";

export const cuadrillaRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Actividades (catálogo con valor unitario) ───────────────────────────────

cuadrillaRouter.get("/activities", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    "SELECT id, name, unit_rate, is_active FROM cuadrilla_activities WHERE is_active = true ORDER BY name"
  );
  res.json(result.rows);
}));

cuadrillaRouter.post("/activities", asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    unit_rate: z.number().nonnegative()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO cuadrilla_activities (name, unit_rate)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET unit_rate = EXCLUDED.unit_rate, is_active = true
     RETURNING id, name, unit_rate, is_active`,
    [body.name.trim().toUpperCase(), body.unit_rate]
  );
  res.status(201).json(result.rows[0]);
}));

cuadrillaRouter.put("/activities/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    unit_rate: z.number().nonnegative().optional(),
    is_active: z.boolean().optional()
  }).parse(req.body);

  const result = await pool.query(
    `UPDATE cuadrilla_activities
     SET unit_rate = COALESCE($2, unit_rate),
         is_active = COALESCE($3, is_active)
     WHERE id = $1
     RETURNING id, name, unit_rate, is_active`,
    [req.params.id, body.unit_rate ?? null, body.is_active ?? null]
  );
  if (!result.rowCount) throw new ApiError(404, "Actividad no encontrada");
  res.json(result.rows[0]);
}));

// ── Entradas (registro diario por actividad) ────────────────────────────────

function parseRange(query: unknown): { from: string; to: string } {
  const schema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  });
  const { from, to } = schema.parse(query);
  const today = new Date();
  const monday = new Date(today);
  const day = (today.getDay() + 6) % 7; // 0 = lunes
  monday.setDate(today.getDate() - day);
  return {
    from: from ?? monday.toISOString().slice(0, 10),
    to: to ?? today.toISOString().slice(0, 10)
  };
}

cuadrillaRouter.get("/entries", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const result = await pool.query(
    `SELECT id, work_date, activity_name, worker_name, quantity, unit_rate, subtotal, notes
     FROM cuadrilla_entries
     WHERE work_date BETWEEN $1 AND $2
     ORDER BY work_date DESC, created_at DESC`,
    [from, to]
  );
  const total = result.rows.reduce((s, r) => s + Number(r.subtotal), 0);
  res.json({ range: { from, to }, rows: result.rows, total: round2(total) });
}));

cuadrillaRouter.post("/entries", asyncRoute(async (req, res) => {
  const body = z.object({
    work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    activity_id: z.string().uuid(),
    worker_name: z.string().optional().default(""),
    quantity: z.number().positive(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const activity = await pool.query(
    "SELECT name, unit_rate FROM cuadrilla_activities WHERE id = $1",
    [body.activity_id]
  );
  if (!activity.rowCount) throw new ApiError(404, "Actividad no encontrada");

  const rate = Number(activity.rows[0].unit_rate);
  const subtotal = round2(body.quantity * rate);

  const result = await pool.query(
    `INSERT INTO cuadrilla_entries
       (work_date, activity_id, activity_name, worker_name, quantity, unit_rate, subtotal, notes, created_by)
     VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, work_date, activity_name, worker_name, quantity, unit_rate, subtotal, notes`,
    [
      body.work_date ?? null,
      body.activity_id,
      activity.rows[0].name,
      body.worker_name.trim(),
      body.quantity,
      rate,
      subtotal,
      body.notes ?? null,
      body.created_by ?? null
    ]
  );
  res.status(201).json(result.rows[0]);
}));

cuadrillaRouter.delete("/entries/:id", asyncRoute(async (req, res) => {
  const result = await pool.query("DELETE FROM cuadrilla_entries WHERE id = $1 RETURNING id", [req.params.id]);
  if (!result.rowCount) throw new ApiError(404, "Registro no encontrado");
  res.status(204).end();
}));

// ── Resumen por persona (total ganado, anticipos pendientes, neto) ──────────

cuadrillaRouter.get("/summary", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const earned = await pool.query(
    `SELECT worker_name,
            COUNT(*)::int AS entradas,
            COALESCE(SUM(subtotal), 0)::float AS total
     FROM cuadrilla_entries
     WHERE work_date BETWEEN $1 AND $2
     GROUP BY worker_name
     ORDER BY total DESC`,
    [from, to]
  );
  const advances = await pool.query(
    `SELECT worker_name, COALESCE(SUM(balance), 0)::float AS pending
     FROM cuadrilla_advances
     WHERE status IN ('PENDING', 'PARTIAL')
     GROUP BY worker_name`
  );
  const pendingByWorker = new Map<string, number>(
    advances.rows.map((r) => [r.worker_name, Number(r.pending)])
  );

  const rows = earned.rows.map((r) => {
    const pending = pendingByWorker.get(r.worker_name) ?? 0;
    return {
      worker_name: r.worker_name,
      entradas: r.entradas,
      total: round2(Number(r.total)),
      anticipos: round2(pending),
      neto: round2(Number(r.total) - pending)
    };
  });

  res.json({
    range: { from, to },
    rows,
    total_general: round2(rows.reduce((s, r) => s + r.total, 0)),
    total_anticipos: round2(rows.reduce((s, r) => s + r.anticipos, 0)),
    total_neto: round2(rows.reduce((s, r) => s + r.neto, 0))
  });
}));

// ── Anticipos de la cuadrilla ───────────────────────────────────────────────

cuadrillaRouter.get("/advances", asyncRoute(async (req, res) => {
  const status = z.object({ status: z.enum(["pending", "all"]).optional() }).parse(req.query).status ?? "pending";
  const where = status === "pending" ? "WHERE status IN ('PENDING', 'PARTIAL')" : "";
  const result = await pool.query(
    `SELECT id, worker_name, amount, balance, concept, status, issued_at
     FROM cuadrilla_advances
     ${where}
     ORDER BY issued_at DESC`
  );
  res.json(result.rows);
}));

cuadrillaRouter.post("/advances", asyncRoute(async (req, res) => {
  const body = z.object({
    worker_name: z.string().min(2),
    amount: z.number().positive(),
    concept: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO cuadrilla_advances (worker_name, amount, balance, concept, created_by)
     VALUES ($1, $2, $2, $3, $4)
     RETURNING id, worker_name, amount, balance, concept, status, issued_at`,
    [body.worker_name.trim(), body.amount, body.concept ?? null, body.created_by ?? null]
  );
  res.status(201).json(result.rows[0]);
}));

// Salda (total o parcial) un anticipo pendiente.
cuadrillaRouter.post("/advances/:id/settle", asyncRoute(async (req, res) => {
  const body = z.object({ amount: z.number().positive().optional() }).parse(req.body);
  const current = await pool.query("SELECT balance FROM cuadrilla_advances WHERE id = $1", [req.params.id]);
  if (!current.rowCount) throw new ApiError(404, "Anticipo no encontrado");

  const balance = Number(current.rows[0].balance);
  const pay = round2(Math.min(body.amount ?? balance, balance));
  const newBalance = round2(balance - pay);
  const newStatus = newBalance < 0.01 ? "PAID" : "PARTIAL";

  const result = await pool.query(
    "UPDATE cuadrilla_advances SET balance = $2, status = $3 WHERE id = $1 RETURNING id, worker_name, amount, balance, status",
    [req.params.id, newBalance, newStatus]
  );
  res.json(result.rows[0]);
}));
