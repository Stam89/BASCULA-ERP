import { Router } from "express";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

// Campanita del ERP: avisos del accionista ACTIVO (p. ej. "CEYRO registró tu
// pago"). Solo lectura y marcar como leídas: los avisos los crean las
// operaciones de cobro/pago (services/notificaciones.ts).
export const notificacionesRouter = Router();

notificacionesRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const [items, noLeidas] = await Promise.all([
    pool.query(
      `SELECT id, tipo, titulo, mensaje, monto::float AS monto, referencia_tipo, referencia_id, leida_at, created_at
         FROM notificaciones WHERE accionista_id = $1
        ORDER BY created_at DESC LIMIT 40`,
      [accionistaId]
    ),
    pool.query("SELECT count(*)::int AS n FROM notificaciones WHERE accionista_id = $1 AND leida_at IS NULL", [accionistaId])
  ]);
  res.json({ items: items.rows, no_leidas: noLeidas.rows[0].n });
}));

notificacionesRouter.post("/leer-todas", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const r = await pool.query(
    "UPDATE notificaciones SET leida_at = now() WHERE accionista_id = $1 AND leida_at IS NULL",
    [accionistaId]
  );
  res.json({ marcadas: r.rowCount ?? 0 });
}));

notificacionesRouter.post("/:id/leer", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  await pool.query(
    "UPDATE notificaciones SET leida_at = COALESCE(leida_at, now()) WHERE id = $1 AND accionista_id = $2",
    [req.params.id, accionistaId]
  );
  res.json({ ok: true });
}));
