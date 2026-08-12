import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";

export const reportsRouter = Router();

// Rango de fechas: por defecto el mes en curso.
function parseRange(query: unknown): { from: string; to: string } {
  const schema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  });
  const { from, to } = schema.parse(query);
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    from: from ?? firstOfMonth.toISOString().slice(0, 10),
    to: to ?? today.toISOString().slice(0, 10)
  };
}

// Algunas tablas provienen de migraciones que pueden no estar aplicadas en
// todas las instalaciones. Consultamos su existencia (con caché) para que los
// reportes nunca fallen por una tabla ausente.
const tableCache = new Map<string, boolean>();
async function hasTable(name: string): Promise<boolean> {
  if (tableCache.has(name)) return tableCache.get(name)!;
  const r = await pool.query("SELECT to_regclass($1) AS reg", [`public.${name}`]);
  const exists = r.rows[0].reg !== null;
  tableCache.set(name, exists);
  return exists;
}

// Todos los reportes requieren rol administrador (datos financieros del negocio).
reportsRouter.use(requireAdmin);

// ── Arianos: arroz ya secado que aun no se procesa ──────────────────────────
// "Apartar como arianos" marca el secado para que deje de contar como pendiente
// de procesar. Reversible. Solo secados COMPLETED del accionista activo que
// todavia no tienen lote de produccion.
let arianosColReady: Promise<unknown> | null = null;
function ensureArianosColumns() {
  if (!arianosColReady) {
    arianosColReady = pool.query(
      `ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS apartado_arianos BOOLEAN NOT NULL DEFAULT false;
       ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS apartado_at TIMESTAMPTZ;
       ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS ubicacion_arianos VARCHAR(160)`
    );
  }
  return arianosColReady;
}

