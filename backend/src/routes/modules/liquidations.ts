import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { nextCode } from "../../utils/codes.js";
import { round2 } from "../../utils/rice-formulas.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const liquidationsRouter = Router();

const discountBreakdownSchema = z.object({
  fomento:     z.number().nonnegative().default(0),
  bascula:     z.number().nonnegative().default(0),
  flete:       z.number().nonnegative().default(0),
  cosechadora: z.number().nonnegative().default(0)
}).optional();

// Ingresos de materia prima del agricultor que aún no se le han pagado. Se
// liquida el pesaje (lo que entregó), sin esperar al secado ni al lote.
liquidationsRouter.get("/pending-entries", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const q = z.object({ farmer_id: z.string().uuid().optional() }).parse(req.query);
  const result = await pool.query(
    `SELECT w.id, w.ticket_number, w.farmer_id, w.rice_type, w.quintals, w.net_weight, w.created_at,
            f.full_name AS farmer_name,
            m.raw_payload->>'numeroTicket' AS numero_bascula,
            l.lot_code
     FROM weighing_tickets w
     JOIN farmers f ON f.id = w.farmer_id
     LEFT JOIN mobile_synced_tickets m ON m.weighing_ticket_id = w.id
     LEFT JOIN lots l ON l.id = w.lot_id
     WHERE w.accionista_id = $1
       AND w.is_maquila = false
       AND w.quintals > 0
       AND ($2::uuid IS NULL OR w.farmer_id = $2)
       AND NOT EXISTS (
         SELECT 1 FROM liquidations q
         WHERE q.weighing_ticket_id = w.id AND q.status <> 'CANCELLED'
       )
     ORDER BY w.created_at DESC`,
    [accionistaId, q.farmer_id ?? null]
  );
  res.json(result.rows);
}));

const liquidationInput = z.object({
  farmer_id: z.string().uuid(),
  // Se liquida un ingreso de materia prima. lot_id queda como referencia
  // opcional (el lote al que ese ingreso haya entrado, si ya está secándose).
  weighing_ticket_id: z.string().uuid().optional(),
  lot_id: z.string().uuid().optional(),
  quintals: z.number().positive(),
  price_per_quintal: z.number().nonnegative(),
  other_discounts: z.number().nonnegative().default(0),
  discount_breakdown: discountBreakdownSchema,
  batch_id: z.string().uuid().optional(),
  created_by: z.string().uuid().optional()
});

async function previewLiquidation(data: z.infer<typeof liquidationInput>, accionistaId: string | undefined) {
  const gross = round2(data.quintals * data.price_per_quintal);
  const advances = await pool.query(
    `SELECT COALESCE(SUM(balance), 0) AS pending
     FROM farmer_advances
     WHERE farmer_id = $1 AND accionista_id = $2 AND status IN ('CONFIRMED', 'PARTIAL')`,
    [data.farmer_id, accionistaId]
  );
  const pendingAdvances = Number(advances.rows[0].pending);
  const advancesDiscount = Math.min(pendingAdvances, gross);
  const net = Math.max(0, round2(gross - advancesDiscount - data.other_discounts));

  return {
    gross_amount: gross,
    pending_advances: pendingAdvances,
    advances_discount: round2(advancesDiscount),
    other_discounts: data.other_discounts,
    net_amount: net
  };
}

liquidationsRouter.post("/preview", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const data = liquidationInput.parse(req.body);
  res.json(await previewLiquidation(data, accionistaId));
}));

liquidationsRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const data = liquidationInput.parse(req.body);
  const preview = await previewLiquidation(data, accionistaId);

  const result = await inTransaction(async (client) => {
    // El ingreso se liquida una sola vez y debe ser del agricultor indicado.
    let lotId = data.lot_id ?? null;
    if (data.weighing_ticket_id) {
      const entry = await client.query(
        "SELECT farmer_id, lot_id FROM weighing_tickets WHERE id = $1 FOR UPDATE",
        [data.weighing_ticket_id]
      );
      if (!entry.rowCount) throw new ApiError(404, "Ingreso de materia prima no encontrado");
      if (entry.rows[0].farmer_id !== data.farmer_id) {
        throw new ApiError(400, "Ese ingreso es de otro agricultor.");
      }
      const yaLiquidado = await client.query(
        "SELECT liquidation_number FROM liquidations WHERE weighing_ticket_id = $1 AND status <> 'CANCELLED'",
        [data.weighing_ticket_id]
      );
      if (yaLiquidado.rowCount) {
        throw new ApiError(409, `Ese ingreso ya fue liquidado (${yaLiquidado.rows[0].liquidation_number}).`);
      }
      lotId = lotId ?? entry.rows[0].lot_id;
    }

    const liquidation = await client.query(
      `INSERT INTO liquidations
       (liquidation_number, farmer_id, weighing_ticket_id, lot_id, quintals, price_per_quintal, gross_amount,
        advances_discount, other_discounts, discount_breakdown, net_amount, batch_id, created_by, accionista_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        nextCode("LIQ"),
        data.farmer_id,
        data.weighing_ticket_id ?? null,
        lotId,
        data.quintals,
        data.price_per_quintal,
        preview.gross_amount,
        preview.advances_discount,
        preview.other_discounts,
        data.discount_breakdown ? JSON.stringify(data.discount_breakdown) : null,
        preview.net_amount,
        data.batch_id ?? null,
        data.created_by,
        accionistaId
      ]
    );

    let remainingDiscount = preview.advances_discount;
    const advances = await client.query(
      `SELECT * FROM farmer_advances
       WHERE farmer_id = $1 AND accionista_id = $2 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0
       ORDER BY issued_at ASC
       FOR UPDATE`,
      [data.farmer_id, accionistaId]
    );

    for (const advance of advances.rows) {
      if (remainingDiscount <= 0) break;
      const applied = Math.min(Number(advance.balance), remainingDiscount);
      const newBalance = round2(Number(advance.balance) - applied);
      const newStatus = newBalance === 0 ? "PAID" : "PARTIAL";

      await client.query(
        "UPDATE farmer_advances SET balance = $2, status = $3 WHERE id = $1",
        [advance.id, newBalance, newStatus]
      );
      await client.query(
        `INSERT INTO advance_applications (advance_id, liquidation_id, amount_applied)
         VALUES ($1, $2, $3)`,
        [advance.id, liquidation.rows[0].id, applied]
      );
      remainingDiscount = round2(remainingDiscount - applied);
    }

    if (preview.net_amount > 0) {
      await client.query(
        `INSERT INTO accounts_payable (farmer_id, liquidation_id, amount, balance, accionista_id)
         VALUES ($1, $2, $3, $3, $4)`,
        [data.farmer_id, liquidation.rows[0].id, preview.net_amount, accionistaId]
      );
    }

    // El lote solo se marca como liquidado cuando TODOS sus ingresos ya se
    // pagaron: un lote puede juntar arroz de varios agricultores.
    if (lotId) {
      const pendientes = await client.query(
        `SELECT 1 FROM weighing_tickets w
         WHERE w.lot_id = $1
           AND w.is_maquila = false
           AND NOT EXISTS (
             SELECT 1 FROM liquidations q
             WHERE q.weighing_ticket_id = w.id AND q.status <> 'CANCELLED'
           )
         LIMIT 1`,
        [lotId]
      );
      if (!pendientes.rowCount) {
        await client.query("UPDATE lots SET status = 'LIQUIDATED' WHERE id = $1", [lotId]);
      }
    }
    return liquidation.rows[0];
  });

  res.status(201).json(result);
}));

liquidationsRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name,
            lo.lot_code, lo.rice_type,
            COALESCE(ap.balance, 0) AS pending_balance
     FROM liquidations l
     JOIN farmers f ON f.id = l.farmer_id
     LEFT JOIN lots lo ON lo.id = l.lot_id
     LEFT JOIN accounts_payable ap ON ap.liquidation_id = l.id
     WHERE l.accionista_id = $1
     ORDER BY l.created_at DESC`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// Aplicar anticipos pendientes del agricultor contra una liquidación ya realizada
liquidationsRouter.post("/:id/apply-advances", asyncRoute(async (req, res) => {
  const result = await inTransaction(async (client) => {
    // Traer la liquidación y su cuenta por pagar
    const liq = await client.query(
      `SELECT l.*, ap.id AS ap_id, ap.balance AS ap_balance
       FROM liquidations l
       LEFT JOIN accounts_payable ap ON ap.liquidation_id = l.id
       WHERE l.id = $1`,
      [req.params.id]
    );
    if (!liq.rows[0]) throw new Error("Liquidación no encontrada");
    const row = liq.rows[0];
    const apBalance = Number(row.ap_balance ?? 0);
    if (apBalance <= 0) throw new Error("Esta liquidación ya está pagada");

    // Traer anticipos pendientes del agricultor (del mismo accionista que la liquidación)
    const advances = await client.query(
      `SELECT * FROM farmer_advances
       WHERE farmer_id = $1 AND accionista_id = $2 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0
       ORDER BY issued_at ASC
       FOR UPDATE`,
      [row.farmer_id, row.accionista_id]
    );
    if (advances.rows.length === 0) throw new Error("No hay anticipos pendientes para este agricultor");

    let remaining = apBalance;
    let totalApplied = 0;

    for (const adv of advances.rows) {
      if (remaining <= 0) break;
      const applyAmt = Math.min(remaining, Number(adv.balance));

      // Reducir saldo del anticipo
      const newAdvBal = round2(Number(adv.balance) - applyAmt);
      const newAdvStatus = newAdvBal < 0.01 ? "PAID" : "PARTIAL";
      await client.query(
        "UPDATE farmer_advances SET balance = $2, status = $3 WHERE id = $1",
        [adv.id, newAdvBal, newAdvStatus]
      );

      // Registrar aplicación
      await client.query(
        `INSERT INTO advance_applications (advance_id, liquidation_id, amount_applied)
         VALUES ($1, $2, $3)`,
        [adv.id, req.params.id, applyAmt]
      );

      // Actualizar advances_discount en la liquidación
      await client.query(
        "UPDATE liquidations SET advances_discount = advances_discount + $2, net_amount = GREATEST(0, net_amount - $2) WHERE id = $1",
        [req.params.id, applyAmt]
      );

      totalApplied = round2(totalApplied + applyAmt);
      remaining = round2(remaining - applyAmt);
    }

    // Actualizar cuenta por pagar
    const newApBal = round2(apBalance - totalApplied);
    const newApStatus = newApBal < 0.01 ? "PAID" : "PARTIAL";
    await client.query(
      "UPDATE accounts_payable SET balance = $2, status = $3 WHERE id = $1",
      [row.ap_id, newApBal, newApStatus]
    );

    return { applied: totalApplied, remaining: newApBal };
  });

  res.json(result);
}));

// Anticipos aplicados a un lote de liquidaciones (para impresión detallada)
liquidationsRouter.get("/applied-advances", asyncRoute(async (req, res) => {
  const { batch_id, liquidation_ids } = req.query;

  let ids: string[] = [];
  if (batch_id) {
    const liq = await pool.query(
      "SELECT id FROM liquidations WHERE batch_id = $1",
      [batch_id]
    );
    ids = liq.rows.map((r: { id: string }) => r.id);
  } else if (liquidation_ids) {
    ids = String(liquidation_ids).split(",").filter(Boolean);
  }

  if (ids.length === 0) { res.json([]); return; }

  const result = await pool.query(
    `SELECT aa.amount_applied, fa.concept, fa.advance_number, fa.issued_at
     FROM advance_applications aa
     JOIN farmer_advances fa ON fa.id = aa.advance_id
     WHERE aa.liquidation_id = ANY($1::uuid[])
     ORDER BY fa.issued_at ASC`,
    [ids]
  );
  res.json(result.rows);
}));
