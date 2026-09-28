import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

// 🔎 «¿CUÁNDO SE HIZO?»: buscador rápido de reparaciones, cambios y compras
// para responder al instante "¿qué día se arregló/cambió/compró X?".
// Solo LECTURA. Dos ámbitos INDEPENDIENTES (nunca se mezclan):
//  · matriz     → egresos de las cajas de la Matriz + mantenimientos de planta.
//  · transporte → egresos de la caja de Transporte y Cosechadora +
//                 mantenimientos de su flota (vehículos, cosechadora).
export const historialRouter = Router();

type Fila = {
  fuente: string; id: string; fecha: string; categoria: string | null; subcategoria: string | null;
  maquina: string | null; area: string | null; detalle: string | null; proveedor: string | null;
  factura: string | null; monto: number; donde: string | null;
};

// Egresos de la Matriz (sin anulados ni contra-asientos). Los que nacieron de un
// mantenimiento de planta se omiten: ya salen, más completos, como MANTENIMIENTO.
const SQL_MATRIZ = `
  SELECT 'CAJA' AS fuente, cm.id, cm.created_at AS fecha, COALESCE(cc.nombre, cm.category) AS categoria,
         cm.subcategoria, cm.maq_activo AS maquina, cm.area, cm.description AS detalle,
         NULL::text AS proveedor, NULL::text AS factura, cm.amount::float AS monto, r.name AS donde
    FROM cash_movements cm
    JOIN cash_registers r ON r.id = cm.cash_register_id
    LEFT JOIN cash_categories cc ON cc.codigo = cm.category
   WHERE r.accionista_id = $1 AND cm.movement = 'EXPENSE'
     AND cm.reversed_at IS NULL AND cm.reversal_of IS NULL
     AND COALESCE(cm.reference_type, '') <> 'equipment_maintenance'
  UNION ALL
  SELECT 'MANTENIMIENTO', em.id, em.created_at, 'Mantenimiento' || COALESCE(' · ' || em.maintenance_type, ''),
         em.section, COALESCE(e.name, em.maquina), em.area,
         concat_ws(' · ', NULLIF(em.description, ''), NULLIF(em.reported_failure, ''), NULLIF(em.work_done, '')),
         em.provider, em.invoice_number, COALESCE(em.amount, 0)::float, 'Mantenimiento de planta'
    FROM equipment_maintenance em
    LEFT JOIN equipment e ON e.id = em.equipment_id
   WHERE (e.accionista_id = $1 OR e.accionista_id IS NULL) AND COALESCE(em.status, '') <> 'ANULADO'`;

// Transporte: mantenimientos de flota + egresos operativos de su caja
// (sin transferencias, reversiones ni los que ya son un mantenimiento).
const SQL_TRANSPORTE = `
  SELECT 'MANTENIMIENTO' AS fuente, mt.id, mt.fecha::timestamptz AS fecha,
         'Mantenimiento' || COALESCE(' · ' || mt.tipo, '') AS categoria, mt.componente AS subcategoria,
         a.nombre || COALESCE(' (' || a.placa_codigo || ')', '') AS maquina, NULL::text AS area,
         concat_ws(' · ', NULLIF(mt.detalle, ''), NULLIF(mt.observaciones, '')) AS detalle,
         mt.proveedor, mt.factura, COALESCE(mt.costo, 0)::float AS monto, 'Flota de Transporte' AS donde
    FROM campo_mantenimientos mt
    LEFT JOIN campo_activos a ON a.id = mt.activo_id
   WHERE mt.anulado_at IS NULL
  UNION ALL
  SELECT 'CAJA', m.id, m.fecha::timestamptz, COALESCE(cat.nombre, 'Gasto'), NULL,
         a.nombre || COALESCE(' (' || a.placa_codigo || ')', ''), NULL, m.concepto,
         NULL, NULL, m.monto::float, ct.nombre
    FROM campo_movimientos m
    JOIN campo_cuentas ct ON ct.id = m.cuenta_id
    LEFT JOIN campo_categorias_gasto cat ON cat.id = m.categoria_id
    LEFT JOIN campo_activos a ON a.id = m.activo_id
   WHERE m.signo = 'salida' AND m.par_id IS NULL
     AND m.reversado_at IS NULL AND m.movimiento_origen_id IS NULL
     AND COALESCE(m.naturaleza, 'operativo') NOT IN ('apertura_caja')
     AND NOT EXISTS (SELECT 1 FROM campo_mantenimientos mt WHERE mt.movimiento_id = m.id)`;