reportsRouter.get("/arianos", asyncRoute(async (req, res) => {
  await ensureArianosColumns();
  const acc = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT d.id, l.lot_code, d.rice_type,
            d.total_quintals::float AS quintals,
            d.dry_end_at, d.apartado_arianos, d.apartado_at, d.ubicacion_arianos
       FROM drying_tunnel_reports d
       JOIN lots l ON l.id = d.lot_id
      WHERE d.status = 'COMPLETED'
        AND l.accionista_id = $1
        AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id)
      ORDER BY d.dry_end_at DESC NULLS LAST`,
    [acc]
  );
  const pendientes = result.rows.filter((r) => !r.apartado_arianos);
  const apartados = result.rows.filter((r) => r.apartado_arianos);
  res.json({ pendientes, apartados });
}));

reportsRouter.post("/arianos/apartar", asyncRoute(async (req, res) => {
  await ensureArianosColumns();
  const body = z.object({
    ids: z.array(z.string().uuid()).min(1),
    apartar: z.boolean().default(true),
    ubicacion: z.string().trim().max(160).optional()
  }).parse(req.body);
  const acc = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `UPDATE drying_tunnel_reports d
        SET apartado_arianos = $2,
            apartado_at = CASE WHEN $2 THEN now() ELSE NULL END,
            ubicacion_arianos = CASE WHEN $2 THEN $4 ELSE NULL END
       FROM lots l
      WHERE d.lot_id = l.id
        AND d.id = ANY($1::uuid[])
        AND l.accionista_id = $3
        AND d.status = 'COMPLETED'
        AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id)
      RETURNING d.id`,
    [body.ids, body.apartar, acc, body.ubicacion ?? null]
  );
  res.json({ ok: true, updated: result.rowCount ?? 0, apartar: body.apartar });
}));

// Actualizar solo la ubicacion de un lote ya guardado (por si lo mueven de
// sitio). No cambia el estado ni la fecha en que se aparto.
reportsRouter.post("/arianos/ubicacion", asyncRoute(async (req, res) => {
  await ensureArianosColumns();
  const body = z.object({
    id: z.string().uuid(),
    ubicacion: z.string().trim().max(160).optional()
  }).parse(req.body);
  const acc = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `UPDATE drying_tunnel_reports d
        SET ubicacion_arianos = $2
       FROM lots l
      WHERE d.lot_id = l.id
        AND d.id = $1
        AND l.accionista_id = $3
        AND d.apartado_arianos = true
      RETURNING d.id`,
    [body.id, body.ubicacion ?? null, acc]
  );
  res.json({ ok: true, updated: result.rowCount ?? 0 });
}));

// ── Resumen consolidado del período ────────────────────────────────────────
reportsRouter.get("/summary", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const acc = (req as AuthenticatedRequest).accionistaId;
  const hasProduction = await hasTable("processing_batches");

  const [sales, liq, exp, cash, prod, ar, ap] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(total_amount),0)::float total, COUNT(*)::int cnt
       FROM sales WHERE sale_status <> 'CANCELLED' AND created_at::date BETWEEN $1 AND $2 AND accionista_id = $3`,
      [from, to, acc]
    ),
    pool.query(
      `SELECT COALESCE(SUM(net_amount),0)::float net, COALESCE(SUM(gross_amount),0)::float gross, COUNT(*)::int cnt
       FROM liquidations WHERE status <> 'CANCELLED' AND created_at::date BETWEEN $1 AND $2 AND accionista_id = $3`,
      [from, to, acc]
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount),0)::float total, COUNT(*)::int cnt
       FROM expenses WHERE created_at::date BETWEEN $1 AND $2 AND accionista_id = $3`,
      [from, to, acc]
    ),
    pool.query(
      `SELECT movement, COALESCE(SUM(amount),0)::float total
       FROM cash_movements
       WHERE created_at::date BETWEEN $1 AND $2
         AND cash_register_id IN (SELECT id FROM cash_registers WHERE accionista_id = $3)
       GROUP BY movement`,
      [from, to, acc]
    ),
    hasProduction
      ? pool.query(
          `SELECT COALESCE(SUM(input_quantity),0)::float input, COUNT(*)::int cnt
           FROM processing_batches WHERE created_at::date BETWEEN $1 AND $2 AND accionista_id = $3`,
          [from, to, acc]
        )
      : Promise.resolve({ rows: [{ input: 0, cnt: 0 }] }),
    pool.query(`SELECT COALESCE(SUM(balance),0)::float total FROM accounts_receivable WHERE status <> 'PAID' AND accionista_id = $1`, [acc]),
    pool.query(`SELECT COALESCE(SUM(balance),0)::float total FROM accounts_payable WHERE status <> 'PAID' AND accionista_id = $1`, [acc])
  ]);

  const cashIncome = cash.rows.find((r) => r.movement === "INCOME")?.total ?? 0;
  const cashExpense = cash.rows.find((r) => r.movement === "EXPENSE")?.total ?? 0;

  res.json({
    range: { from, to },
    sales: sales.rows[0],
    liquidations: liq.rows[0],
    expenses: exp.rows[0],
    cash: { income: cashIncome, expense: cashExpense, net: cashIncome - cashExpense },
    production: { input: prod.rows[0].input, cnt: prod.rows[0].cnt },
    receivable_outstanding: ar.rows[0].total,
    payable_outstanding: ap.rows[0].total
  });
}));

// ── Ventas: por producto, por cliente y por día ────────────────────────────
reportsRouter.get("/sales", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const acc = (req as AuthenticatedRequest).accionistaId;
  const [byProduct, byCustomer, daily] = await Promise.all([
    pool.query(
      `SELECT p.name, SUM(si.quantity)::float qty, SUM(si.total)::float total
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.sale_status <> 'CANCELLED' AND s.created_at::date BETWEEN $1 AND $2 AND s.accionista_id = $3
       GROUP BY p.name ORDER BY total DESC`,
      [from, to, acc]
    ),
    pool.query(
      `SELECT COALESCE(c.full_name, 'Consumidor final') name, COUNT(*)::int cnt, SUM(s.total_amount)::float total
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.sale_status <> 'CANCELLED' AND s.created_at::date BETWEEN $1 AND $2 AND s.accionista_id = $3
       GROUP BY 1 ORDER BY total DESC`,
      [from, to, acc]
    ),
    pool.query(
      `SELECT s.created_at::date d, COUNT(*)::int cnt, SUM(s.total_amount)::float total
       FROM sales s
       WHERE s.sale_status <> 'CANCELLED' AND s.created_at::date BETWEEN $1 AND $2 AND s.accionista_id = $3
       GROUP BY 1 ORDER BY 1`,
      [from, to, acc]
    )
  ]);
  res.json({ range: { from, to }, by_product: byProduct.rows, by_customer: byCustomer.rows, daily: daily.rows });
}));

// ── Liquidaciones por agricultor ───────────────────────────────────────────
reportsRouter.get("/liquidations", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const acc = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT f.full_name,
            COUNT(*)::int cnt,
            SUM(l.quintals)::float qq,
            SUM(l.gross_amount)::float gross,
            SUM(l.advances_discount + l.other_discounts)::float discounts,
            SUM(l.net_amount)::float net
     FROM liquidations l
     JOIN farmers f ON f.id = l.farmer_id
     WHERE l.status <> 'CANCELLED' AND l.created_at::date BETWEEN $1 AND $2 AND l.accionista_id = $3
     GROUP BY f.full_name ORDER BY net DESC`,
    [from, to, acc]
  );
  res.json({ range: { from, to }, rows: result.rows });
}));

