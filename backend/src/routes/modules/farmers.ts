import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";

export const farmersRouter = Router();

const farmerSchema = z.object({
  identification: z.string().optional(),
  full_name: z.string().min(2),
  phone: z.string().optional(),
  address: z.string().optional(),
  bank_account: z.string().optional(),
  notes: z.string().optional()
});

farmersRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT f.*,
           COALESCE(SUM(fa.balance) FILTER (WHERE fa.status IN ('CONFIRMED', 'PARTIAL')), 0) AS pending_advance_balance
    FROM farmers f
    LEFT JOIN farmer_advances fa ON fa.farmer_id = f.id
    GROUP BY f.id
    ORDER BY f.full_name ASC
  `);
  res.json(result.rows);
}));

farmersRouter.post("/", asyncRoute(async (req, res) => {
  const data = farmerSchema.parse(req.body);
  const result = await pool.query(
    `INSERT INTO farmers (identification, full_name, phone, address, bank_account, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.identification, data.full_name, data.phone, data.address, data.bank_account, data.notes]
  );
  res.status(201).json(result.rows[0]);
}));

farmersRouter.get("/:id", asyncRoute(async (req, res) => {
  const result = await pool.query("SELECT * FROM farmers WHERE id = $1", [req.params.id]);
  if (!result.rowCount) throw new ApiError(404, "Agricultor no encontrado");
  res.json(result.rows[0]);
}));

farmersRouter.put("/:id", asyncRoute(async (req, res) => {
  const data = farmerSchema.partial().parse(req.body);
  const current = await pool.query("SELECT * FROM farmers WHERE id = $1", [req.params.id]);
  if (!current.rowCount) throw new ApiError(404, "Agricultor no encontrado");

  const merged = { ...current.rows[0], ...data };
  const result = await pool.query(
    `UPDATE farmers
     SET identification = $2, full_name = $3, phone = $4, address = $5,
         bank_account = $6, notes = $7, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [req.params.id, merged.identification, merged.full_name, merged.phone, merged.address, merged.bank_account, merged.notes]
  );
  res.json(result.rows[0]);
}));

farmersRouter.get("/:id/history", asyncRoute(async (req, res) => {
  const [lots, advances, liquidations] = await Promise.all([
    pool.query("SELECT * FROM lots WHERE farmer_id = $1 ORDER BY created_at DESC", [req.params.id]),
    pool.query("SELECT * FROM farmer_advances WHERE farmer_id = $1 ORDER BY issued_at DESC", [req.params.id]),
    pool.query("SELECT * FROM liquidations WHERE farmer_id = $1 ORDER BY created_at DESC", [req.params.id])
  ]);

  res.json({
    lots: lots.rows,
    advances: advances.rows,
    liquidations: liquidations.rows
  });
}));
