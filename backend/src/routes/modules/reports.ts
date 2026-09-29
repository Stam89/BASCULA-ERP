import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { CATEGORIAS_NO_OPERATIVAS } from "../../services/resultado-mensual.js";

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

// Cada informe es INDIVIDUAL del accionista activo (el del menú lateral, que
// valida resolveAccionista). No se acepta pedir otro socio ni el consolidado
// «Todos» por parámetro: un accionista solo ve sus propios números.
function accionistaDelInforme(req: unknown): string {
  const id = (req as AuthenticatedRequest).accionistaId;
  if (!id) throw new ApiError(400, "Selecciona un accionista para ver sus informes.");
  return id;
}
// Movimientos de caja REALES: sin los anulados ni sus contra-asientos (si no,
// una anulación inflaría a la vez ingresos y egresos).
const MOV_VIGENTE = "cm.reversed_at IS NULL AND cm.reversal_of IS NULL";

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
  // Segmentación por socio (ver accionistaDelInforme). Cuando `acc` es null, el
  // patrón `$N::uuid IS NULL` desactiva el filtro (consolidado).
  const acc = accionistaDelInforme(req);
  // Alcance: 'cash' = solo liquidez real (movimientos de caja, comportamiento
  // actual, fuente de verdad intacta); 'accrued' = además suma lo DEVENGADO que
  // aún no pasó por caja (ventas a crédito por cobrar + liquidaciones por pagar).
  const scope = req.query.scope === "accrued" ? "accrued" : "cash";
  const hasProduction = await hasTable("processing_batches");

  const [sales, liq, exp, cash, prod, ar, ap, breakdown] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(total_amount),0)::float total, COUNT(*)::int cnt
       FROM sales WHERE sale_status <> 'CANCELLED' AND created_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR accionista_id = $3)`,
      [from, to, acc]
    ),
    pool.query(
      `SELECT COALESCE(SUM(net_amount),0)::float net, COALESCE(SUM(gross_amount),0)::float gross, COUNT(*)::int cnt
       FROM liquidations WHERE status <> 'CANCELLED' AND created_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR accionista_id = $3)`,
      [from, to, acc]
    ),
    // «Gastos» = egresos de caja OPERATIVOS (sin compra de cáscara/pagos a
    // agricultores, fomentos, activos fijos ni pagos entre socios). Antes leía la
    // tabla `expenses`, que ya no se usa (los gastos se registran en Caja).
    pool.query(
      `SELECT COALESCE(SUM(cm.amount),0)::float total, COUNT(*)::int cnt
       FROM cash_movements cm
       JOIN cash_registers cr ON cr.id = cm.cash_register_id
       WHERE cm.movement = 'EXPENSE' AND ${MOV_VIGENTE}
         AND cm.created_at::date BETWEEN $1 AND $2
         AND ($3::uuid IS NULL OR cr.accionista_id = $3)
         AND NOT (upper(cm.category) = ANY ($4::text[]))`,
      [from, to, acc, CATEGORIAS_NO_OPERATIVAS]
    ),
    pool.query(
      `SELECT cm.movement, COALESCE(SUM(cm.amount),0)::float total
       FROM cash_movements cm
       WHERE cm.created_at::date BETWEEN $1 AND $2 AND ${MOV_VIGENTE}
         AND cm.cash_register_id IN (SELECT id FROM cash_registers WHERE ($3::uuid IS NULL OR accionista_id = $3))
       GROUP BY cm.movement`,
      [from, to, acc]
    ),
    hasProduction
      ? pool.query(
          `SELECT COALESCE(SUM(input_quantity),0)::float input, COUNT(*)::int cnt
           FROM processing_batches WHERE created_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR accionista_id = $3)`,
          [from, to, acc]
        )
      : Promise.resolve({ rows: [{ input: 0, cnt: 0 }] }),
    pool.query(`SELECT COALESCE(SUM(balance),0)::float total FROM accounts_receivable WHERE status NOT IN ('PAID', 'CANCELLED') AND ($1::uuid IS NULL OR accionista_id = $1)`, [acc]),
    pool.query(`SELECT COALESCE(SUM(balance),0)::float total FROM accounts_payable WHERE status NOT IN ('PAID', 'CANCELLED') AND ($1::uuid IS NULL OR accionista_id = $1)`, [acc]),
    // Desglose del período: movimientos de caja (fecha, concepto, socio, tipo, monto).
    pool.query(
      `SELECT cm.created_at::date AS fecha,
              COALESCE(NULLIF(cm.description, ''), cm.category, 'Movimiento') AS concepto,
              a.name AS socio,
              cm.movement AS tipo,
              cm.amount::float AS monto
       FROM cash_movements cm
       JOIN cash_registers cr ON cr.id = cm.cash_register_id
       JOIN accionistas a ON a.id = cr.accionista_id
       WHERE cm.created_at::date BETWEEN $1 AND $2 AND ${MOV_VIGENTE}
         AND ($3::uuid IS NULL OR cr.accionista_id = $3)
       ORDER BY cm.created_at DESC
       LIMIT 300`,
      [from, to, acc]
    )
  ]);

  const cashIncome = cash.rows.find((r) => r.movement === "INCOME")?.total ?? 0;
  const cashExpense = cash.rows.find((r) => r.movement === "EXPENSE")?.total ?? 0;

  // Devengado (solo si scope='accrued'): lo que NO ha pasado por caja todavía.
  //  · Ventas a crédito por cobrar  → accounts_receivable ligadas a una venta,
  //    creadas en el período, con saldo pendiente (tipo CREDIT_IN).
  //  · Liquidaciones por pagar      → accounts_payable ligadas a una liquidación,
  //    creadas en el período, con saldo pendiente (tipo CREDIT_OUT).
  // No hay doble-conteo: lo ya cobrado/pagado vive en cash_movements; aquí solo
  // se toma el `balance` pendiente. No altera los números de caja.
  let accruedRows: Array<Record<string, unknown>> = [];
  let creditIn = 0;
  let creditOut = 0;
  if (scope === "accrued") {
    const [arDet, apDet] = await Promise.all([
      pool.query(
        `SELECT ar.created_at::date AS fecha,
                COALESCE(NULLIF(ar.description, ''), 'Venta a crédito') AS concepto,
                a.name AS socio, 'CREDIT_IN' AS tipo, ar.balance::float AS monto
         FROM accounts_receivable ar
         JOIN accionistas a ON a.id = ar.accionista_id
         WHERE ar.created_at::date BETWEEN $1 AND $2
           AND ar.sale_id IS NOT NULL AND ar.status NOT IN ('PAID', 'CANCELLED') AND ar.balance > 0
           AND ($3::uuid IS NULL OR ar.accionista_id = $3)
         ORDER BY ar.created_at DESC LIMIT 300`,
        [from, to, acc]
      ),
      pool.query(
        `SELECT ap.created_at::date AS fecha,
                ('Liquidación a ' || COALESCE(f.full_name, '—')) AS concepto,
                a.name AS socio, 'CREDIT_OUT' AS tipo, ap.balance::float AS monto
         FROM accounts_payable ap
         JOIN accionistas a ON a.id = ap.accionista_id
         LEFT JOIN farmers f ON f.id = ap.farmer_id
         WHERE ap.created_at::date BETWEEN $1 AND $2
           AND ap.liquidation_id IS NOT NULL AND ap.status NOT IN ('PAID', 'CANCELLED') AND ap.balance > 0
           AND ($3::uuid IS NULL OR ap.accionista_id = $3)
         ORDER BY ap.created_at DESC LIMIT 300`,
        [from, to, acc]
      )
    ]);
    creditIn = arDet.rows.reduce((s, r) => s + Number(r.monto), 0);
    creditOut = apDet.rows.reduce((s, r) => s + Number(r.monto), 0);
    accruedRows = [...arDet.rows, ...apDet.rows];
  }

  // Desglose final: caja + (si aplica) devengado, ordenado por fecha desc.
  const fullBreakdown = [...breakdown.rows, ...accruedRows]
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  res.json({
    range: { from, to },
    scope,
    consolidado: acc === null,
    sales: sales.rows[0],
    liquidations: liq.rows[0],
    expenses: exp.rows[0],
    cash: { income: cashIncome, expense: cashExpense, net: cashIncome - cashExpense },
    accrued: { receivable_pending: creditIn, payable_pending: creditOut },
    production: { input: prod.rows[0].input, cnt: prod.rows[0].cnt },
    receivable_outstanding: ar.rows[0].total,
    payable_outstanding: ap.rows[0].total,
    breakdown: fullBreakdown
  });
}));

// ── Ventas: por producto, por cliente y por día ────────────────────────────
reportsRouter.get("/sales", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const acc = accionistaDelInforme(req);
  const [byProduct, byCustomer, daily] = await Promise.all([
    pool.query(
      `SELECT p.name, SUM(si.quantity)::float qty, SUM(si.total)::float total
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       WHERE s.sale_status <> 'CANCELLED' AND s.created_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.accionista_id = $3)
       GROUP BY p.name ORDER BY total DESC`,
      [from, to, acc]
    ),
    pool.query(
      `SELECT COALESCE(c.full_name, 'Consumidor final') name, COUNT(*)::int cnt, SUM(s.total_amount)::float total
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.sale_status <> 'CANCELLED' AND s.created_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.accionista_id = $3)
       GROUP BY 1 ORDER BY total DESC`,
      [from, to, acc]
    ),
    pool.query(
      `SELECT s.created_at::date d, COUNT(*)::int cnt, SUM(s.total_amount)::float total
       FROM sales s
       WHERE s.sale_status <> 'CANCELLED' AND s.created_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR s.accionista_id = $3)
       GROUP BY 1 ORDER BY 1`,
      [from, to, acc]
    )
  ]);
  res.json({ range: { from, to }, by_product: byProduct.rows, by_customer: byCustomer.rows, daily: daily.rows });
}));

// ── Liquidaciones por agricultor ───────────────────────────────────────────
reportsRouter.get("/liquidations", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const acc = accionistaDelInforme(req);
  const result = await pool.query(
    `SELECT f.full_name,
            COUNT(*)::int cnt,
            SUM(l.quintals)::float qq,
            SUM(l.gross_amount)::float gross,
            SUM(l.advances_discount + l.other_discounts)::float discounts,
            SUM(l.net_amount)::float net
     FROM liquidations l
     JOIN farmers f ON f.id = l.farmer_id
     WHERE l.status <> 'CANCELLED' AND l.created_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR l.accionista_id = $3)
     GROUP BY f.full_name ORDER BY net DESC`,
    [from, to, acc]
  );
  res.json({ range: { from, to }, rows: result.rows });
}));

// ── Gastos del período: egresos REALES de Caja (sin anulados) ───────────────
// Antes leía la tabla `expenses`, que ya no se usa. Cada egreso trae su
// categoría de Caja; los «no operativos» (compra de cáscara, fomentos, activos
// fijos, pagos entre socios…) se marcan aparte para no confundirlos con gasto.
reportsRouter.get("/expenses", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const acc = accionistaDelInforme(req);
  const rows = (await pool.query(
    `SELECT cm.created_at, cm.category AS categoria_codigo, COALESCE(cc.nombre, cm.category) AS categoria,
            cm.subcategoria, NULLIF(cm.description, '') AS description, cm.amount::float AS amount,
            a.name AS socio, (upper(cm.category) = ANY ($4::text[])) AS no_operativo
       FROM cash_movements cm
       JOIN cash_registers cr ON cr.id = cm.cash_register_id
       JOIN accionistas a ON a.id = cr.accionista_id
       LEFT JOIN cash_categories cc ON cc.codigo = cm.category
      WHERE cm.movement = 'EXPENSE' AND ${MOV_VIGENTE}
        AND cm.created_at::date BETWEEN $1 AND $2
        AND ($3::uuid IS NULL OR cr.accionista_id = $3)
      ORDER BY cm.created_at DESC`,
    [from, to, acc, CATEGORIAS_NO_OPERATIVAS]
  )).rows as Array<{ categoria: string; amount: number; no_operativo: boolean }>;
  const porCat = new Map<string, { categoria: string; cnt: number; total: number; no_operativo: boolean }>();
  for (const r of rows) {
    const c = porCat.get(r.categoria) ?? { categoria: r.categoria, cnt: 0, total: 0, no_operativo: r.no_operativo };
    c.cnt += 1; c.total = Math.round((c.total + Number(r.amount)) * 100) / 100;
    porCat.set(r.categoria, c);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const operativo = r2(rows.filter((r) => !r.no_operativo).reduce((a2, r) => a2 + Number(r.amount), 0));
  const noOperativo = r2(rows.filter((r) => r.no_operativo).reduce((a2, r) => a2 + Number(r.amount), 0));
  res.json({
    range: { from, to },
    rows,
    por_categoria: [...porCat.values()].sort((x, y) => y.total - x.total),
    totals: { total: r2(operativo + noOperativo), operativo, no_operativo: noOperativo, cnt: rows.length }
  });
}));

// ── Cuentas por cobrar con antigüedad (foto al día de hoy) ─────────────────
reportsRouter.get("/receivable-aging", asyncRoute(async (req, res) => {
  const acc = accionistaDelInforme(req);
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
     WHERE ar.status IN ('CONFIRMED','PARTIAL') AND ar.balance > 0 AND ($1::uuid IS NULL OR ar.accionista_id = $1)
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
// Por proceso: cáscara que entró (kg y QQ), arroz pilado y subproductos (QQ),
// rendimiento y tipo del lote (propio / servicio). Antes mezclaba «Entrada» en
// kg con «Salida» en QQ sin decirlo.
reportsRouter.get("/production", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const acc = accionistaDelInforme(req);
  if (!(await hasTable("processing_batches"))) {
    res.json({ range: { from, to }, rows: [] });
    return;
  }
  const hasOutputs = await hasTable("processing_outputs");
  const salida = (sub: boolean) => hasOutputs
    ? `(SELECT COALESCE(SUM(o.quantity),0)::float FROM processing_outputs o WHERE o.processing_batch_id = b.id AND COALESCE(o.is_byproduct,false) = ${sub})`
    : `0::float`;
  const result = await pool.query(
    `SELECT b.created_at, b.finished_at, b.batch_number, l.lot_code, l.operation_type, a.name AS socio,
            b.input_quantity::float AS input_kg,
            COALESCE(
              (SELECT SUM(x.quintals) FROM processing_batch_drying_lots x WHERE x.processing_batch_id = b.id),
              (SELECT SUM(w.quintals) FROM weighing_tickets w WHERE w.lot_id = b.lot_id)
            )::float AS qq_cascara,
            ${salida(false)} AS output_qty,
            ${salida(true)} AS byproduct_qty,
            (SELECT py.yield_percent::float FROM production_yields py WHERE py.processing_batch_id = b.id ORDER BY py.created_at DESC LIMIT 1) AS yield_percent,
            b.status
     FROM processing_batches b
     LEFT JOIN lots l ON l.id = b.lot_id
     LEFT JOIN accionistas a ON a.id = b.accionista_id
     WHERE b.created_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR b.accionista_id = $3)
     ORDER BY b.created_at DESC`,
    [from, to, acc]
  );
  res.json({ range: { from, to }, rows: result.rows });
}));

// ── Servicios de la Matriz, por MES y solo los FINALIZADOS ──────────────────
// Un servicio cuenta el mes en que se FINALIZÓ (no cuando entró a báscula):
//   · Solo secado ........ al completar el secado (todos sus túneles/tendal).
//   · Servicio completo .. al finalizar el pilado (Producción).
//   · Solo pilado ........ al finalizar el pilado.
// Se separa en SOCIOS (lote de otro accionista que la Matriz seca y pila) y
// CLIENTES EXTERNOS (maquila). El arroz propio de la Matriz no es servicio.
// Es información de la Matriz: con otro socio activo se rechaza.
reportsRouter.get("/servicios", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const acc = accionistaId ? await pool.query("SELECT tipo FROM accionistas WHERE id = $1", [accionistaId]) : null;
  if (acc?.rows[0]?.tipo !== "MATRIZ") {
    res.status(403).json({ error: "El reporte de servicios es solo de la Matriz. Cambia a la Matriz para verlo." });
    return;
  }
  const q = z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
  const mes = q.mes ?? new Date().toISOString().slice(0, 7);
  const [y, m] = mes.split("-").map(Number);
  const ini = `${mes}-01`;
  const fin = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const r = await pool.query(
    `WITH base AS (
       SELECT l.id, l.lot_code, l.operation_type,
              (l.accionista_id IS NOT NULL AND l.accionista_id <> $1) AS es_socio,
              a.name AS socio,
              pil.fin AS pilado_fin,
              sec.fin AS secado_fin, COALESCE(sec.total, 0) AS secados, COALESCE(sec.pendientes, 0) AS secados_pendientes,
              (SELECT COALESCE(SUM(ps.quintals), 0) FROM pilado_services ps WHERE ps.lot_id = l.id)::float AS qq_pilado
         FROM lots l
         LEFT JOIN accionistas a ON a.id = l.accionista_id
         LEFT JOIN LATERAL (
           SELECT max(pb.finished_at) AS fin
             FROM processing_batches pb
            WHERE pb.status <> 'CANCELLED' AND pb.finished_at IS NOT NULL
              AND (pb.lot_id = l.id OR EXISTS (SELECT 1 FROM processing_batch_drying_lots x
                                                WHERE x.processing_batch_id = pb.id AND x.lot_id = l.id))
         ) pil ON true
         LEFT JOIN LATERAL (
           SELECT max(d.dry_end_at) AS fin, count(*) AS total,
                  count(*) FILTER (WHERE d.status::text <> 'COMPLETED') AS pendientes
             FROM drying_tunnel_reports d WHERE d.lot_id = l.id
         ) sec ON true
        WHERE l.status::text <> 'CANCELLED'
     ),
     tipado AS (
       SELECT b.*,
              CASE
                WHEN b.operation_type = 'SECADO' THEN 'SECADO'
                WHEN b.operation_type = 'PILADO' THEN 'PILADO'
                WHEN b.operation_type = 'SECADO_PILADO' THEN 'SECADO_PILADO'
                WHEN b.es_socio THEN CASE WHEN b.secados > 0 THEN 'SECADO_PILADO' ELSE 'PILADO' END
              END AS tipo
         FROM base b
     ),
     finalizado AS (
       SELECT t.*,
              CASE WHEN t.tipo = 'SECADO'
                   THEN CASE WHEN t.secados > 0 AND t.secados_pendientes = 0 THEN t.secado_fin END
                   ELSE t.pilado_fin END AS fecha_fin
         FROM tipado t
        WHERE t.tipo IS NOT NULL
     )
     SELECT f.id, f.lot_code, f.tipo, f.es_socio, f.socio, f.qq_pilado,
            (f.fecha_fin AT TIME ZONE 'America/Guayaquil') AS fecha,
            (SELECT string_agg(DISTINCT fa.full_name, ', ') FROM weighing_tickets w JOIN farmers fa ON fa.id = w.farmer_id WHERE w.lot_id = f.id) AS clientes,
            (SELECT string_agg(COALESCE(ms.raw_payload->>'numeroTicket', w.ticket_number), ', ' ORDER BY w.created_at)
               FROM weighing_tickets w LEFT JOIN mobile_synced_tickets ms ON ms.weighing_ticket_id = w.id WHERE w.lot_id = f.id) AS tickets,
            (SELECT string_agg(DISTINCT w.rice_type, ', ') FROM weighing_tickets w WHERE w.lot_id = f.id) AS rice_type,
            (SELECT COUNT(*) FROM weighing_tickets w WHERE w.lot_id = f.id)::int AS n_tickets,
            (SELECT COALESCE(SUM(w.net_weight), 0) FROM weighing_tickets w WHERE w.lot_id = f.id)::float AS kg,
            (SELECT COALESCE(SUM(w.quintals), 0) FROM weighing_tickets w WHERE w.lot_id = f.id)::float AS qq
       FROM finalizado f
      WHERE f.fecha_fin IS NOT NULL
        AND (f.fecha_fin AT TIME ZONE 'America/Guayaquil')::date >= $2::date
        AND (f.fecha_fin AT TIME ZONE 'America/Guayaquil')::date < $3::date
      ORDER BY f.fecha_fin ASC`,
    [accionistaId, ini, fin]
  );
  const tipos = ["SECADO_PILADO", "SECADO", "PILADO"] as const;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const sumar = (filas: typeof r.rows) => ({
    lotes: filas.length,
    tickets: filas.reduce((a2, x) => a2 + Number(x.n_tickets), 0),
    kg: r3(filas.reduce((a2, x) => a2 + Number(x.kg), 0)),
    qq: r3(filas.reduce((a2, x) => a2 + Number(x.qq), 0)),
    qq_pilado: r3(filas.reduce((a2, x) => a2 + Number(x.qq_pilado), 0))
  });
  const totales = Object.fromEntries(tipos.map((t) => {
    const filas = r.rows.filter((x) => x.tipo === t);
    return [t, { total: sumar(filas), socios: sumar(filas.filter((x) => x.es_socio)), externos: sumar(filas.filter((x) => !x.es_socio)) }];
  }));
  res.json({ mes, rows: r.rows, totales });
}));

// Combustible de secado: se muestra a nivel MOTOR (consumo real) y a nivel
// secadora (reparto proporcional). Todo es propiedad de CEYRO, así que no se
// filtra por accionista: se consolida el consumo de todos los socios.
reportsRouter.get("/fuel", asyncRoute(async (req, res) => {
  const accFuel = (req as AuthenticatedRequest).accionistaId ?? null;
  const tipoFuel = accFuel ? (await pool.query("SELECT tipo FROM accionistas WHERE id = $1", [accFuel])).rows[0]?.tipo : null;
  if (tipoFuel !== "MATRIZ") {
    res.status(403).json({ error: "El informe de combustible es de la planta (Matriz). Cambia a la Matriz para verlo." });
    return;
  }
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