/** Texto en minúsculas y sin tildes (para buscar "rodamiento" = "Rodamiento"). */
const normaliza = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const SQL_NORMALIZA = (expr: string) =>
  `translate(lower(${expr}), 'áéíóúüñàèìòù', 'aeiouunaeiou')`;

async function exigirMatriz(req: AuthenticatedRequest): Promise<string> {
  const id = req.accionistaId ?? null;
  if (!id) throw new ApiError(400, "Selecciona un accionista antes de continuar.");
  const r = await pool.query("SELECT tipo FROM accionistas WHERE id = $1", [id]);
  if (r.rows[0]?.tipo !== "MATRIZ") {
    throw new ApiError(403, "Este buscador es de la Matriz y de Transporte y Cosechadora.");
  }
  return id;
}

type Consulta = { ambito: "matriz" | "transporte"; q?: string; desde?: string; hasta?: string };

/** Búsqueda (exportada para pruebas): filas más recientes primero + total. */
export async function buscarHistorial(db: { query: typeof pool.query }, matrizId: string, q: Consulta) {
  const base = q.ambito === "matriz" ? SQL_MATRIZ : SQL_TRANSPORTE;
  const params: unknown[] = q.ambito === "matriz" ? [matrizId] : [];
  const cond: string[] = [];
  // Cada palabra debe aparecer en algún campo (qué, máquina, área, proveedor…).
  const texto = SQL_NORMALIZA(
    "concat_ws(' ', b.categoria, b.subcategoria, b.maquina, b.area, b.detalle, b.proveedor, b.factura, b.donde)"
  );
  for (const palabra of normaliza(q.q ?? "").split(/\s+/).filter((w) => w.length >= 2).slice(0, 6)) {
    params.push(`%${palabra}%`);
    cond.push(`${texto} LIKE $${params.length}`);
  }
  if (q.desde) { params.push(q.desde); cond.push(`b.fecha::date >= $${params.length}::date`); }
  if (q.hasta) { params.push(q.hasta); cond.push(`b.fecha::date <= $${params.length}::date`); }

  const rows = (await db.query(
    `SELECT b.* FROM (${base}) b
      ${cond.length ? `WHERE ${cond.join(" AND ")}` : ""}
      ORDER BY b.fecha DESC
      LIMIT 300`,
    params
  )).rows as Fila[];
  const total = Math.round(rows.reduce((s, r) => s + (Number(r.monto) || 0), 0) * 100) / 100;
  return { filas: rows, total, cantidad: rows.length };
}

historialRouter.get("/buscar", asyncRoute(async (req, res) => {
  const q = z.object({
    ambito: z.enum(["matriz", "transporte"]),
    q: z.string().max(120).optional(),
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const matrizId = await exigirMatriz(req as AuthenticatedRequest);
  res.json(await buscarHistorial(pool, matrizId, q));
}));

// Sugerencias rápidas: máquinas/rubros más registrados en el ámbito (chips).
historialRouter.get("/sugerencias", asyncRoute(async (req, res) => {
  const q = z.object({ ambito: z.enum(["matriz", "transporte"]) }).parse(req.query);
  const matrizId = await exigirMatriz(req as AuthenticatedRequest);
  const base = q.ambito === "matriz" ? SQL_MATRIZ : SQL_TRANSPORTE;
  const params = q.ambito === "matriz" ? [matrizId] : [];
  const r = await pool.query(
    `SELECT t AS texto, count(*)::int AS veces FROM (
       SELECT NULLIF(btrim(b.maquina), '') AS t FROM (${base}) b
       UNION ALL SELECT NULLIF(btrim(b.subcategoria), '') FROM (${base}) b
       UNION ALL SELECT NULLIF(btrim(b.area), '') FROM (${base}) b
     ) x WHERE t IS NOT NULL
     GROUP BY t ORDER BY veces DESC, t LIMIT 14`,
    params
  );
  res.json(r.rows);
}));
