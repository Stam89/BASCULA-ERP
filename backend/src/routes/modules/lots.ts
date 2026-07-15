import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const lotsRouter = Router();

// Cambia a qué accionista pertenece un lote (por si se creó con el equivocado).
// Arrastra todo lo suyo —ticket de pesaje, inventario y proceso— para que el
// stock y las cuentas no queden descuadrados. No se permite si el lote ya se
// liquidó o ya salió a producción/venta.
lotsRouter.put("/:id/accionista", asyncRoute(async (req, res) => {
  const body = z.object({ accionista_id: z.string().uuid() }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const lot = await client.query("SELECT id, lot_code, status, accionista_id FROM lots WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!lot.rowCount) throw new ApiError(404, "Lote no encontrado");
    if (lot.rows[0].accionista_id === body.accionista_id) return lot.rows[0];

    const acc = await client.query("SELECT name FROM accionistas WHERE id = $1 AND is_active = true", [body.accionista_id]);
    if (!acc.rowCount) throw new ApiError(404, "Accionista no encontrado");

    if (lot.rows[0].status === "LIQUIDATED") {
      throw new ApiError(409, "Este lote ya fue liquidado: no se puede cambiar de accionista.");
    }
    const liq = await client.query("SELECT 1 FROM liquidations WHERE lot_id = $1 LIMIT 1", [req.params.id]);
    if (liq.rowCount) throw new ApiError(409, "Este lote ya tiene liquidación: no se puede cambiar de accionista.");
    const sold = await client.query("SELECT 1 FROM sale_items WHERE lot_id = $1 LIMIT 1", [req.params.id]);
    if (sold.rowCount) throw new ApiError(409, "Este lote ya tiene ventas: no se puede cambiar de accionista.");

    // Mueve el lote y todo lo que cuelga de él.
    const updated = await client.query(
      "UPDATE lots SET accionista_id = $2 WHERE id = $1 RETURNING id, lot_code, accionista_id",
      [req.params.id, body.accionista_id]
    );
    await client.query("UPDATE weighing_tickets SET accionista_id = $2 WHERE lot_id = $1", [req.params.id, body.accionista_id]);
    await client.query("UPDATE inventory_movements SET accionista_id = $2 WHERE lot_id = $1", [req.params.id, body.accionista_id]);
    await client.query("UPDATE processing_batches SET accionista_id = $2 WHERE lot_id = $1", [req.params.id, body.accionista_id]);
    return { ...updated.rows[0], accionista_name: acc.rows[0].name };
  });

  res.json(result);
}));

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
