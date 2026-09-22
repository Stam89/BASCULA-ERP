import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const costosRouter = Router();

// Suma de rubros y costo por QQ, calculados en SQL para el listado.
const COSTO_SELECT = `
  (c.luz + c.mantenimiento + c.mano_obra + c.combustible + c.desgaste + c.otros)::float AS costo_total,
  CASE WHEN c.qq_producidos > 0
       THEN ((c.luz + c.mantenimiento + c.mano_obra + c.combustible + c.desgaste + c.otros) / c.qq_producidos)::float
       ELSE 0 END AS costo_por_qq`;

// ── CONSOLIDADO MENSUAL (aditivo; NO altera el registro diario por corrida) ──
// Arma la matriz "Costo Operativo Mensual" a partir de lo que YA existe:
//  · Egresos de Caja del mes (cash_movements EXPENSE) agrupados por RUBRO =
//    subcategoría (etiqueta libre del operador, req 5) o, si no hay, la categoría.
//  · Los 6 rubros de la tabla costo_operativo (registro por corrida) del mes.
// Cada rubro se divide por los QQ producidos del mes (production_yields) → $/QQ.
// Además consolida ingresos (servicio de pilada + ventas) y calcula la utilidad.
costosRouter.get("/consolidado-mensual", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const q = z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    qq: z.coerce.number().nonnegative().optional(),          // override manual de QQ
    financiero: z.coerce.number().nonnegative().optional()    // pago préstamos/hipotecas (manual)
  }).parse(req.query);
  const ini = `${q.year}-${String(q.month).padStart(2, "0")}-01`;
  const finExcl = q.month === 12 ? `${q.year + 1}-01-01` : `${q.year}-${String(q.month + 1).padStart(2, "0")}-01`;

  // QQ del mes (autoritativo = arroz blanco producido); override manual si viene.
  const qqRow = await pool.query(
    `SELECT COALESCE(SUM(y.white_rice_qty), 0)::float AS qq
       FROM production_yields y
       JOIN processing_batches b ON b.id = y.processing_batch_id
      WHERE b.accionista_id = $1 AND b.created_at >= $2 AND b.created_at < $3`,
    [accionistaId, ini, finExcl]
  );
  const qqAuto = Number(qqRow.rows[0].qq) || 0;
  const qq = q.qq && q.qq > 0 ? q.qq : qqAuto;

  // Egresos de caja del mes por rubro (subcategoría o categoría), con su detalle.
  const cajaRows = (await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(m.subcategoria), ''), m.category) AS rubro,
            SUM(m.amount)::float AS monto,
            json_agg(json_build_object(
              'fecha', to_char(m.created_at,'YYYY-MM-DD'),
              'descripcion', COALESCE(m.description, m.subcategoria, m.category),
              'monto', m.amount::float) ORDER BY m.created_at) AS detalle
       FROM cash_movements m
       JOIN cash_registers r ON r.id = m.cash_register_id
      WHERE r.accionista_id = $1 AND m.movement = 'EXPENSE'
        AND m.reversal_of IS NULL AND m.reversed_at IS NULL
        AND m.created_at >= $2 AND m.created_at < $3
      GROUP BY 1
      ORDER BY 2 DESC`,
    [accionistaId, ini, finExcl]
  )).rows as Array<{ rubro: string; monto: number; detalle: Array<{ fecha: string; descripcion: string; monto: number }> }>;

  // Rubros fijos de la tabla costo_operativo (registro por corrida) del mes.
  const co = (await pool.query(
    `SELECT COALESCE(SUM(luz),0)::float luz, COALESCE(SUM(mantenimiento),0)::float mantenimiento,
            COALESCE(SUM(mano_obra),0)::float mano_obra, COALESCE(SUM(combustible),0)::float combustible,
            COALESCE(SUM(desgaste),0)::float desgaste, COALESCE(SUM(otros),0)::float otros
       FROM costo_operativo
      WHERE accionista_id = $1 AND fecha >= $2 AND fecha < $3`,
    [accionistaId, ini, finExcl]
  )).rows[0];

  // Totales de caja para el umbral de "Otros (varios)".
  const totalCaja = cajaRows.reduce((s, r) => s + Number(r.monto), 0);
  const umbral = Math.max(50, totalCaja * 0.05);   // < 5% del total (o < $50) → se agrupa

  type Rubro = { rubro: string; monto: number; costo_qq: number; origen: string; detalle: Array<{ fecha: string; descripcion: string; monto: number }> };
  const rubros: Rubro[] = [];
  const otros: Rubro = { rubro: "Otros (varios)", monto: 0, costo_qq: 0, origen: "caja", detalle: [] };
  for (const r of cajaRows) {
    const monto = Math.round(Number(r.monto) * 100) / 100;
    if (monto < umbral && cajaRows.length > 3) {
      otros.monto = Math.round((otros.monto + monto) * 100) / 100;
      otros.detalle.push(...r.detalle);
    } else {
      rubros.push({ rubro: r.rubro, monto, costo_qq: qq > 0 ? monto / qq : 0, origen: "caja", detalle: r.detalle });
    }
  }
  if (otros.monto > 0) { otros.costo_qq = qq > 0 ? otros.monto / qq : 0; rubros.push(otros); }
  // Rubros del registro por corrida (solo los que tienen valor).
  const coLabels: Array<[string, number]> = [
    ["Luz / Energía", Number(co.luz)], ["Mantenimiento", Number(co.mantenimiento)],
    ["Mano de Obra", Number(co.mano_obra)], ["Combustible", Number(co.combustible)],
    ["Desgaste", Number(co.desgaste)], ["Otros (corrida)", Number(co.otros)]
  ];
  for (const [label, monto] of coLabels) {
    if (monto > 0.005) rubros.push({ rubro: label, monto, costo_qq: qq > 0 ? monto / qq : 0, origen: "costo", detalle: [] });
  }

  const totalCosto = Math.round(rubros.reduce((s, r) => s + r.monto, 0) * 100) / 100;
  const costoRealQQ = qq > 0 ? Math.round((totalCosto / qq) * 10000) / 10000 : 0;

  // Ingresos del mes (lo que YA existe): servicio de pilada + ventas.
  const ingRow = (await pool.query(
    `SELECT
       (SELECT COALESCE(SUM(y.service_amount),0)::float FROM production_yields y
          JOIN processing_batches b ON b.id = y.processing_batch_id
         WHERE b.accionista_id = $1 AND b.created_at >= $2 AND b.created_at < $3) AS servicio_pilada,
       (SELECT COALESCE(SUM(s.total_amount),0)::float FROM sales s
         WHERE s.accionista_id = $1 AND s.created_at >= $2 AND s.created_at < $3
           AND COALESCE(s.sale_status::text,'') <> 'CANCELLED') AS ventas`,
    [accionistaId, ini, finExcl]
  )).rows[0];
  const ingresos = {
    servicio_pilada: Number(ingRow.servicio_pilada) || 0,
    ventas: Number(ingRow.ventas) || 0
  };
  const totalIngresos = Math.round((ingresos.servicio_pilada + ingresos.ventas) * 100) / 100;
  const financiero = q.financiero ?? 0;
  const gananciaNeta = Math.round((totalIngresos - totalCosto - financiero) * 100) / 100;

  res.json({
    periodo: `${q.year}-${String(q.month).padStart(2, "0")}`,
    qq_producidos: qqAuto, qq_usados: qq, qq_manual: q.qq != null,
    rubros, total_costo: totalCosto, costo_real_qq: costoRealQQ,
    ingresos, total_ingresos: totalIngresos, financiero, ganancia_neta: gananciaNeta
  });
}));

// GET listado de costos operativos del accionista activo (con costo total y $/QQ).
costosRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.query);
  const conds = ["c.accionista_id = $1"];
  const params: any[] = [accionistaId];
  if (q.from) { params.push(q.from); conds.push(`c.fecha >= $${params.length}`); }
  if (q.to) { params.push(q.to); conds.push(`c.fecha <= $${params.length}`); }
  const result = await pool.query(
    `SELECT c.*, ${COSTO_SELECT}
     FROM costo_operativo c
     WHERE ${conds.join(" AND ")}
     ORDER BY c.fecha DESC, c.created_at DESC
     LIMIT 300`,
    params
  );
  res.json(result.rows);
}));

// GET corridas (processing_batches) del accionista activo con QQ producido, para
// elegir al capturar el costo. QQ = white_rice_qty de production_yields.
costosRouter.get("/batches", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const result = await pool.query(
    `SELECT b.id, b.status, b.created_at,
            COALESCE(y.white_rice_qty, 0)::float AS qq_producidos
     FROM processing_batches b
     LEFT JOIN production_yields y ON y.processing_batch_id = b.id
     WHERE b.accionista_id = $1
     ORDER BY b.created_at DESC
     LIMIT 100`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// POST registrar el costo operativo de una corrida.
costosRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  if (!accionistaId) throw new ApiError(400, "Selecciona un accionista.");
  const body = z.object({
    processing_batch_id: z.string().uuid().optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    qq_producidos: z.number().positive(),
    luz: z.number().nonnegative().optional(),
    mantenimiento: z.number().nonnegative().optional(),
    mano_obra: z.number().nonnegative().optional(),
    combustible: z.number().nonnegative().optional(),
    desgaste: z.number().nonnegative().optional(),
    otros: z.number().nonnegative().optional(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  if (body.processing_batch_id) {
    const b = await pool.query(
      "SELECT id FROM processing_batches WHERE id = $1 AND accionista_id = $2",
      [body.processing_batch_id, accionistaId]
    );
    if (!b.rowCount) throw new ApiError(404, "Corrida no encontrada para el accionista activo");
  }

  const result = await pool.query(
    `INSERT INTO costo_operativo
       (accionista_id, processing_batch_id, fecha, qq_producidos, luz, mantenimiento, mano_obra, combustible, desgaste, otros, notes, created_by)
     VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *,
       (luz + mantenimiento + mano_obra + combustible + desgaste + otros)::float AS costo_total,
       ((luz + mantenimiento + mano_obra + combustible + desgaste + otros) / qq_producidos)::float AS costo_por_qq`,
    [accionistaId, body.processing_batch_id ?? null, body.fecha ?? null, body.qq_producidos,
     body.luz ?? 0, body.mantenimiento ?? 0, body.mano_obra ?? 0, body.combustible ?? 0, body.desgaste ?? 0, body.otros ?? 0,
     body.notes ?? null, body.created_by ?? null]
  );
  res.status(201).json(result.rows[0]);
}));

// PATCH editar un costo operativo (correccion de rubros / QQ).
costosRouter.patch("/:id", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const body = z.object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    qq_producidos: z.number().positive().optional(),
    luz: z.number().nonnegative().optional(),
    mantenimiento: z.number().nonnegative().optional(),
    mano_obra: z.number().nonnegative().optional(),
    combustible: z.number().nonnegative().optional(),
    desgaste: z.number().nonnegative().optional(),
    otros: z.number().nonnegative().optional(),
    notes: z.string().optional()
  }).parse(req.body);
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;
  for (const k of ["fecha", "qq_producidos", "luz", "mantenimiento", "mano_obra", "combustible", "desgaste", "otros", "notes"] as const) {
    if (body[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(body[k]); }
  }
  if (fields.length === 0) throw new ApiError(400, "Sin cambios");
  values.push(req.params.id);
  values.push(accionistaId);
  const result = await pool.query(
    `UPDATE costo_operativo SET ${fields.join(", ")}
     WHERE id = $${i} AND accionista_id = $${i + 1}
     RETURNING *,
       (luz + mantenimiento + mano_obra + combustible + desgaste + otros)::float AS costo_total,
       ((luz + mantenimiento + mano_obra + combustible + desgaste + otros) / qq_producidos)::float AS costo_por_qq`,
    values
  );
  if (!result.rows[0]) throw new ApiError(404, "Costo no encontrado para el accionista activo");
  res.json(result.rows[0]);
}));
