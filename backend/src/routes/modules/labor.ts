import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";

export const laborRouter = Router();

type Queryable = { query: typeof pool.query };

// ── Tablas (migración automática) ──────────────────────────────────────────
let ready: Promise<void> | null = null;
export function ensureLaborTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS labor_rates (
        id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        pilador_per_qq NUMERIC(10,4) NOT NULL DEFAULT 0.15,
        pilador_per_saca NUMERIC(10,4) NOT NULL DEFAULT 0.15,
        estibador_per_qq NUMERIC(10,4) NOT NULL DEFAULT 0.10,
        estibador_per_saca NUMERIC(10,4) NOT NULL DEFAULT 0.25,
        estibador_per_arrocillo NUMERIC(10,4) NOT NULL DEFAULT 0.10,
        secador_guardiania NUMERIC(10,4) NOT NULL DEFAULT 10,
        secador_per_tunel NUMERIC(10,4) NOT NULL DEFAULT 5,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS worker_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_role VARCHAR(20) NOT NULL,
        worker_name VARCHAR(140) NOT NULL,
        work_date DATE NOT NULL DEFAULT CURRENT_DATE,
        reference_type VARCHAR(40),
        reference_id UUID,
        qq NUMERIC(14,3) NOT NULL DEFAULT 0,
        sacas NUMERIC(14,3) NOT NULL DEFAULT 0,
        arrocillo NUMERIC(14,3) NOT NULL DEFAULT 0,
        tunnels INT NOT NULL DEFAULT 0,
        base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        discount NUMERIC(14,2) NOT NULL DEFAULT 0,
        net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        status VARCHAR(12) NOT NULL DEFAULT 'PENDING',
        paid_at TIMESTAMPTZ,
        cash_register_id UUID,
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_worker_payments_date ON worker_payments (work_date DESC)`);
      // Anticipos/adelantos a trabajadores (se descuentan del pago semanal).
      await pool.query(`CREATE TABLE IF NOT EXISTS worker_advances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_role VARCHAR(20) NOT NULL,
        worker_name VARCHAR(140) NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        description TEXT,
        advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status VARCHAR(12) NOT NULL DEFAULT 'PENDING',
        applied_at TIMESTAMPTZ,
        cash_register_id UUID,
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_worker_advances_date ON worker_advances (advance_date DESC)`);
      // Fila única de tarifas por defecto.
      await pool.query(`INSERT INTO labor_rates (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    })();
  }
  return ready;
}

export type LaborRates = {
  pilador_per_qq: number;
  pilador_per_saca: number;
  estibador_per_qq: number;
  estibador_per_saca: number;
  estibador_per_arrocillo: number;
  secador_guardiania: number;
  secador_per_tunel: number;
  precio_gas_bombona: number;
  precio_gas_cilindro: number;
  precio_diesel: number;
};

