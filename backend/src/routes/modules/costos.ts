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
