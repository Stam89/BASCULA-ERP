import { Router } from "express";
import { z } from "zod";
import { inTransaction } from "../../db/transaction.js";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { calculateNetWeight, calculateQuintals, round2 } from "../../utils/rice-formulas.js";

export const mobileTicketsRouter = Router();

const ticketSchema = z.object({
  id: z.string().uuid(),
  farmerId: z.string().uuid().optional().nullable(),
  farmerName: z.string().optional(),
  agricultor: z.string().optional(),
  grossWeight: z.number().nonnegative(),
  tareWeight: z.number().nonnegative(),
  netWeight: z.number().optional(),
  qualification: z.number().nonnegative(),
  quintals: z.number().optional(),
  printCount: z.number().int().nonnegative().default(0),
  isLocked: z.boolean().default(false),
  isSynced: z.boolean().optional(),
  pricePerQuintal: z.number().nonnegative().default(0),
  grossPayable: z.number().nonnegative().default(0),
  advancesDiscount: z.number().nonnegative().default(0),
  netPayable: z.number().nonnegative().default(0),
  liquidatedAt: z.number().int().nonnegative().optional().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});

const syncSchema = z.object({
  deviceId: z.string().optional().default(""),
  tickets: z.array(ticketSchema).min(1)
});

const liquidationSchema = z.object({
  precioQQ: z.number().nonnegative(),
  cash_register_id: z.string().uuid().optional(),
  created_by: z.string().uuid().optional()
});

type LiquidationResult = {
  ticketId: string;
  farmerId: string;
  quintals: number;
  pricePerQuintal: number;
  grossPayable: number;
  pendingAdvancesTotal: number;
  advancesDiscount: number;
  netPayable: number;
  appliedAdvances: Array<{ advanceId: string; amountApplied: number; remainingBalance: number }>;
  accountsPayableId: string | null;
  cashMovementId: string | null;
};

async function previewLiquidacionTicket(ticketId: string, precioQQ: number): Promise<LiquidationResult> {
  const ticket = await pool.query(
    "SELECT * FROM mobile_synced_tickets WHERE id = $1",
    [ticketId]
  );
  if (!ticket.rowCount) throw new ApiError(404, "Ticket no encontrado");

  const row = ticket.rows[0];
  if (!row.farmer_id) throw new ApiError(400, "El ticket no tiene agricultor vinculado");

  const quintals = Number(row.quintals);
  if (quintals <= 0) throw new ApiError(400, "El ticket debe tener QQ calculados");

  const grossPayable = round2(quintals * precioQQ);
  const advances = await pool.query(
    `SELECT COALESCE(SUM(balance), 0) AS total
     FROM farmer_advances
     WHERE farmer_id = $1 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0`,
    [row.farmer_id]
  );
  const pendingAdvancesTotal = round2(Number(advances.rows[0].total));
  const advancesDiscount = round2(Math.min(grossPayable, pendingAdvancesTotal));
  const netPayable = round2(grossPayable - advancesDiscount);

  return {
    ticketId,
    farmerId: row.farmer_id,
    quintals,
    pricePerQuintal: precioQQ,
    grossPayable,
    pendingAdvancesTotal,
    advancesDiscount,
    netPayable,
    appliedAdvances: [],
    accountsPayableId: null,
    cashMovementId: null
  };
}

