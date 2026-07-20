import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";
import {
  getBalanceGeneral,
  getEstadoResultados,
  getFlujoCaja,
  getIndicadores,
  getDashboardFinanciero,
  getActivosFijos
} from "../../services/finance.js";

export const financeRouter = Router();

const hoy = () => new Date().toISOString().slice(0, 10);
const inicioAnio = () => `${new Date().getFullYear()}-01-01`;

/** Rango del período: por defecto, el año en curso hasta hoy. */
function rango(req: { query: Record<string, unknown> }) {
  const q = z.object({ desde: z.string().optional(), hasta: z.string().optional() }).parse(req.query);
  return { desde: q.desde ?? inicioAnio(), hasta: q.hasta ?? hoy() };
}

function accionista(req: AuthenticatedRequest): string {
  const id = req.accionistaId;
  if (!id) throw new ApiError(400, "Selecciona un accionista");
  return id;
}

financeRouter.get("/dashboard", asyncRoute(async (req, res) => {
  const { desde, hasta } = rango(req);
  res.json(await getDashboardFinanciero(accionista(req as AuthenticatedRequest), desde, hasta));
}));

financeRouter.get("/balance", asyncRoute(async (req, res) => {
  const { hasta } = rango(req);
  res.json(await getBalanceGeneral(pool, accionista(req as AuthenticatedRequest), hasta));
}));

financeRouter.get("/income-statement", asyncRoute(async (req, res) => {
  const { desde, hasta } = rango(req);
  res.json(await getEstadoResultados(pool, accionista(req as AuthenticatedRequest), desde, hasta));
}));

financeRouter.get("/cash-flow", asyncRoute(async (req, res) => {
  const { desde, hasta } = rango(req);
  res.json(await getFlujoCaja(pool, accionista(req as AuthenticatedRequest), desde, hasta));
}));

financeRouter.get("/indicators", asyncRoute(async (req, res) => {
  const { desde, hasta } = rango(req);
  res.json(await getIndicadores(pool, accionista(req as AuthenticatedRequest), desde, hasta));
}));

financeRouter.get("/fixed-assets", asyncRoute(async (req, res) => {
  const { hasta } = rango(req);
  res.json(await getActivosFijos(pool, accionista(req as AuthenticatedRequest), hasta));
}));

// Datos contables de un equipo (costo, fecha, vida útil): sin esto no se puede
// depreciar. Solo administradores: afecta el balance.
financeRouter.put("/fixed-assets/:id", requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    acquisition_cost: z.number().nonnegative(),
    acquisition_date: z.string().optional(),
    useful_life_years: z.number().int().positive().max(50).default(10),
    salvage_value: z.number().nonnegative().default(0),
    is_depreciable: z.boolean().default(true)
  }).parse(req.body);
  const accionistaId = accionista(req as AuthenticatedRequest);

  const r = await pool.query(
    `UPDATE equipment
     SET acquisition_cost = $2, acquisition_date = $3, useful_life_years = $4,
         salvage_value = $5, is_depreciable = $6,
         accionista_id = COALESCE(accionista_id, $7)
     WHERE id = $1
     RETURNING id, name`,
    [req.params.id, body.acquisition_cost, body.acquisition_date ?? null, body.useful_life_years,
     body.salvage_value, body.is_depreciable, accionistaId]
  );
  if (!r.rowCount) throw new ApiError(404, "Equipo no encontrado");
  res.json(r.rows[0]);
}));

// ── Parámetros contables ────────────────────────────────────────────────────
financeRouter.get("/settings", asyncRoute(async (req, res) => {
  const accionistaId = accionista(req as AuthenticatedRequest);
  const r = await pool.query(
    `INSERT INTO financial_settings (accionista_id) VALUES ($1)
     ON CONFLICT (accionista_id) DO UPDATE SET accionista_id = EXCLUDED.accionista_id
     RETURNING *`,
    [accionistaId]
  );
  res.json(r.rows[0]);
}));

