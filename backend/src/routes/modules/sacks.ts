import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { inTransaction } from "../../db/transaction.js";

export const sacksRouter = Router();

// GET todos los tipos de sacos con stock actual
sacksRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    "SELECT * FROM sack_inventory ORDER BY tipo"
  );
  res.json(result.rows);
}));

// GET movimientos de un tipo de saco
sacksRouter.get("/:id/movements", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT sm.*, si.tipo
     FROM sack_movements sm
     JOIN sack_inventory si ON si.id = sm.sack_id
     WHERE sm.sack_id = $1
     ORDER BY sm.created_at DESC
     LIMIT 50`,
    [req.params.id]
  );
  res.json(result.rows);
}));

// GET todos los movimientos recientes
sacksRouter.get("/movements/recent", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT sm.*, si.tipo
     FROM sack_movements sm
     JOIN sack_inventory si ON si.id = sm.sack_id
     ORDER BY sm.created_at DESC
     LIMIT 100`
  );
  res.json(result.rows);
}));

// POST registrar movimiento (entrada o salida)
sacksRouter.post("/movements", asyncRoute(async (req, res) => {
  const body = z.object({
    sack_id:  z.string().uuid(),
    movement: z.enum(["ENTRADA", "SALIDA"]),
    cantidad: z.number().int().positive(),
    concepto: z.string().optional(),
    ref_batch: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    // Verificar stock suficiente para salidas
    if (body.movement === "SALIDA") {
      const stock = await client.query(
        "SELECT stock FROM sack_inventory WHERE id = $1 FOR UPDATE",
        [body.sack_id]
      );
      if (Number(stock.rows[0]?.stock ?? 0) < body.cantidad) {
        throw new Error(`Stock insuficiente. Disponible: ${stock.rows[0]?.stock ?? 0}`);
      }
    }

    // Registrar movimiento
    const mov = await client.query(
      `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_batch)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.sack_id, body.movement, body.cantidad,
       body.concepto ?? null, body.ref_batch ?? null]
    );

    // Actualizar stock
    const delta = body.movement === "ENTRADA" ? body.cantidad : -body.cantidad;
    await client.query(
      "UPDATE sack_inventory SET stock = stock + $2, updated_at = NOW() WHERE id = $1",
      [body.sack_id, delta]
    );

    return mov.rows[0];
  });

  res.status(201).json(result);
}));

// PATCH ajuste manual de stock
sacksRouter.patch("/:id/adjust", asyncRoute(async (req, res) => {
  const body = z.object({ stock: z.number().int().nonnegative() }).parse(req.body);
  const result = await pool.query(
    "UPDATE sack_inventory SET stock = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
    [req.params.id, body.stock]
  );
  res.json(result.rows[0]);
}));
