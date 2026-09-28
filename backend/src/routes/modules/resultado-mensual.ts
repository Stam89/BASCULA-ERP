import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import { calcularResultadoMensual } from "../../services/resultado-mensual.js";

// 📊 Resultado mensual de CEYRO (costos por QQ vs estimado, ingresos adicionales
// y resultado neto). Exclusivo de la Matriz. Lee los módulos existentes; solo
// escribe en sus propias tablas (costo_rubros y resultado_mensual_manual).
export const resultadoMensualRouter = Router();

async function exigirMatriz(req: AuthenticatedRequest): Promise<string> {
  const id = req.accionistaId ?? null;
  if (!id) throw new ApiError(400, "Selecciona un accionista antes de continuar.");
  const r = await pool.query("SELECT tipo FROM accionistas WHERE id = $1", [id]);
  if (r.rows[0]?.tipo !== "MATRIZ") throw new ApiError(403, "El resultado mensual es de la Matriz.");
  return id;
}

resultadoMensualRouter.get("/", asyncRoute(async (req, res) => {
  const matrizId = await exigirMatriz(req as AuthenticatedRequest);
  const q = z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    qq: z.coerce.number().nonnegative().optional()   // QQ de cáscara manual (opcional)
  }).parse(req.query);
  res.json(await calcularResultadoMensual(pool, { year: q.year, month: q.month, matrizId, qqManual: q.qq }));
}));

// ── Rubros (costo estimado $/QQ y claves de reconocimiento) ─────────────────
resultadoMensualRouter.get("/rubros", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const r = await pool.query("SELECT id, nombre, costo_estimado_qq::float AS costo_estimado_qq, claves, orden, activo FROM costo_rubros ORDER BY orden, nombre");
  res.json(r.rows);
}));

const rubroSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
  costo_estimado_qq: z.number().nonnegative().max(1000).default(0),
  claves: z.array(z.string().trim().min(2).max(60)).max(40).default([])
});

resultadoMensualRouter.post("/rubros", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const body = rubroSchema.parse(req.body);
  const orden = Number((await pool.query("SELECT COALESCE(MAX(orden), 0) + 1 AS o FROM costo_rubros")).rows[0].o);
  const r = await pool.query(
    `INSERT INTO costo_rubros (nombre, costo_estimado_qq, claves, orden) VALUES ($1, $2, $3, $4)
     ON CONFLICT (upper(nombre)) DO UPDATE SET activo = true, costo_estimado_qq = EXCLUDED.costo_estimado_qq
     RETURNING id, nombre`,
    [body.nombre, body.costo_estimado_qq, body.claves, orden]
  );
  res.status(201).json(r.rows[0]);
}));

resultadoMensualRouter.patch("/rubros/:id", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const body = rubroSchema.partial().extend({ activo: z.boolean().optional() }).parse(req.body);
  const r = await pool.query(
    `UPDATE costo_rubros SET
       nombre = COALESCE($2, nombre),
       costo_estimado_qq = COALESCE($3, costo_estimado_qq),
       claves = COALESCE($4, claves),
       activo = COALESCE($5, activo)
     WHERE id = $1 RETURNING id`,
    [req.params.id, body.nombre ?? null, body.costo_estimado_qq ?? null, body.claves ?? null, body.activo ?? null]
  );
  if (!r.rowCount) throw new ApiError(404, "Rubro no encontrado");
  res.json({ ok: true });
}));

// Clasificar un egreso "sin clasificar": agrega su subcategoría/texto como clave
// del rubro elegido (desde ese momento, esos egresos entran a ese rubro).
resultadoMensualRouter.post("/rubros/:id/claves", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const body = z.object({ clave: z.string().trim().min(2).max(60) }).parse(req.body);
  const r = await pool.query(
    `UPDATE costo_rubros SET claves = array_append(claves, $2)
      WHERE id = $1 AND NOT (lower($2) = ANY (SELECT lower(c) FROM unnest(claves) c))
      RETURNING id`,
    [req.params.id, body.clave]
  );
  res.json({ agregado: (r.rowCount ?? 0) > 0 });
}));

// ── Montos manuales del mes (gastos financieros e ingresos adicionales) ─────
resultadoMensualRouter.post("/manual", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  const body = z.object({
    periodo: z.string().regex(/^\d{4}-\d{2}$/),
    seccion: z.enum(["INGRESO", "FINANCIERO"]),
    concepto: z.string().trim().min(2).max(120),
    monto: z.number().nonnegative(),
    nota: z.string().trim().max(300).optional()
  }).parse(req.body);
  const r = await pool.query(
    `INSERT INTO resultado_mensual_manual (periodo, seccion, concepto, monto, nota, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [body.periodo, body.seccion, body.concepto, body.monto, body.nota ?? null, (req as AuthenticatedRequest).user?.id ?? null]
  );
  res.status(201).json(r.rows[0]);
}));

resultadoMensualRouter.delete("/manual/:id", asyncRoute(async (req, res) => {
  await exigirMatriz(req as AuthenticatedRequest);
  await pool.query("DELETE FROM resultado_mensual_manual WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
}));