financeRouter.put("/settings", requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({
    capital_social: z.number().nonnegative().default(0),
    resultados_acumulados: z.number().default(0),
    fecha_inicio_contable: z.string().optional(),
    precio_referencia_qq: z.number().nonnegative().default(0)
  }).parse(req.body);
  const accionistaId = accionista(req as AuthenticatedRequest);

  const r = await pool.query(
    `INSERT INTO financial_settings
       (accionista_id, capital_social, resultados_acumulados, fecha_inicio_contable, precio_referencia_qq, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (accionista_id) DO UPDATE SET
       capital_social = EXCLUDED.capital_social,
       resultados_acumulados = EXCLUDED.resultados_acumulados,
       fecha_inicio_contable = EXCLUDED.fecha_inicio_contable,
       precio_referencia_qq = EXCLUDED.precio_referencia_qq,
       updated_at = now()
     RETURNING *`,
    [accionistaId, body.capital_social, body.resultados_acumulados,
     body.fecha_inicio_contable ?? null, body.precio_referencia_qq]
  );
  res.json(r.rows[0]);
}));

// ── EXPORTACIÓN A EXCEL ─────────────────────────────────────────────────────
// Un libro con portada, balance, estado de resultados, flujo e indicadores,
// con el formato de un reporte financiero corporativo.

const AZUL = "FF0F2B46";
const TEAL = "FF0D9488";
const GRIS = "FFF1F5F9";

function tituloHoja(ws: ExcelJS.Worksheet, titulo: string, subtitulo: string, empresa: string) {
  ws.mergeCells("A1:D1");
  const t = ws.getCell("A1");
  t.value = empresa;
  t.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
  t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells("A2:D2");
  const s = ws.getCell("A2");
  s.value = titulo;
  s.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
  s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  s.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(2).height = 22;

  ws.mergeCells("A3:D3");
  const d = ws.getCell("A3");
  d.value = subtitulo;
  d.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF64748B" } };
  d.alignment = { horizontal: "left", indent: 1 };
  ws.addRow([]);
}

function seccion(ws: ExcelJS.Worksheet, texto: string) {
  const r = ws.addRow([texto]);
  r.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  r.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }; });
  ws.mergeCells(`A${r.number}:D${r.number}`);
  r.height = 18;
  return r;
}

function linea(ws: ExcelJS.Worksheet, concepto: string, valor: number, opts: { negrita?: boolean; total?: boolean; sangria?: number } = {}) {
  const r = ws.addRow(["", concepto, "", valor]);
  r.getCell(2).alignment = { indent: opts.sangria ?? 1 };
  r.getCell(4).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
  if (opts.negrita || opts.total) {
    r.getCell(2).font = { bold: true };
    r.getCell(4).font = { bold: true };
  }
  if (opts.total) {
    r.eachCell((c, n) => {
      if (n >= 2) {
        c.border = { top: { style: "thin" }, bottom: { style: "double" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS } };
      }
    });
  }
  return r;
}

function anchos(ws: ExcelJS.Worksheet) {
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 46;
  ws.getColumn(3).width = 3;
  ws.getColumn(4).width = 18;
  ws.views = [{ showGridLines: false }];
}

