import { Router } from "express";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { requireAdmin } from "../../auth/require-auth.js";
import { ensureAuditTable } from "../../audit/audit.js";

export const auditRouter = Router();

// Historial de actividad (solo administradores).
auditRouter.get("/", requireAdmin, asyncRoute(async (req, res) => {
  await ensureAuditTable();
  const limit = Math.min(Number(req.query.limit) || 150, 500);
  const result = await pool.query(
    `SELECT id, username, action, table_name, summary, record_id, status_code, created_at
     FROM audit_logs
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json(result.rows);
}));
