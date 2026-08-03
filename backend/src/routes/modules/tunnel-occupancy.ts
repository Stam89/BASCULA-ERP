import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { type AuthenticatedRequest } from "../../auth/require-auth.js";

export const tunnelOccupancyRouter = Router();

const tunnelNumberSchema = z.number().int().min(1).max(3);

// GET /api/tunnel-occupancy
// Retorna el estado de los 3 túneles ordenados por número.
tunnelOccupancyRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT tunnel_number, status, current_accionista_id, accionista_name, occupied_at
     FROM tunnel_status
     ORDER BY tunnel_number ASC`
  );
  res.json(result.rows);
}));

// POST /api/tunnel-occupancy/:tunnel_number/occupy
// Ocupa un túnel para el usuario logueado. Requiere que esté DISPONIBLE.
tunnelOccupancyRouter.post("/:tunnel_number/occupy", asyncRoute(async (req, res) => {
  const params = z.object({ tunnel_number: z.preprocess((val) => Number(val), tunnelNumberSchema) }).parse(req.params);
  const user = (req as AuthenticatedRequest).user;
  if (!user) throw new ApiError(401, "Sesión requerida");

  const result = await inTransaction(async (client) => {
    const current = await client.query(
      `SELECT * FROM tunnel_status WHERE tunnel_number = $1 FOR UPDATE`,
      [params.tunnel_number]
    );
    if (!current.rowCount) throw new ApiError(404, "Túnel no encontrado");

    const row = current.rows[0];
    if (row.status === "OCUPADO") {
      throw new ApiError(409, `Túnel ocupado por ${row.accionista_name || "otro usuario"}`);
    }

    const updated = await client.query(
      `UPDATE tunnel_status
       SET status = 'OCUPADO',
           current_accionista_id = $1,
           accionista_name = $2,
           occupied_at = now(),
           updated_at = now()
       WHERE tunnel_number = $3
       RETURNING tunnel_number, status, current_accionista_id, accionista_name, occupied_at`,
      [user.id, user.name, params.tunnel_number]
    );
    return updated.rows[0];
  });

  res.status(200).json(result);
}));

// PATCH /api/tunnel-occupancy/:tunnel_number/complete
// Libera el túnel y registra el consumo de gas. Solo el accionista actual puede hacerlo.
tunnelOccupancyRouter.patch("/:tunnel_number/complete", asyncRoute(async (req, res) => {
  const params = z.object({ tunnel_number: z.preprocess((val) => Number(val), tunnelNumberSchema) }).parse(req.params);
  const body = z.object({
    gas_used: z.number().nonnegative(),
    notes: z.string().optional()
  }).parse(req.body);

  const user = (req as AuthenticatedRequest).user;
  if (!user) throw new ApiError(401, "Sesión requerida");

  await inTransaction(async (client) => {
    const current = await client.query(
      `SELECT * FROM tunnel_status WHERE tunnel_number = $1 FOR UPDATE`,
      [params.tunnel_number]
    );
    if (!current.rowCount) throw new ApiError(404, "Túnel no encontrado");

    const row = current.rows[0];
    if (row.status !== "OCUPADO") {
      throw new ApiError(409, "El túnel no está ocupado");
    }
    if (row.current_accionista_id !== user.id) {
      throw new ApiError(403, "Solo el accionista que ocupa el túnel puede liberarlo");
    }

    await client.query(
      `INSERT INTO gas_consumption_reports
         (tunnel_number, accionista_id, accionista_name, gas_used, signed_by, signed_by_name, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.tunnel_number,
        row.current_accionista_id,
        row.accionista_name || user.name,
        body.gas_used,
        user.id,
        user.name,
        body.notes || null
      ]
    );

    await client.query(
      `UPDATE tunnel_status
       SET status = 'DISPONIBLE',
           current_accionista_id = NULL,
           accionista_name = NULL,
           occupied_at = NULL,
           updated_at = now()
       WHERE tunnel_number = $1`,
      [params.tunnel_number]
    );
  });

  res.json({ success: true, message: `Túnel ${params.tunnel_number} liberado, informe registrado` });
}));
