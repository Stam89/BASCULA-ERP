import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import type { Request, Response, NextFunction } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { ApiError } from "../../http/error-handler.js";

export const dashboardRouter = Router();

// El Panel Integral es del NEGOCIO COMPLETO (todos los accionistas). Lo ve el
// administrador, o un operador con el permiso "Dashboard" en el accionista
// activo (se concede a proposito por ser una vista global). requireAuth y
// resolveAccionista ya corrieron en la cadena global antes de este router.
async function requirePanelAccess(req: Request, _res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;
  if (!user) { next(new ApiError(401, "Sesion requerida")); return; }
  const accId = (req as AuthenticatedRequest).accionistaId ?? null;
  const r = await pool.query(
    `SELECT r.name AS role_name, COALESCE(ua.allowed_modules, '{}') AS mods
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_accionistas ua ON ua.user_id = u.id AND ua.accionista_id = $2
      WHERE u.id = $1`,
    [user.id, accId]
  );
  const row = r.rows[0] as { role_name: string | null; mods: string[] } | undefined;
  const mods: string[] = row?.mods ?? [];
  if (row?.role_name === "ADMINISTRADOR" || mods.includes("Dashboard")) { next(); return; }
  next(new ApiError(403, "No tienes acceso al Panel Integral."));
}