financeRouter.get("/export/excel", asyncRoute(async (req, res) => {
  const { desde, hasta } = rango(req);
  const accionistaId = accionista(req as AuthenticatedRequest);

  const [data, acc, empresa] = await Promise.all([
    getDashboardFinanciero(accionistaId, desde, hasta),
    pool.query("SELECT name FROM accionistas WHERE id = $1", [accionistaId]),
    pool.query("SELECT business_name, ruc FROM app_settings WHERE id = 1")
  ]);
  const nombreAcc = acc.rows[0]?.name ?? "";
  const nombreEmpresa = empresa.rows[0]?.business_name ?? "BASCULA ERP";
  const ruc = empresa.rows[0]?.ruc ? ` · RUC: ${empresa.rows[0].ruc}` : "";
  const pie = `${nombreAcc}${ruc} · Generado ${new Date().toLocaleString("es-EC")}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = nombreEmpresa;
  wb.created = new Date();

  // ── Resumen ejecutivo ──
  const ws0 = wb.addWorksheet("Resumen Ejecutivo", { properties: { tabColor: { argb: AZUL } } });
  anchos(ws0);
  tituloHoja(ws0, "RESUMEN EJECUTIVO", `Período ${desde} al ${hasta} · ${pie}`, nombreEmpresa);
  const k = data.kpis;
  seccion(ws0, "POSICIÓN FINANCIERA");
  linea(ws0, "Total Activos", k.total_activos, { negrita: true });
  linea(ws0, "Total Pasivos", k.total_pasivos);
  linea(ws0, "Patrimonio", k.patrimonio, { total: true });
  ws0.addRow([]);
  seccion(ws0, "RESULTADOS DEL PERÍODO");
  linea(ws0, "Ventas e ingresos", k.ventas);
  linea(ws0, "Compras de materia prima", k.compras);
  linea(ws0, "Utilidad neta", k.utilidad, { total: true });
  ws0.addRow([]);
  seccion(ws0, "LIQUIDEZ Y CAPITAL DE TRABAJO");
  linea(ws0, "Efectivo en caja", k.efectivo);
  linea(ws0, "Bancos", k.bancos);
  linea(ws0, "Inventario valorizado", k.inventario);
  linea(ws0, "Clientes por cobrar", k.por_cobrar);
  linea(ws0, "Proveedores por pagar", k.por_pagar);
  linea(ws0, "Flujo neto del período", k.flujo_neto, { total: true });
  ws0.addRow([]);
  const rl = ws0.addRow(["", "Liquidez corriente", "", k.liquidez]);
  rl.getCell(2).font = { bold: true };
  rl.getCell(4).font = { bold: true };
  rl.getCell(4).numFmt = "0.00";

  // ── Balance General ──
  const ws1 = wb.addWorksheet("Balance General", { properties: { tabColor: { argb: TEAL } } });
  anchos(ws1);
  tituloHoja(ws1, "ESTADO DE SITUACIÓN FINANCIERA", `Al ${hasta} · ${pie}`, nombreEmpresa);
  const b = data.balance;
  seccion(ws1, "ACTIVO");
  linea(ws1, "ACTIVO CORRIENTE", 0, { negrita: true }).getCell(4).value = null;
  linea(ws1, "Efectivo en caja", b.activo.corriente.efectivo, { sangria: 3 });
  linea(ws1, "Bancos", b.activo.corriente.bancos, { sangria: 3 });
  linea(ws1, "Cuentas por cobrar", b.activo.corriente.cuentas_por_cobrar, { sangria: 3 });
  linea(ws1, "Anticipos a agricultores", b.activo.corriente.anticipos_agricultores, { sangria: 3 });
  linea(ws1, "Inventarios", b.activo.corriente.inventario, { sangria: 3 });
  linea(ws1, "Total activo corriente", b.activo.corriente.total, { negrita: true });
  ws1.addRow([]);
  linea(ws1, "ACTIVO NO CORRIENTE", 0, { negrita: true }).getCell(4).value = null;
  linea(ws1, "Propiedad, planta y equipo", b.activo.no_corriente.activos_fijos, { sangria: 3 });
  linea(ws1, "(-) Depreciación acumulada", b.activo.no_corriente.depreciacion_acumulada, { sangria: 3 });
  linea(ws1, "Total activo no corriente", b.activo.no_corriente.total, { negrita: true });
  linea(ws1, "TOTAL ACTIVO", b.activo.total, { total: true });
  ws1.addRow([]);
  seccion(ws1, "PASIVO");
  linea(ws1, "Cuentas por pagar (agricultores y proveedores)", b.pasivo.corriente.cuentas_por_pagar, { sangria: 3 });
  linea(ws1, "TOTAL PASIVO", b.pasivo.total, { total: true });
  ws1.addRow([]);
  seccion(ws1, "PATRIMONIO");
  linea(ws1, "Capital social", b.patrimonio.capital_social, { sangria: 3 });
  linea(ws1, "Resultados acumulados", b.patrimonio.resultados_acumulados, { sangria: 3 });
  linea(ws1, "Resultado del ejercicio", b.patrimonio.resultado_ejercicio, { sangria: 3 });
  linea(ws1, "Ajuste de apertura", b.patrimonio.ajuste_apertura, { sangria: 3 });
  linea(ws1, "TOTAL PATRIMONIO", b.patrimonio.total, { total: true });
  ws1.addRow([]);
  linea(ws1, "TOTAL PASIVO + PATRIMONIO", b.pasivo.total + b.patrimonio.total, { total: true });
  const cuadre = ws1.addRow(["", b.cuadre === 0 ? "✓ Balance cuadrado" : `⚠ Descuadre: ${b.cuadre}`, "", ""]);
  cuadre.getCell(2).font = { bold: true, color: { argb: b.cuadre === 0 ? "FF15803D" : "FFB91C1C" } };

  // ── Estado de Resultados ──
  const ws2 = wb.addWorksheet("Estado de Resultados", { properties: { tabColor: { argb: TEAL } } });
  anchos(ws2);
  tituloHoja(ws2, "ESTADO DE RESULTADOS", `Del ${desde} al ${hasta} · ${pie}`, nombreEmpresa);
  const e = data.resultados;
  seccion(ws2, "INGRESOS");
  linea(ws2, "Ventas de arroz y subproductos", e.ingresos.ventas, { sangria: 3 });
  linea(ws2, "Servicio de pilado", e.ingresos.servicio_pilado, { sangria: 3 });
  linea(ws2, "Total ingresos", e.ingresos.total, { negrita: true });
  ws2.addRow([]);
  seccion(ws2, "COSTO DE VENTAS");
  linea(ws2, "Costo de mercadería vendida", e.costo_ventas.mercaderia_vendida, { sangria: 3 });
  linea(ws2, "Combustible de secado", e.costo_ventas.combustible_secado, { sangria: 3 });
  linea(ws2, "Total costo de ventas", e.costo_ventas.total, { negrita: true });
  linea(ws2, "UTILIDAD BRUTA", e.utilidad_bruta, { total: true });
  const mb = ws2.addRow(["", "Margen bruto", "", e.margen_bruto_pct / 100]);
  mb.getCell(4).numFmt = "0.0%";
  ws2.addRow([]);
  seccion(ws2, "GASTOS OPERATIVOS");
  linea(ws2, "Gastos generales", e.gastos_operativos.gastos_generales, { sangria: 3 });
  linea(ws2, "Mano de obra", e.gastos_operativos.mano_obra, { sangria: 3 });
  linea(ws2, "Depreciación", e.gastos_operativos.depreciacion, { sangria: 3 });
  linea(ws2, "Total gastos operativos", e.gastos_operativos.total, { negrita: true });
  linea(ws2, "UTILIDAD NETA", e.utilidad_neta, { total: true });
  const mn = ws2.addRow(["", "Margen neto", "", e.margen_neto_pct / 100]);
  mn.getCell(4).numFmt = "0.0%";

  // ── Flujo de Caja ──
  const ws3 = wb.addWorksheet("Flujo de Caja", { properties: { tabColor: { argb: TEAL } } });
  anchos(ws3);
  tituloHoja(ws3, "FLUJO DE EFECTIVO", `Del ${desde} al ${hasta} · ${pie}`, nombreEmpresa);
  const f = data.flujo;
  seccion(ws3, "ENTRADAS DE EFECTIVO");
  if (!f.entradas.length) linea(ws3, "Sin entradas en el período", 0, { sangria: 3 });
  f.entradas.forEach((x) => linea(ws3, x.concepto, x.valor, { sangria: 3 }));
  linea(ws3, "Total entradas", f.total_entradas, { negrita: true });
  ws3.addRow([]);
  seccion(ws3, "SALIDAS DE EFECTIVO");
  if (!f.salidas.length) linea(ws3, "Sin salidas en el período", 0, { sangria: 3 });
  f.salidas.forEach((x) => linea(ws3, x.concepto, x.valor, { sangria: 3 }));
  linea(ws3, "Total salidas", f.total_salidas, { negrita: true });
  linea(ws3, "FLUJO NETO DEL PERÍODO", f.flujo_neto, { total: true });
  ws3.addRow([]);
  seccion(ws3, "SALDOS ACTUALES");
  linea(ws3, "Efectivo", f.efectivo, { sangria: 3 });
  linea(ws3, "Bancos", f.bancos, { sangria: 3 });
  linea(ws3, "Saldo total disponible", f.saldo_actual, { total: true });

  // ── Indicadores ──
  const ws4 = wb.addWorksheet("Indicadores", { properties: { tabColor: { argb: TEAL } } });
  ws4.getColumn(1).width = 3;
  ws4.getColumn(2).width = 34;
  ws4.getColumn(3).width = 14;
  ws4.getColumn(4).width = 14;
  ws4.getColumn(5).width = 12;
  ws4.views = [{ showGridLines: false }];
  tituloHoja(ws4, "INDICADORES FINANCIEROS", `Al ${hasta} · ${pie}`, nombreEmpresa);
  const enc = ws4.addRow(["", "Indicador", "Valor", "Meta", "Estado"]);
  enc.font = { bold: true, color: { argb: "FFFFFFFF" } };
  enc.eachCell((c, n) => { if (n >= 2) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }; });
  const ind = data.indicadores as Record<string, { valor: number; meta: string; ok: boolean }>;
  const etiquetas: Record<string, string> = {
    liquidez_corriente: "Liquidez corriente",
    prueba_acida: "Prueba ácida",
    capital_trabajo: "Capital de trabajo",
    endeudamiento_pct: "Endeudamiento",
    margen_bruto_pct: "Margen bruto",
    margen_neto_pct: "Margen neto",
    roa_pct: "Rentabilidad del activo (ROA)",
    roe_pct: "Rentabilidad del patrimonio (ROE)"
  };
  for (const [clave, etiqueta] of Object.entries(etiquetas)) {
    const i = ind[clave];
    if (!i) continue;
    const esPct = clave.endsWith("_pct");
    const esDinero = clave === "capital_trabajo";
    const fila = ws4.addRow(["", etiqueta, i.valor, i.meta, i.ok ? "✓ OK" : "⚠ Revisar"]);
    fila.getCell(3).numFmt = esDinero ? '"$"#,##0.00' : esPct ? '0.0"%"' : "0.00";
    fila.getCell(3).alignment = { horizontal: "right" };
    fila.getCell(5).font = { bold: true, color: { argb: i.ok ? "FF15803D" : "FFB45309" } };
  }

  // ── Activos fijos ──
  const activos = await getActivosFijos(pool, accionistaId, hasta);
  const ws5 = wb.addWorksheet("Activos Fijos", { properties: { tabColor: { argb: TEAL } } });
  ws5.getColumn(1).width = 3;
  ws5.getColumn(2).width = 30;
  [3, 4, 5, 6].forEach((n) => (ws5.getColumn(n).width = 16));
  ws5.views = [{ showGridLines: false }];
  tituloHoja(ws5, "PROPIEDAD, PLANTA Y EQUIPO", `Al ${hasta} · Depreciación en línea recta · ${pie}`, nombreEmpresa);
  const enc5 = ws5.addRow(["", "Equipo", "Costo", "Depr. anual", "Depr. acum.", "Valor libros"]);
  enc5.font = { bold: true, color: { argb: "FFFFFFFF" } };
  enc5.eachCell((c, n) => { if (n >= 2) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } }; });
  if (!activos.items.length) {
    ws5.addRow(["", "Sin activos con costo registrado. Cárgalos en Finanzas → Activos Fijos."]);
  }
  activos.items.forEach((a) => {
    const fila = ws5.addRow(["", a.nombre, a.costo, a.depreciacion_anual, a.depreciacion_acumulada, a.valor_libros]);
    [3, 4, 5, 6].forEach((n) => (fila.getCell(n).numFmt = '"$"#,##0.00'));
  });
  const tot5 = ws5.addRow(["", "TOTALES", activos.costo_total, activos.depreciacion_anual, activos.depreciacion_acumulada, activos.valor_libros]);
  tot5.font = { bold: true };
  [3, 4, 5, 6].forEach((n) => {
    tot5.getCell(n).numFmt = '"$"#,##0.00';
    tot5.getCell(n).border = { top: { style: "thin" }, bottom: { style: "double" } };
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="estados-financieros-${nombreAcc}-${hasta}.xlsx"`);
  await wb.xlsx.write(res);
}));
