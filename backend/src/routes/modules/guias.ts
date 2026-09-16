import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

// Guías de Remisión (formato legal EC) del módulo de Ventas. Tabla propia
// (guias_remision), independiente de pedidos/facturas. CERO RUPTURAS.
export const guiasRouter = Router();

const itemSchema = z.object({
  cantidad: z.union([z.string(), z.number()]).optional(),
  unidad: z.string().max(20).optional(),
  descripcion: z.string().max(400).optional()
});

// GET lista (del accionista activo).
guiasRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const r = await pool.query(
    `SELECT g.*, c.full_name AS customer_name
     FROM guias_remision g
     LEFT JOIN customers c ON c.id = g.customer_id
     WHERE g.accionista_id IS NOT DISTINCT FROM $1
     ORDER BY g.created_at DESC
     LIMIT 300`,
    [accionistaId]
  );
  res.json(r.rows);
}));

// POST crear. Numera secuencialmente por accionista (GR-000001…). Todo opcional
// salvo el destinatario y al menos un ítem, para no bloquear el guardado.
guiasRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const body = z.object({
    fecha_emision: z.string().optional(),
    fecha_inicio_traslado: z.string().optional(),
    fecha_llegada: z.string().optional(),
    punto_partida: z.string().optional(),
    motivo_traslado: z.string().optional(),
    customer_id: z.string().uuid().optional(),
    destinatario_nombre: z.string().min(1, "El destinatario es obligatorio"),
    destinatario_ruc: z.string().optional(),
    destino_direccion: z.string().optional(),
    transportista_nombre: z.string().optional(),
    transportista_ruc: z.string().optional(),
    transportista_placa: z.string().optional(),
    items: z.array(itemSchema).default([]),
    observaciones: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const items = (body.items ?? []).filter((it) => (it.descripcion ?? "").trim() || (it.cantidad ?? "") !== "");

  const row = await inTransaction(async (client) => {
    // Número secuencial simple por accionista: GR-000001, GR-000002…
    const seq = await client.query(
      `SELECT COUNT(*)::int AS n FROM guias_remision WHERE accionista_id IS NOT DISTINCT FROM $1`,
      [accionistaId]
    );
    const numero = `GR-${String((seq.rows[0]?.n ?? 0) + 1).padStart(6, "0")}`;
    const ins = await client.query(
      `INSERT INTO guias_remision
        (accionista_id, numero, fecha_emision, fecha_inicio_traslado, fecha_llegada, punto_partida, motivo_traslado,
         customer_id, destinatario_nombre, destinatario_ruc, destino_direccion,
         transportista_nombre, transportista_ruc, transportista_placa, items, observaciones, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        accionistaId, numero,
        body.fecha_emision || null, body.fecha_inicio_traslado || null, body.fecha_llegada || null,
        body.punto_partida || null, body.motivo_traslado || null,
        body.customer_id || null, body.destinatario_nombre.trim(), body.destinatario_ruc || null, body.destino_direccion || null,
        body.transportista_nombre || null, body.transportista_ruc || null, body.transportista_placa || null,
        JSON.stringify(items), body.observaciones || null, body.created_by || null
      ]
    );
    return ins.rows[0];
  });
  res.status(201).json(row);
}));