// ── Panel de Control Integral (todos los accionistas) ───────────────────────
// Vista consolidada para el dueño/admin: compras, ventas, inventario y bancos
// por accionista, con totales, utilidad, series de 6 meses y alertas.
dashboardRouter.get("/panel", requireAuth, requirePanelAccess, asyncRoute(async (req, res) => {
  const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
  const now = new Date();
  const monthStr = q.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [yy, mm] = monthStr.split("-").map(Number);
  const from = `${monthStr}-01`;
  const to = new Date(yy, mm, 0).toISOString().slice(0, 10); // último día del mes

  const [accionistas, compras, ventas, inventario, bancos, ar, ap, prestamos, comprasSerie, ventasSerie, seco] = await Promise.all([
    pool.query("SELECT id, name FROM accionistas WHERE is_active = true ORDER BY name"),
    pool.query(
      `SELECT accionista_id, COALESCE(SUM(gross_amount),0)::float total, COALESCE(SUM(quintals),0)::float qq, COUNT(*)::int cnt
       FROM liquidations WHERE status <> 'CANCELLED' AND created_at::date BETWEEN $1 AND $2
       GROUP BY accionista_id`, [from, to]),
    pool.query(
      `SELECT s.accionista_id, COALESCE(SUM(s.total_amount),0)::float total, COUNT(DISTINCT s.id)::int cnt,
              COALESCE(SUM(si.quantity),0)::float qq
       FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
       WHERE s.sale_status <> 'CANCELLED' AND s.created_at::date BETWEEN $1 AND $2
       GROUP BY s.accionista_id`, [from, to]),
    pool.query(
      `SELECT m.accionista_id,
              COALESCE(SUM(CASE WHEN p.code = 'CASCARA-011' THEN m.quantity ELSE 0 END),0)::float cascara_011,
              COALESCE(SUM(CASE WHEN p.code = 'CASCARA-CORRIENTE' THEN m.quantity ELSE 0 END),0)::float cascara_corriente,
              COALESCE(SUM(CASE WHEN p.code = 'ARROZ-PILADO-011' THEN m.quantity ELSE 0 END),0)::float producto_011,
              COALESCE(SUM(CASE WHEN p.code = 'ARROZ-PILADO-CORRIENTE' THEN m.quantity ELSE 0 END),0)::float producto_corriente,
              COALESCE(SUM(CASE WHEN p.code = 'ARROCILLO-34' THEN m.quantity ELSE 0 END),0)::float arrocillo_34,
              COALESCE(SUM(CASE WHEN p.code = 'ARROCILLO-FINO' THEN m.quantity ELSE 0 END),0)::float arrocillo_fino,
              COALESCE(SUM(CASE WHEN p.code = 'POLVILLO' THEN m.quantity ELSE 0 END),0)::float polvillo
       FROM inventory_movements m
       JOIN products p ON p.id = m.product_id
       WHERE m.ownership = 'OWNED'
       GROUP BY m.accionista_id`),
    pool.query(
      `SELECT cr.accionista_id,
              (COALESCE(SUM(cr.opening_balance),0) + COALESCE(SUM(mov.net),0))::float balance
       FROM cash_registers cr
       LEFT JOIN (
         SELECT cash_register_id, SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END) net
         FROM cash_movements GROUP BY cash_register_id
       ) mov ON mov.cash_register_id = cr.id
       GROUP BY cr.accionista_id`),
    pool.query(`SELECT COALESCE(SUM(balance),0)::float total, COUNT(DISTINCT customer_id)::int cnt FROM accounts_receivable WHERE status IN ('CONFIRMED','PARTIAL') AND balance > 0`),
    pool.query(`SELECT COALESCE(SUM(balance),0)::float total, COUNT(*)::int cnt FROM accounts_payable WHERE status IN ('CONFIRMED','PARTIAL') AND balance > 0`),
    pool.query(`SELECT COALESCE(SUM(balance),0)::float total, COUNT(DISTINCT farmer_id)::int cnt FROM farmer_advances WHERE status IN ('CONFIRMED','PARTIAL') AND balance > 0`),
    pool.query(
      `SELECT to_char(date_trunc('month', created_at),'YYYY-MM') m, COALESCE(SUM(gross_amount),0)::float total
       FROM liquidations WHERE status <> 'CANCELLED' AND created_at >= (date_trunc('month', $1::date) - interval '5 months')
       GROUP BY 1 ORDER BY 1`, [from]),
    pool.query(
      `SELECT to_char(date_trunc('month', created_at),'YYYY-MM') m, COALESCE(SUM(total_amount),0)::float total
       FROM sales WHERE sale_status <> 'CANCELLED' AND created_at >= (date_trunc('month', $1::date) - interval '5 months')
       GROUP BY 1 ORDER BY 1`, [from]),
    // SECO: cáscara ya secada pero AÚN NO molida (secados COMPLETED sin lote de
    // producción). Es lo mismo que aparece en el selector de Producción.
    pool.query(
      `SELECT l.accionista_id,
              COALESCE(SUM(CASE WHEN d.rice_type = '0.11' THEN d.total_quintals ELSE 0 END),0)::float seco_011,
              COALESCE(SUM(CASE WHEN d.rice_type = 'CORRIENTE' THEN d.total_quintals ELSE 0 END),0)::float seco_corriente
       FROM drying_tunnel_reports d
       JOIN lots l ON l.id = d.lot_id
       WHERE d.status = 'COMPLETED'
         AND COALESCE(d.apartado_arianos, false) = false
         AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id)
       GROUP BY l.accionista_id`)
  ]);

  const byAcc = (rows: Array<Record<string, unknown>>) => {
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) map.set(String(r.accionista_id), r);
    return map;
  };
  const comprasMap = byAcc(compras.rows), ventasMap = byAcc(ventas.rows), invMap = byAcc(inventario.rows), bancosMap = byAcc(bancos.rows), secoMap = byAcc(seco.rows);

  const perAccionista = accionistas.rows.map((a) => {
    const c = comprasMap.get(a.id), v = ventasMap.get(a.id), i = invMap.get(a.id), b = bancosMap.get(a.id), s = secoMap.get(a.id);
    return {
      id: a.id,
      name: a.name,
      compras_total: Number(c?.total ?? 0), compras_qq: Number(c?.qq ?? 0), compras_cnt: Number(c?.cnt ?? 0),
      ventas_total: Number(v?.total ?? 0), ventas_qq: Number(v?.qq ?? 0), ventas_cnt: Number(v?.cnt ?? 0),
      inventario_qq: 0, inventario_valor: 0,
      cascara_011: Number(i?.cascara_011 ?? 0),
      seco_011: Number(s?.seco_011 ?? 0),
      cascara_corriente: Number(i?.cascara_corriente ?? 0),
      seco_corriente: Number(s?.seco_corriente ?? 0),
      producto_011: Number(i?.producto_011 ?? 0),
      producto_corriente: Number(i?.producto_corriente ?? 0),
      arrocillo_34: Number(i?.arrocillo_34 ?? 0),
      arrocillo_fino: Number(i?.arrocillo_fino ?? 0),
      polvillo: Number(i?.polvillo ?? 0),
      banco_balance: Number(b?.balance ?? 0)
    };
  });

  const sum = (f: (x: typeof perAccionista[number]) => number) => Math.round(perAccionista.reduce((s, x) => s + f(x), 0) * 100) / 100;
  const totalCompras = sum((x) => x.compras_total);
  const totalVentas = sum((x) => x.ventas_total);
  const totalBancos = sum((x) => x.banco_balance);
  const utilidad = Math.round((totalVentas - totalCompras) * 100) / 100;
  const porCobrar = Number(ar.rows[0].total), porPagar = Number(ap.rows[0].total), totalPrestamos = Number(prestamos.rows[0].total);
  const saldoGeneral = Math.round((totalBancos + porCobrar - porPagar) * 100) / 100;

  // Serie de 6 meses (rellena meses sin datos con 0)
  const cSerie = new Map(comprasSerie.rows.map((r) => [r.m, Number(r.total)]));
  const vSerie = new Map(ventasSerie.rows.map((r) => [r.m, Number(r.total)]));
  const serie: Array<{ month: string; compras: number; ventas: number }> = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(yy, mm - 1 - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    serie.push({ month: key, compras: cSerie.get(key) ?? 0, ventas: vSerie.get(key) ?? 0 });
  }

  // Alertas automáticas
  const alertas: string[] = [];
  for (const x of perAccionista) {
    if (x.ventas_total > x.compras_total && x.compras_total > 0) alertas.push(`${x.name}: ventas superiores a compras (revisar)`);
  }
  if (porCobrar > 0) alertas.push(`${ar.rows[0].cnt} cuenta(s) por cobrar pendientes`);
  if (porPagar > 0) alertas.push(`${ap.rows[0].cnt} cuenta(s) por pagar pendientes`);

  res.json({
    month: monthStr,
    range: { from, to },
    kpis: { compras: totalCompras, ventas: totalVentas, utilidad, margen: totalVentas > 0 ? Math.round((utilidad / totalVentas) * 10000) / 100 : 0, bancos: totalBancos, saldo_general: saldoGeneral },
    per_accionista: perAccionista,
    totales: {
      compras_qq: sum((x) => x.compras_qq), ventas_qq: sum((x) => x.ventas_qq),
      inventario_qq: 0, inventario_valor: 0,
      cascara_011: sum((x) => x.cascara_011), cascara_corriente: sum((x) => x.cascara_corriente),
      seco_011: sum((x) => x.seco_011), seco_corriente: sum((x) => x.seco_corriente),
      producto_011: sum((x) => x.producto_011), producto_corriente: sum((x) => x.producto_corriente),
      arrocillo_34: sum((x) => x.arrocillo_34), arrocillo_fino: sum((x) => x.arrocillo_fino),
      polvillo: sum((x) => x.polvillo),
      compras_cnt: perAccionista.reduce((s, x) => s + x.compras_cnt, 0),
      ventas_cnt: perAccionista.reduce((s, x) => s + x.ventas_cnt, 0)
    },
    serie,
    por_cobrar: { total: porCobrar, cnt: ar.rows[0].cnt },
    por_pagar: { total: porPagar, cnt: ap.rows[0].cnt },
    prestamos: { total: totalPrestamos, cnt: prestamos.rows[0].cnt },
    alertas
  });
}));

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
