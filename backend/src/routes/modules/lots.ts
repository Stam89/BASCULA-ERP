import { Router } from "express";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const lotsRouter = Router();

lotsRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name,
            t.ticket_number, t.gross_weight, t.tare_weight, t.net_weight, t.qualification, t.quintals
     FROM lots l
     LEFT JOIN farmers f ON f.id = l.farmer_id
     LEFT JOIN weighing_tickets t ON t.lot_id = l.id
     WHERE l.accionista_id = $2 AND ($1::text IS NULL OR l.status = $1::lot_status)
     ORDER BY l.created_at DESC
     LIMIT 500`,
    [req.query.status ?? null, accionistaId]
  );
  res.json(result.rows);
}));

lotsRouter.get("/:id", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const lot = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name
     FROM lots l
     LEFT JOIN farmers f ON f.id = l.farmer_id
     WHERE l.id = $1 AND l.accionista_id = $2`,
    [req.params.id, accionistaId]
  );
  if (!lot.rowCount) throw new ApiError(404, "Lote no encontrado");

  const [tickets, movements, processing, liquidations] = await Promise.all([
    pool.query("SELECT * FROM weighing_tickets WHERE lot_id = $1", [req.params.id]),
    pool.query("SELECT * FROM inventory_movements WHERE lot_id = $1 ORDER BY created_at ASC", [req.params.id]),
    pool.query("SELECT * FROM processing_batches WHERE lot_id = $1 ORDER BY created_at ASC", [req.params.id]),
    pool.query("SELECT * FROM liquidations WHERE lot_id = $1 ORDER BY created_at ASC", [req.params.id])
  ]);

  res.json({
    lot: lot.rows[0],
    tickets: tickets.rows,
    inventory_movements: movements.rows,
    processing_batches: processing.rows,
    liquidations: liquidations.rows
  });
}));