// ── Gastos del período ─────────────────────────────────────────────────────
reportsRouter.get("/expenses", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const acc = (req as AuthenticatedRequest).accionistaId;
  const hasLabor = await hasTable("labor_payments");
  const [list, labor] = await Promise.all([
    pool.query(
      `SELECT created_at, description, paid_to, amount::float amount
       FROM expenses WHERE created_at::date BETWEEN $1 AND $2 AND accionista_id = $3 ORDER BY created_at DESC`,
      [from, to, acc]
    ),
    hasLabor
      ? pool.query(
          `SELECT COALESCE(SUM(total_amount),0)::float total, COUNT(*)::int cnt
           FROM labor_payments
           WHERE paid_at::date BETWEEN $1 AND $2
             AND cash_register_id IN (SELECT id FROM cash_registers WHERE accionista_id = $3)`,
          [from, to, acc]
        )
      : Promise.resolve({ rows: [{ total: 0, cnt: 0 }] })
  ]);
  res.json({ range: { from, to }, rows: list.rows, labor: labor.rows[0] });
}));

// ── Cuentas por cobrar con antigüedad (foto al día de hoy) ─────────────────
reportsRouter.get("/receivable-aging", asyncRoute(async (req, res) => {
  const acc = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT COALESCE(c.full_name, ar.description, 'Sin cliente') AS customer_name,
            c.phone AS phone,
            SUM(ar.balance)::float total,
            MAX(CURRENT_DATE - ar.created_at::date)::int oldest_days,
            SUM(CASE WHEN CURRENT_DATE - ar.created_at::date <= 30 THEN ar.balance ELSE 0 END)::float b0,
            SUM(CASE WHEN CURRENT_DATE - ar.created_at::date BETWEEN 31 AND 60 THEN ar.balance ELSE 0 END)::float b30,
            SUM(CASE WHEN CURRENT_DATE - ar.created_at::date BETWEEN 61 AND 90 THEN ar.balance ELSE 0 END)::float b60,
            SUM(CASE WHEN CURRENT_DATE - ar.created_at::date > 90 THEN ar.balance ELSE 0 END)::float b90
     FROM accounts_receivable ar
     LEFT JOIN customers c ON c.id = ar.customer_id
     WHERE ar.status IN ('CONFIRMED','PARTIAL') AND ar.balance > 0 AND ar.accionista_id = $1
     GROUP BY 1, 2
     ORDER BY total DESC`,
    [acc]
  );
  const totals = result.rows.reduce(
    (a, r) => ({
      total: a.total + r.total,
      b0: a.b0 + r.b0,
      b30: a.b30 + r.b30,
      b60: a.b60 + r.b60,
      b90: a.b90 + r.b90
    }),
    { total: 0, b0: 0, b30: 0, b60: 0, b90: 0 }
  );
  res.json({ rows: result.rows, totals });
}));

// ── Producción del período ─────────────────────────────────────────────────
reportsRouter.get("/production", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const acc = (req as AuthenticatedRequest).accionistaId;
  if (!(await hasTable("processing_batches"))) {
    res.json({ range: { from, to }, rows: [] });
    return;
  }
  const hasOutputs = await hasTable("processing_outputs");
  const outputExpr = hasOutputs
    ? `(SELECT COALESCE(SUM(o.quantity),0)::float FROM processing_outputs o WHERE o.processing_batch_id = b.id AND COALESCE(o.is_byproduct,false) = false)`
    : `0::float`;
  const result = await pool.query(
    `SELECT b.created_at, b.batch_number, l.lot_code,
            b.input_quantity::float input_qty,
            b.status,
            ${outputExpr} AS output_qty
     FROM processing_batches b
     LEFT JOIN lots l ON l.id = b.lot_id
     WHERE b.created_at::date BETWEEN $1 AND $2 AND b.accionista_id = $3
     ORDER BY b.created_at DESC`,
    [from, to, acc]
  );
  res.json({ range: { from, to }, rows: result.rows });
}));

// Combustible de secado: se muestra a nivel MOTOR (consumo real) y a nivel
// secadora (reparto proporcional). Todo es propiedad de CEYRO, así que no se
// filtra por accionista: se consolida el consumo de todos los socios.
reportsRouter.get("/fuel", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  if (!(await hasTable("drying_tunnel_reports"))) {
    res.json({ range: { from, to }, motors: [], rows: [], totals: { gas: 0, diesel: 0, total: 0 } });
    return;
  }

  const hasMotorFuel = await hasTable("motor_fuel_records");

  const motors = hasMotorFuel
    ? await pool.query(
        `SELECT m.created_at AS fecha,
                m.motor_number AS motor,
                (m.gas_bombona_inicio - m.gas_bombona_fin + m.gas_cilindro_cantidad)::float AS gas_consumo,
                m.gas_cilindro_cantidad::float AS gas_cilindros,
                (m.diesel_inicio - m.diesel_fin)::float AS diesel_consumo,
                m.gas_costo::float AS gas_costo,
                m.diesel_costo::float AS diesel_costo,
                m.costo_total::float AS total,
                m.total_quintals::float AS quintals
         FROM motor_fuel_records m
         WHERE m.created_at::date BETWEEN $1 AND $2
         ORDER BY m.created_at DESC, m.motor_number`,
        [from, to]
      )
    : { rows: [] };

  const rows = await pool.query(
    `SELECT COALESCE(d.dry_end_at, d.filled_at, d.created_at) AS fecha,
            d.dry_start_at, d.dry_end_at,
            CASE WHEN d.dry_start_at IS NOT NULL AND d.dry_end_at IS NOT NULL
                 THEN round(EXTRACT(EPOCH FROM (d.dry_end_at - d.dry_start_at))::numeric / 3600, 1)
            END::float AS horas_secado,
            d.dryer_name, d.tunnel_number, d.motor_number,
            d.total_quintals::float AS quintals,
            COALESCE(d.gas_costo_total, 0)::float AS gas_costo,
            COALESCE(d.diesel_costo, 0)::float AS diesel_costo,
            (COALESCE(d.gas_costo_total, 0) + COALESCE(d.diesel_costo, 0))::float AS total,
            CASE WHEN COALESCE(d.total_quintals, 0) > 0
                 THEN round(COALESCE(d.gas_costo_total, 0) / d.total_quintals, 2)
                 ELSE 0
            END::float AS costo_por_qq_gas,
            CASE WHEN COALESCE(d.total_quintals, 0) > 0
                 THEN round(COALESCE(d.diesel_costo, 0) / d.total_quintals, 2)
                 ELSE 0
            END::float AS costo_por_qq_diesel
     FROM drying_tunnel_reports d
     WHERE COALESCE(d.dry_end_at, d.filled_at, d.created_at)::date BETWEEN $1 AND $2
     ORDER BY fecha DESC, d.dryer_name`,
    [from, to]
  );

  const motorTotals = motors.rows.reduce(
    (a: { gas: number; diesel: number; total: number }, r: { gas_costo: number; diesel_costo: number; total: number }) =>
      ({ gas: a.gas + Number(r.gas_costo), diesel: a.diesel + Number(r.diesel_costo), total: a.total + Number(r.total) }),
    { gas: 0, diesel: 0, total: 0 }
  );

  res.json({ range: { from, to }, motors: motors.rows, rows: rows.rows, totals: motorTotals });
}));
