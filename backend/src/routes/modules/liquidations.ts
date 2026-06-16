import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { nextCode } from "../../utils/codes.js";
import { round2 } from "../../utils/rice-formulas.js";

export const liquidationsRouter = Router();

const liquidationInput = z.object({
  farmer_id: z.string().uuid(),
  lot_id: z.string().uuid(),
  quintals: z.number().positive(),
  price_per_quintal: z.number().nonnegative(),
  other_discounts: z.number().nonnegative().default(0),
  created_by: z.string().uuid().optional()
});

async function previewLiquidation(data: z.infer<typeof liquidationInput>) {
  const gross = round2(data.quintals * data.price_per_quintal);
  const advances = await pool.query(
    `SELECT COALESCE(SUM(balance), 0) AS pending
     FROM farmer_advances
     WHERE farmer_id = $1 AND status IN ('CONFIRMED', 'PARTIAL')`,
    [data.farmer_id]
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
  const data = liquidationInput.parse(req.body);
  res.json(await previewLiquidation(data));
}));

liquidationsRouter.post("/", asyncRoute(async (req, res) => {
  const data = liquidationInput.parse(req.body);
  const preview = await previewLiquidation(data);

  const result = await inTransaction(async (client) => {
    const liquidation = await client.query(
      `INSERT INTO liquidations
       (liquidation_number, farmer_id, lot_id, quintals, price_per_quintal, gross_amount,
        advances_discount, other_discounts, net_amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        nextCode("LIQ"),
        data.farmer_id,
        data.lot_id,
        data.quintals,
        data.price_per_quintal,
        preview.gross_amount,
        preview.advances_discount,
        preview.other_discounts,
        preview.net_amount,
        data.created_by
      ]
    );

    let remainingDiscount = preview.advances_discount;
    const advances = await client.query(
      `SELECT * FROM farmer_advances
       WHERE farmer_id = $1 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0
       ORDER BY issued_at ASC
       FOR UPDATE`,
      [data.farmer_id]
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
        `INSERT INTO accounts_payable (farmer_id, liquidation_id, amount, balance)
         VALUES ($1, $2, $3, $3)`,
        [data.farmer_id, liquidation.rows[0].id, preview.net_amount]
      );
    }

    await client.query("UPDATE lots SET status = 'LIQUIDATED' WHERE id = $1", [data.lot_id]);
    return liquidation.rows[0];
  });

  res.status(201).json(result);
}));

liquidationsRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name
     FROM liquidations l
     JOIN farmers f ON f.id = l.farmer_id
     ORDER BY l.created_at DESC`
  );
  res.json(result.rows);
}));
