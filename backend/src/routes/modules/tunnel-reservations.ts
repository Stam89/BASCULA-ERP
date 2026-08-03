import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";

export const tunnelReservationsRouter = Router();

const isoDateSchema = z.string().refine(
  (val) => !isNaN(Date.parse(val)),
  { message: "Fecha inválida" }
);

const tunnelNumberSchema = z.number().int().min(1).max(3);

// GET todas las reservas ACTIVE ordenadas por start_date
// Incluye nombre del accionista (JOIN users).
tunnelReservationsRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT r.*, u.name AS accionista_name
     FROM tunnel_reservations r
     LEFT JOIN users u ON u.id = r.accionista_id
     WHERE r.status = 'ACTIVE'
     ORDER BY r.start_date ASC`
  );
  res.json(result.rows);
}));

// GET /available?date=YYYY-MM-DD&tunnel_number=N
// Retorna true si el túnel está disponible en esa fecha.
tunnelReservationsRouter.get("/available", asyncRoute(async (req, res) => {
  const query = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)"),
    tunnel_number: z.preprocess((val) => Number(val), tunnelNumberSchema)
  }).parse(req.query);

  const overlap = await pool.query(
    `SELECT 1
     FROM tunnel_reservations
     WHERE tunnel_number = $1
       AND status = 'ACTIVE'
       AND start_date::date <= $2::date
       AND end_date::date >= $2::date
     LIMIT 1`,
    [query.tunnel_number, query.date]
  );

  res.json({ available: overlap.rowCount === 0 });
}));

// POST nueva reserva
// Valida solapamiento con otra reserva ACTIVE para el mismo túnel.
tunnelReservationsRouter.post("/", asyncRoute(async (req, res) => {
  const body = z.object({
    tunnel_number: tunnelNumberSchema,
    accionista_id: z.string().uuid(),
    start_date: isoDateSchema,
    end_date: isoDateSchema
  }).parse(req.body);

  const start = new Date(body.start_date);
  const end = new Date(body.end_date);
  if (start > end) {
    throw new ApiError(400, "La fecha de inicio no puede ser mayor que la fecha de fin");
  }

  const user = (req as AuthenticatedRequest).user;

  const overlap = await pool.query(
    `SELECT 1
     FROM tunnel_reservations
     WHERE tunnel_number = $1
       AND status = 'ACTIVE'
       AND start_date <= $3
       AND end_date >= $2
     LIMIT 1`,
    [body.tunnel_number, body.start_date, body.end_date]
  );
  if (overlap.rowCount) {
    throw new ApiError(409, "El túnel ya tiene una reserva activa en ese rango de fechas");
  }

  const result = await pool.query(
    `INSERT INTO tunnel_reservations
       (tunnel_number, accionista_id, start_date, end_date, status, created_by)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5)
     RETURNING *`,
    [body.tunnel_number, body.accionista_id, body.start_date, body.end_date, user?.id ?? null]
  );

  res.status(201).json(result.rows[0]);
}));

// PATCH /:id/complete
// Completa la reserva y crea un gas_consumption_reports.
tunnelReservationsRouter.patch("/:id/complete", asyncRoute(async (req, res) => {
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z.object({
    gas_used: z.number().nonnegative(),
    notes: z.string().optional()
  }).parse(req.body);

  const user = (req as AuthenticatedRequest).user;
  if (!user) throw new ApiError(401, "Sesión requerida");

  const result = await inTransaction(async (client) => {
    const reservation = await client.query(
      `SELECT r.*, u.name AS accionista_name
       FROM tunnel_reservations r
       LEFT JOIN users u ON u.id = r.accionista_id
       WHERE r.id = $1
       FOR UPDATE`,
      [params.id]
    );
    if (!reservation.rowCount) throw new ApiError(404, "Reserva no encontrada");
    if (reservation.rows[0].status !== "ACTIVE") {
      throw new ApiError(409, "La reserva ya no está activa");
    }

    await client.query(
      `UPDATE tunnel_reservations
       SET status = 'COMPLETED'
       WHERE id = $1`,
      [params.id]
    );

    const gasReport = await client.query(
      `INSERT INTO gas_consumption_reports
         (tunnel_number, reservation_id, gas_used, last_accionista_id, accionista_name, signed_by, signed_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
       RETURNING *`,
      [
        reservation.rows[0].tunnel_number,
        params.id,
        body.gas_used,
        user.id,
        reservation.rows[0].accionista_name || user.name,
        user.id,
        body.notes || null
      ]
    );

    return gasReport.rows[0];
  });

  res.json(result);
}));
