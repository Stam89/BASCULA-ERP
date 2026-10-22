import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { avisarSobregiro, exigirCajaAbiertaDelAccionista, medioParaCaja } from "../../services/caja.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const advancesRouter = Router();

import { registrarAnticipo } from "../../services/anticipo.js";

const advanceSchema = z.object({
  farmer_id: z.string().uuid(),
  cash_register_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  concept: z.string().min(2),
  apply_to_payables: z.boolean().default(false),
  medio_pago: z.enum(["EFECTIVO", "BANCO"]).optional(),
  created_by: z.string().uuid().optional()
});

advancesRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT a.*, f.full_name AS farmer_name
     FROM farmer_advances a
     JOIN farmers f ON f.id = a.farmer_id
     WHERE a.accionista_id = $3
       AND ($1::uuid IS NULL OR a.farmer_id = $1)
       AND ($2::text IS NULL OR a.status = $2::document_status)
     ORDER BY a.issued_at DESC`,
    [req.query.farmer_id ?? null, req.query.status ?? null, accionistaId]
  );
  res.json(result.rows);
}));

advancesRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const data = advanceSchema.parse(req.body);
  const result = await inTransaction(async (client) => {
    let tipoCaja: string | null = null;
    if (data.cash_register_id) {
      const caja = await exigirCajaAbiertaDelAccionista(client, data.cash_register_id, accionistaId);
      tipoCaja = caja.tipo;
      await avisarSobregiro(client, data.cash_register_id, data.amount, req);
    }
    // Anticipo (y, si se pide, aplicado de una vez contra lo que se le debe): services/anticipo.ts.
    const { advance } = await registrarAnticipo(client, {
      farmerId: data.farmer_id, accionistaId, amount: data.amount, concept: data.concept,
      createdBy: data.created_by ?? null, aplicarAPagar: data.apply_to_payables
    });

    if (data.cash_register_id) {
      await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by, medio)
         VALUES ($1, 'EXPENSE', 'ANTICIPO_AGRICULTOR', 'farmer_advances', $2, $3, $4, $5, $6)`,
        [data.cash_register_id, advance.id, data.amount, data.concept, data.created_by,
         medioParaCaja(tipoCaja ?? "EFECTIVO", data.medio_pago)]
      );
    }

    return advance;
  });

  res.status(201).json(result);
}));