async function getRates(db: Queryable = pool): Promise<LaborRates> {
  const r = await db.query(
    `INSERT INTO labor_rates (id) VALUES (1)
     ON CONFLICT (id) DO UPDATE SET id = 1
     RETURNING *`
  );
  const row = r.rows[0];
  return {
    pilador_per_qq: Number(row.pilador_per_qq),
    pilador_per_saca: Number(row.pilador_per_saca),
    estibador_per_qq: Number(row.estibador_per_qq),
    estibador_per_saca: Number(row.estibador_per_saca),
    estibador_per_arrocillo: Number(row.estibador_per_arrocillo),
    secador_guardiania: Number(row.secador_guardiania),
    secador_per_tunel: Number(row.secador_per_tunel),
    precio_gas_bombona: Number(row.precio_gas_bombona ?? 0),
    precio_gas_cilindro: Number(row.precio_gas_cilindro ?? 0),
    precio_diesel: Number(row.precio_diesel ?? 0)
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Crea los pagos de pilador y estibador de una pilada, usando las tarifas
// vigentes y las cantidades producidas. Se llama dentro de la transacción de
// finish-production. Nunca lanza: si falla, no debe tumbar la producción.
export async function createProductionWorkerPayments(
  client: PoolClient,
  opts: {
    batchId: string;
    piladorName?: string | null;
    estibadorName?: string | null;
    qq: number;
    sacas: number;
    arrocillo: number;
    createdBy?: string | null;
  }
): Promise<void> {
  try {
    await ensureLaborTables();
    const rates = await getRates(client);
    const qq = Number(opts.qq) || 0;
    const sacas = Number(opts.sacas) || 0;
    const arrocillo = Number(opts.arrocillo) || 0;

    const rows: Array<{ role: string; name: string; base: number }> = [];
    if (opts.piladorName && opts.piladorName.trim()) {
      rows.push({
        role: "PILADOR",
        name: opts.piladorName.trim(),
        base: round2(qq * rates.pilador_per_qq + sacas * rates.pilador_per_saca)
      });
    }
    if (opts.estibadorName && opts.estibadorName.trim()) {
      rows.push({
        role: "ESTIBADOR",
        name: opts.estibadorName.trim(),
        base: round2(qq * rates.estibador_per_qq + sacas * rates.estibador_per_saca + arrocillo * rates.estibador_per_arrocillo)
      });
    }

    for (const r of rows) {
      await client.query(
        `INSERT INTO worker_payments
           (worker_role, worker_name, reference_type, reference_id, qq, sacas, arrocillo, base_amount, net_amount, created_by)
         VALUES ($1, $2, 'processing_batch', $3, $4, $5, $6, $7, $7, $8)`,
        [r.role, r.name, opts.batchId, qq, sacas, arrocillo, r.base, opts.createdBy ?? null]
      );
    }
  } catch {
    // Auditar/nómina nunca debe romper la producción.
  }
}

// ── Tarifas ────────────────────────────────────────────────────────────────
laborRouter.get("/rates", asyncRoute(async (_req, res) => {
  await ensureLaborTables();
  res.json(await getRates());
}));

laborRouter.put("/rates", requireAdmin, asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const body = z.object({
    pilador_per_qq: z.number().nonnegative(),
    pilador_per_saca: z.number().nonnegative(),
    estibador_per_qq: z.number().nonnegative(),
    estibador_per_saca: z.number().nonnegative(),
    estibador_per_arrocillo: z.number().nonnegative(),
    secador_guardiania: z.number().nonnegative(),
    secador_per_tunel: z.number().nonnegative(),
    precio_gas_bombona: z.number().nonnegative().default(0),
    precio_gas_cilindro: z.number().nonnegative().default(0),
    precio_diesel: z.number().nonnegative().default(0)
  }).parse(req.body);

  await pool.query(
    `UPDATE labor_rates SET
       pilador_per_qq = $1, pilador_per_saca = $2,
       estibador_per_qq = $3, estibador_per_saca = $4, estibador_per_arrocillo = $5,
       secador_guardiania = $6, secador_per_tunel = $7,
       precio_gas_bombona = $8, precio_gas_cilindro = $9, precio_diesel = $10, updated_at = now()
     WHERE id = 1`,
    [body.pilador_per_qq, body.pilador_per_saca, body.estibador_per_qq, body.estibador_per_saca,
     body.estibador_per_arrocillo, body.secador_guardiania, body.secador_per_tunel,
     body.precio_gas_bombona, body.precio_gas_cilindro, body.precio_diesel]
  );
  res.json(await getRates());
}));