export async function procesarLiquidacionTicket(
  ticketId: string,
  precioQQ: number,
  cashRegisterId?: string,
  createdBy?: string
): Promise<LiquidationResult> {
  return inTransaction(async (client) => {
    const ticket = await client.query(
      "SELECT * FROM mobile_synced_tickets WHERE id = $1 FOR UPDATE",
      [ticketId]
    );
    if (!ticket.rowCount) throw new ApiError(404, "Ticket no encontrado");

    const row = ticket.rows[0];
    if (!row.farmer_id) throw new ApiError(400, "El ticket no tiene agricultor vinculado");

    const quintals = Number(row.quintals);
    if (quintals <= 0) throw new ApiError(400, "El ticket debe tener QQ calculados");

    const grossPayable = round2(quintals * precioQQ);
    let remainingDiscount = grossPayable;
    let advancesDiscount = 0;
    let pendingAdvancesTotal = 0;
    const appliedAdvances: LiquidationResult["appliedAdvances"] = [];

    const advances = await client.query(
      `SELECT *
       FROM farmer_advances
       WHERE farmer_id = $1 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0
       ORDER BY issued_at ASC
       FOR UPDATE`,
      [row.farmer_id]
    );

    for (const advance of advances.rows) {
      pendingAdvancesTotal = round2(pendingAdvancesTotal + Number(advance.balance));
      if (remainingDiscount <= 0) continue;

      const applied = round2(Math.min(Number(advance.balance), remainingDiscount));
      const newBalance = round2(Number(advance.balance) - applied);
      const newStatus = newBalance <= 0 ? "PAID" : "PARTIAL";

      await client.query(
        "UPDATE farmer_advances SET balance = $2, status = $3 WHERE id = $1",
        [advance.id, newBalance, newStatus]
      );
      await client.query(
        `INSERT INTO mobile_advance_applications (advance_id, ticket_id, amount_applied)
         VALUES ($1, $2, $3)`,
        [advance.id, ticketId, applied]
      );

      advancesDiscount = round2(advancesDiscount + applied);
      remainingDiscount = round2(remainingDiscount - applied);
      appliedAdvances.push({
        advanceId: advance.id,
        amountApplied: applied,
        remainingBalance: newBalance
      });
    }

    const netPayable = round2(grossPayable - advancesDiscount);
    const payable = netPayable > 0
      ? await client.query(
        `INSERT INTO accounts_payable (farmer_id, amount, balance, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [row.farmer_id, netPayable, cashRegisterId ? 0 : netPayable, cashRegisterId ? "PAID" : "CONFIRMED"]
      )
      : null;

    let cashMovementId: string | null = null;
    if (cashRegisterId && netPayable > 0) {
      await client.query(
        `INSERT INTO payments_made (payable_id, cash_register_id, amount, created_by)
         VALUES ($1, $2, $3, $4)`,
        [payable?.rows[0].id, cashRegisterId, netPayable, createdBy]
      );
      const movement = await client.query(
        `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
         VALUES ($1, 'EXPENSE', 'LIQUIDACION_AGRICULTOR', 'mobile_synced_tickets', $2, $3, $4, $5)
         RETURNING id`,
        [cashRegisterId, ticketId, netPayable, "Pago neto por liquidacion de ticket", createdBy]
      );
      cashMovementId = movement.rows[0].id;
    }

    await client.query(
      `UPDATE mobile_synced_tickets
       SET price_per_quintal = $2,
           gross_payable = $3,
           advances_discount = $4,
           net_payable = $5,
           is_locked = true,
           liquidated_at = now(),
           synced_at = now()
       WHERE id = $1`,
      [ticketId, precioQQ, grossPayable, advancesDiscount, netPayable]
    );

    return {
      ticketId,
      farmerId: row.farmer_id,
      quintals,
      pricePerQuintal: precioQQ,
      grossPayable,
      pendingAdvancesTotal: round2(pendingAdvancesTotal),
      advancesDiscount,
      netPayable,
      appliedAdvances,
      accountsPayableId: payable?.rows[0].id ?? null,
      cashMovementId
    };
  });
}

mobileTicketsRouter.post("/sync", asyncRoute(async (req, res) => {
  const body = syncSchema.parse(req.body);
  const syncedIds: string[] = [];

  for (const ticket of body.tickets) {
    const farmerName = (ticket.farmerName || ticket.agricultor || "").trim();
    if (ticket.farmerId && farmerName) {
      await pool.query(
        `INSERT INTO farmers (id, full_name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           updated_at = now()`,
        [ticket.farmerId, farmerName]
      );
    }

    const netWeight = calculateNetWeight(ticket.grossWeight, ticket.tareWeight);
    if (netWeight < 0) {
      throw new ApiError(400, `Ticket ${ticket.id}: la tara no puede ser mayor que el bruto`);
    }

    const quintals = ticket.qualification > 0
      ? calculateQuintals(netWeight, ticket.qualification)
      : 0;

    await pool.query(
      `INSERT INTO mobile_synced_tickets (
        id,
        device_id,
        farmer_id,
        farmer_name,
        gross_weight,
        tare_weight,
        net_weight,
        qualification,
        quintals,
        print_count,
        is_locked,
        price_per_quintal,
        gross_payable,
        advances_discount,
        net_payable,
        liquidated_at,
        mobile_created_at,
        mobile_updated_at,
        synced_at,
        raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now(), $19)
      ON CONFLICT (id) DO UPDATE SET
        device_id = EXCLUDED.device_id,
        farmer_id = EXCLUDED.farmer_id,
        farmer_name = EXCLUDED.farmer_name,
        gross_weight = EXCLUDED.gross_weight,
        tare_weight = EXCLUDED.tare_weight,
        net_weight = EXCLUDED.net_weight,
        qualification = EXCLUDED.qualification,
        quintals = EXCLUDED.quintals,
        print_count = EXCLUDED.print_count,
        is_locked = EXCLUDED.is_locked,
        price_per_quintal = EXCLUDED.price_per_quintal,
        gross_payable = EXCLUDED.gross_payable,
        advances_discount = EXCLUDED.advances_discount,
        net_payable = EXCLUDED.net_payable,
        liquidated_at = EXCLUDED.liquidated_at,
        mobile_created_at = EXCLUDED.mobile_created_at,
        mobile_updated_at = EXCLUDED.mobile_updated_at,
        synced_at = now(),
        raw_payload = EXCLUDED.raw_payload`,
      [
        ticket.id,
        body.deviceId,
        ticket.farmerId ?? null,
        farmerName,
        ticket.grossWeight,
        ticket.tareWeight,
        netWeight,
        ticket.qualification,
        quintals,
        ticket.printCount,
        ticket.isLocked,
        ticket.pricePerQuintal,
        ticket.grossPayable,
        ticket.advancesDiscount,
        ticket.netPayable,
        ticket.liquidatedAt ? new Date(ticket.liquidatedAt) : null,
        ticket.createdAt,
        ticket.updatedAt,
        JSON.stringify(ticket)
      ]
    );

    syncedIds.push(ticket.id);
  }

  res.status(201).json({
    syncedIds,
    count: syncedIds.length
  });
}));

mobileTicketsRouter.post("/:id/liquidation-preview", asyncRoute(async (req, res) => {
  const body = liquidationSchema.parse(req.body);
  res.json(await previewLiquidacionTicket(String(req.params.id), body.precioQQ));
}));

mobileTicketsRouter.post("/:id/liquidate", asyncRoute(async (req, res) => {
  const body = liquidationSchema.parse(req.body);
  const result = await procesarLiquidacionTicket(
    String(req.params.id),
    body.precioQQ,
    body.cash_register_id,
    body.created_by
  );
  res.status(201).json(result);
}));