// ── Lista de pagos ─────────────────────────────────────────────────────────
laborRouter.get("/payments", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    role: z.enum(["PILADOR", "ESTIBADOR", "SECADOR"]).optional(),
    status: z.enum(["PENDING", "PAID"]).optional()
  }).parse(req.query);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (q.from) { params.push(q.from); conditions.push(`work_date >= $${params.length}`); }
  if (q.to) { params.push(q.to); conditions.push(`work_date <= $${params.length}`); }
  if (q.role) { params.push(q.role); conditions.push(`worker_role = $${params.length}`); }
  if (q.status) { params.push(q.status); conditions.push(`status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `SELECT * FROM worker_payments ${where} ORDER BY work_date DESC, created_at DESC LIMIT 500`,
    params
  );
  res.json(result.rows);
}));

// ── Resumen por trabajador (para el pago semanal) ──────────────────────────
laborRouter.get("/summary", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const today = new Date();
  const monday = new Date(today);
  const day = (monday.getDay() + 6) % 7; // 0 = lunes
  monday.setDate(monday.getDate() - day);
  const from = q.from ?? monday.toISOString().slice(0, 10);
  const to = q.to ?? today.toISOString().slice(0, 10);

  const result = await pool.query(
    `SELECT wp.worker_role, wp.worker_name,
            COUNT(*)::int cnt,
            SUM(wp.qq)::float qq,
            SUM(wp.sacas)::float sacas,
            SUM(wp.arrocillo)::float arrocillo,
            SUM(wp.base_amount)::float base_amount,
            SUM(wp.net_amount)::float net_amount,
            SUM(wp.net_amount) FILTER (WHERE wp.status = 'PENDING')::float pending_amount,
            SUM(wp.net_amount) FILTER (WHERE wp.status = 'PAID')::float paid_amount,
            (SELECT COALESCE(SUM(a.amount),0)::float FROM worker_advances a
             WHERE a.worker_role = wp.worker_role AND a.worker_name = wp.worker_name
               AND a.status = 'PENDING' AND a.advance_date BETWEEN $1 AND $2) AS advances
     FROM worker_payments wp
     WHERE wp.work_date BETWEEN $1 AND $2
     GROUP BY wp.worker_role, wp.worker_name
     ORDER BY wp.worker_role, net_amount DESC`,
    [from, to]
  );
  const rows = result.rows.map((r) => ({
    ...r,
    to_pay: round2(Math.max(0, (r.pending_amount ?? 0) - (r.advances ?? 0)))
  }));
  res.json({ range: { from, to }, rows });
}));

// ── Historial de pagos (semanas ya pagadas) ───────────────────────────────
laborRouter.get("/history", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const today = new Date();
  const past = new Date(today);
  past.setDate(past.getDate() - 60);
  const from = q.from ?? past.toISOString().slice(0, 10);
  const to = q.to ?? today.toISOString().slice(0, 10);

  const result = await pool.query(
    `SELECT wp.worker_role, wp.worker_name,
            date_trunc('week', wp.paid_at)::date AS week_start,
            COUNT(*)::int cnt,
            SUM(wp.qq)::float qq,
            SUM(wp.sacas)::float sacas,
            SUM(wp.arrocillo)::float arrocillo,
            SUM(wp.net_amount)::float earned,
            MAX(wp.paid_at) AS paid_at,
            (SELECT COALESCE(SUM(a.amount),0)::float FROM worker_advances a
             WHERE a.worker_role = wp.worker_role AND a.worker_name = wp.worker_name
               AND a.status = 'APPLIED'
               AND date_trunc('week', a.applied_at) = date_trunc('week', MAX(wp.paid_at))) AS advances_applied
     FROM worker_payments wp
     WHERE wp.status = 'PAID' AND wp.paid_at::date BETWEEN $1 AND $2
     GROUP BY wp.worker_role, wp.worker_name, date_trunc('week', wp.paid_at)
     ORDER BY week_start DESC, wp.worker_role, wp.worker_name`,
    [from, to]
  );
  res.json({ range: { from, to }, rows: result.rows });
}));

// ── Anticipos a trabajadores ───────────────────────────────────────────────
laborRouter.get("/advances", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    role: z.enum(["PILADOR", "ESTIBADOR", "SECADOR"]).optional(),
    name: z.string().optional()
  }).parse(req.query);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (q.from) { params.push(q.from); conditions.push(`advance_date >= $${params.length}`); }
  if (q.to) { params.push(q.to); conditions.push(`advance_date <= $${params.length}`); }
  if (q.role) { params.push(q.role); conditions.push(`worker_role = $${params.length}`); }
  if (q.name) { params.push(q.name); conditions.push(`worker_name = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM worker_advances ${where} ORDER BY advance_date DESC, created_at DESC LIMIT 500`, params);
  res.json(result.rows);
}));

laborRouter.post("/advances", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const body = z.object({
    worker_role: z.enum(["PILADOR", "ESTIBADOR", "SECADOR"]),
    worker_name: z.string().min(1),
    amount: z.number().positive(),
    description: z.string().optional(),
    advance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cash_register_id: z.string().uuid()
  }).parse(req.body);
  const user = (req as AuthenticatedRequest).user;

  const result = await inTransaction(async (client) => {
    const adv = await client.query(
      `INSERT INTO worker_advances (worker_role, worker_name, amount, description, advance_date, cash_register_id, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7)
       RETURNING *`,
      [body.worker_role, body.worker_name.trim(), body.amount, body.description ?? null, body.advance_date ?? null, body.cash_register_id, user?.id ?? null]
    );
    // El anticipo sale de caja en el momento en que se entrega.
    await client.query(
      `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
       VALUES ($1, 'EXPENSE', 'PAGO_MANO_OBRA', 'worker_advances', $2, $3, $4, $5)`,
      [body.cash_register_id, adv.rows[0].id, body.amount,
       `Anticipo ${body.worker_role.toLowerCase()} ${body.worker_name.trim()}`, user?.id ?? null]
    );
    return adv.rows[0];
  });
  res.status(201).json(result);
}));

// ── Ajustar descuento de un pago ───────────────────────────────────────────
laborRouter.put("/payments/:id", requireAdmin, asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const body = z.object({ discount: z.number().nonnegative() }).parse(req.body);
  const result = await pool.query(
    `UPDATE worker_payments
     SET discount = $2, net_amount = GREATEST(0, base_amount - $2)
     WHERE id = $1 AND status = 'PENDING'
     RETURNING *`,
    [req.params.id, body.discount]
  );
  if (!result.rowCount) throw new ApiError(400, "Pago no encontrado o ya pagado");
  res.json(result.rows[0]);
}));

// ── Secador: días detectados desde Secadora (reportes de secado) ───────────
laborRouter.get("/secador-suggestions", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const from = q.from ?? monday.toISOString().slice(0, 10);
  const to = q.to ?? today.toISOString().slice(0, 10);
  const rates = await getRates();

  const result = await pool.query(
    `SELECT sub.worker_name, sub.work_date, sub.tunnels,
            EXISTS(
              SELECT 1 FROM worker_payments wp
              WHERE wp.worker_role = 'SECADOR' AND wp.worker_name = sub.worker_name AND wp.work_date = sub.work_date
            ) AS already_generated
     FROM (
       -- El día de trabajo del secador es la fecha de llenado del túnel.
       SELECT COALESCE(NULLIF(TRIM(dryer_name), ''), 'Sin secador') AS worker_name,
              COALESCE(filled_at, dry_start_at::date, created_at::date) AS work_date,
              COUNT(DISTINCT tunnel_number)::int AS tunnels
       FROM drying_tunnel_reports
       WHERE COALESCE(filled_at, dry_start_at::date, created_at::date) BETWEEN $1 AND $2
       GROUP BY 1, 2
     ) sub
     ORDER BY sub.work_date DESC, sub.worker_name`,
    [from, to]
  ).catch(() => ({ rows: [] as Array<{ worker_name: string; work_date: string; tunnels: number; already_generated: boolean }> }));

  const rows = result.rows.map((r) => ({
    worker_name: r.worker_name,
    work_date: r.work_date,
    tunnels: r.tunnels,
    suggested_amount: round2(rates.secador_guardiania + rates.secador_per_tunel * r.tunnels),
    already_generated: r.already_generated
  }));
  res.json({ range: { from, to }, rows });
}));

// Crea pagos de secador por día (guardianía + túneles). Sirve para "generar"
// los días detectados de Secadora y para agregar días de solo guardianía.
laborRouter.post("/secador-days", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const body = z.object({
    days: z.array(z.object({
      worker_name: z.string().min(1),
      work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      tunnels: z.number().int().min(0).max(10)
    })).min(1)
  }).parse(req.body);
  const user = (req as AuthenticatedRequest).user;
  const rates = await getRates();

  const created = await inTransaction(async (client) => {
    let count = 0;
    for (const d of body.days) {
      const dup = await client.query(
        `SELECT 1 FROM worker_payments WHERE worker_role='SECADOR' AND worker_name=$1 AND work_date=$2 LIMIT 1`,
        [d.worker_name.trim(), d.work_date]
      );
      if (dup.rowCount) continue;
      const base = round2(rates.secador_guardiania + rates.secador_per_tunel * d.tunnels);
      await client.query(
        `INSERT INTO worker_payments (worker_role, worker_name, work_date, tunnels, base_amount, net_amount, created_by)
         VALUES ('SECADOR', $1, $2, $3, $4, $4, $5)`,
        [d.worker_name.trim(), d.work_date, d.tunnels, base, user?.id ?? null]
      );
      count++;
    }
    return count;
  });
  res.json({ created });
}));

// ── Pagar toda la semana de un trabajador de una vez ───────────────────────
laborRouter.post("/pay-worker", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const body = z.object({
    worker_role: z.enum(["PILADOR", "ESTIBADOR", "SECADOR"]),
    worker_name: z.string().min(1),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cash_register_id: z.string().uuid()
  }).parse(req.body);
  const user = (req as AuthenticatedRequest).user;

  const result = await inTransaction(async (client) => {
    const pending = await client.query(
      `SELECT * FROM worker_payments
       WHERE worker_role = $1 AND worker_name = $2 AND status = 'PENDING'
         AND work_date BETWEEN $3 AND $4
       FOR UPDATE`,
      [body.worker_role, body.worker_name, body.from, body.to]
    );
    if (!pending.rowCount) throw new ApiError(400, "No hay pagos pendientes de este trabajador en el período");

    const gross = round2(pending.rows.reduce((s: number, p: { net_amount: string }) => s + Number(p.net_amount), 0));

    // Anticipos pendientes del período: ya salieron de caja, se descuentan.
    const advResult = await client.query(
      `SELECT * FROM worker_advances
       WHERE worker_role = $1 AND worker_name = $2 AND status = 'PENDING'
         AND advance_date BETWEEN $3 AND $4
       FOR UPDATE`,
      [body.worker_role, body.worker_name, body.from, body.to]
    );
    const advances = round2(advResult.rows.reduce((s: number, a: { amount: string }) => s + Number(a.amount), 0));
    const net = round2(Math.max(0, gross - advances));

    const ids = pending.rows.map((p: { id: string }) => p.id);
    await client.query(
      `UPDATE worker_payments SET status = 'PAID', paid_at = now(), cash_register_id = $2 WHERE id = ANY($1)`,
      [ids, body.cash_register_id]
    );
    if (advResult.rowCount) {
      await client.query(
        `UPDATE worker_advances SET status = 'APPLIED', applied_at = now() WHERE id = ANY($1)`,
        [advResult.rows.map((a: { id: string }) => a.id)]
      );
    }
    // El anticipo ya salió de caja antes; ahora solo sale el saldo restante.
    if (net > 0) {
      await client.query(
        `INSERT INTO cash_movements
           (cash_register_id, movement, category, reference_type, amount, description, created_by)
         VALUES ($1, 'EXPENSE', 'PAGO_MANO_OBRA', 'worker_payments', $2, $3, $4)`,
        [body.cash_register_id, net,
         `Pago semana ${body.worker_role.toLowerCase()} ${body.worker_name}`, user?.id ?? null]
      );
    }
    return { gross, advances, paid: net, count: ids.length };
  });

  res.json(result);
}));

// ── Registrar el pago (egreso de caja) ─────────────────────────────────────
laborRouter.post("/payments/:id/pay", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const body = z.object({ cash_register_id: z.string().uuid() }).parse(req.body);
  const user = (req as AuthenticatedRequest).user;

  const result = await inTransaction(async (client) => {
    const wp = await client.query("SELECT * FROM worker_payments WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!wp.rows[0]) throw new ApiError(404, "Pago no encontrado");
    const p = wp.rows[0];
    if (p.status === "PAID") throw new ApiError(400, "Este pago ya fue registrado");
    const net = Number(p.net_amount);
    if (net <= 0) throw new ApiError(400, "El monto a pagar es cero");

    await client.query(
      `UPDATE worker_payments SET status = 'PAID', paid_at = now(), cash_register_id = $2 WHERE id = $1`,
      [req.params.id, body.cash_register_id]
    );
    await client.query(
      `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
       VALUES ($1, 'EXPENSE', 'PAGO_MANO_OBRA', 'worker_payments', $2, $3, $4, $5)`,
      [body.cash_register_id, req.params.id, net,
       `Pago ${p.worker_role.toLowerCase()} ${p.worker_name}`, user?.id ?? null]
    );
    return { paid: net };
  });

  res.json(result);
}));
