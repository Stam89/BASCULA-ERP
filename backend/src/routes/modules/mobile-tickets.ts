import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { inTransaction } from "../../db/transaction.js";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAuth, resolveAccionista, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { calculateNetWeight, calculateQuintals, round2 } from "../../utils/rice-formulas.js";

export const mobileTicketsRouter = Router();

// UUID determinístico (estilo v5) a partir de una clave estable, para que el
// mismo ticket de la app (mismo número) siempre mapee al mismo registro.
function stableUuid(key: string): string {
  const h = crypto.createHash("sha1").update(`bascula:${key}`).digest("hex");
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Formato NATIVO de la app de báscula (com.example.bascula).
const basculaTicketSchema = z.object({
  numeroTicket: z.union([z.string(), z.number()]).transform((v) => String(v)),
  modo: z.string().optional().default("principal"),
  cliente: z.string().optional().default(""),
  placa: z.string().optional(),
  fecha: z.string().optional(),
  calificacion: z.coerce.number().nonnegative().default(0),
  pesoBruto: z.coerce.number().nonnegative().default(0),
  pesoTara: z.coerce.number().nonnegative().default(0),
  pesoNeto: z.coerce.number().optional(),
  totalQQ: z.coerce.number().optional(),
  valorPagar: z.union([z.string(), z.number()]).optional(),
  actualizadoEn: z.coerce.number().optional(),
  actualizadoPor: z.string().optional()
});

const basculaImportSchema = z.object({
  deviceId: z.string().optional().default("bascula-app"),
  tickets: z.array(basculaTicketSchema).min(1)
});

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
     WHERE farmer_id = $1 AND accionista_id = $2 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0`,
    [row.farmer_id, row.accionista_id]
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
       WHERE farmer_id = $1 AND accionista_id = $2 AND status IN ('CONFIRMED', 'PARTIAL') AND balance > 0
       ORDER BY issued_at ASC
       FOR UPDATE`,
      [row.farmer_id, row.accionista_id]
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
        `INSERT INTO accounts_payable (farmer_id, amount, balance, status, accionista_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [row.farmer_id, netPayable, cashRegisterId ? 0 : netPayable, cashRegisterId ? "PAID" : "CONFIRMED", row.accionista_id]
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

// Lista los tickets sincronizados/importados de la báscula (para la vista web).
// Muestra los ya vinculados al accionista activo, más los que aún no tienen
// accionista asignado (recién importados de la báscula, pendientes de vincular).
mobileTicketsRouter.get("/", requireAuth, resolveAccionista, asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const q = z.object({ status: z.enum(["pending", "liquidated"]).optional() }).parse(req.query);
  const statusFilter = q.status === "pending" ? "t.liquidated_at IS NULL"
    : q.status === "liquidated" ? "t.liquidated_at IS NOT NULL" : "";
  const conditions = ["(t.accionista_id = $1 OR t.accionista_id IS NULL)"];
  if (statusFilter) conditions.push(statusFilter);
  const result = await pool.query(
    `SELECT t.id, t.farmer_id, t.farmer_name, t.accionista_id, t.gross_weight, t.tare_weight, t.net_weight,
            t.qualification, t.quintals, t.price_per_quintal, t.net_payable, t.liquidated_at,
            t.mobile_updated_at,
            t.raw_payload->>'numeroTicket' AS numero,
            t.raw_payload->>'modo' AS modo,
            t.raw_payload->>'fecha' AS fecha_app,
            t.raw_payload->>'placa' AS placa,
            t.raw_payload->>'calidad' AS calidad
     FROM mobile_synced_tickets t
     WHERE ${conditions.join(" AND ")}
     ORDER BY t.liquidated_at IS NOT NULL, t.mobile_updated_at DESC NULLS LAST
     LIMIT 500`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// Vincula un ticket a un agricultor (existente por id, o crea uno por nombre)
// y lo reclama para el accionista activo si aún no tenía uno asignado.
mobileTicketsRouter.post("/:id/link-farmer", requireAuth, resolveAccionista, asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    farmer_id: z.string().uuid().optional(),
    full_name: z.string().optional()
  }).parse(req.body);

  let farmerId = body.farmer_id;
  if (!farmerId) {
    const name = (body.full_name ?? "").trim();
    if (name.length < 2) throw new ApiError(400, "Elige un agricultor o escribe un nombre para crearlo");
    const created = await pool.query(
      "INSERT INTO farmers (full_name) VALUES ($1) RETURNING id, full_name",
      [name]
    );
    farmerId = created.rows[0].id;
  }

  const existing = await pool.query(
    "SELECT accionista_id FROM mobile_synced_tickets WHERE id = $1",
    [req.params.id]
  );
  if (!existing.rowCount) throw new ApiError(404, "Ticket no encontrado");
  if (existing.rows[0].accionista_id && existing.rows[0].accionista_id !== accionistaId) {
    throw new ApiError(409, "Este ticket ya fue vinculado por otro accionista.");
  }

  const updated = await pool.query(
    `UPDATE mobile_synced_tickets
     SET farmer_id = $2, accionista_id = COALESCE(accionista_id, $3)
     WHERE id = $1
     RETURNING id, farmer_id, farmer_name, accionista_id`,
    [req.params.id, farmerId, accionistaId]
  );
  res.json(updated.rows[0]);
}));

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

// Mapea e inserta tickets en el formato NATIVO de la app de báscula. Idempotente
// (mismo numeroTicket = mismo registro). Reutilizable por el endpoint HTTP y por
// la importación automática desde Firebase.
export async function importBasculaTickets(
  rawTickets: unknown[],
  deviceId = "bascula"
): Promise<{ imported: Array<{ numeroTicket: string; id: string }>; count: number }> {
  const imported: Array<{ numeroTicket: string; id: string }> = [];
  for (const raw of rawTickets) {
    const t = basculaTicketSchema.parse(raw);
    const id = stableUuid(`${t.modo}_${t.numeroTicket}`);
    let netWeight = t.pesoNeto ?? calculateNetWeight(t.pesoBruto, t.pesoTara);
    if (netWeight < 0) netWeight = 0; // no romper el lote por un ticket con tara mayor
    const quintals = t.totalQQ ?? (t.calificacion > 0 ? calculateQuintals(netWeight, t.calificacion) : 0);
    const ts = t.actualizadoEn ?? Date.now();

    await pool.query(
      `INSERT INTO mobile_synced_tickets (
        id, device_id, farmer_id, farmer_name,
        gross_weight, tare_weight, net_weight, qualification, quintals,
        print_count, is_locked, price_per_quintal, gross_payable, advances_discount, net_payable,
        liquidated_at, mobile_created_at, mobile_updated_at, synced_at, raw_payload
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, 0, false, 0, 0, 0, 0, NULL, $9, $9, now(), $10)
      ON CONFLICT (id) DO UPDATE SET
        device_id = EXCLUDED.device_id,
        farmer_name = EXCLUDED.farmer_name,
        gross_weight = EXCLUDED.gross_weight,
        tare_weight = EXCLUDED.tare_weight,
        net_weight = EXCLUDED.net_weight,
        qualification = EXCLUDED.qualification,
        quintals = EXCLUDED.quintals,
        mobile_updated_at = EXCLUDED.mobile_updated_at,
        synced_at = now(),
        raw_payload = EXCLUDED.raw_payload`,
      [id, deviceId, (t.cliente || "").trim(), t.pesoBruto, t.pesoTara, netWeight, t.calificacion, quintals, ts, JSON.stringify(t)]
    );
    imported.push({ numeroTicket: t.numeroTicket, id });
  }
  return { imported, count: imported.length };
}

// Importa tickets en el formato NATIVO de la app de báscula (por ejemplo desde
// un puente que los lee de Firebase).
mobileTicketsRouter.post("/import-bascula", asyncRoute(async (req, res) => {
  const body = basculaImportSchema.parse(req.body);
  const result = await importBasculaTickets(body.tickets, body.deviceId);
  res.status(201).json(result);
}));

// Trae los tickets desde Firebase ahora mismo (botón "Importar" en la app).
mobileTicketsRouter.post("/refresh-firebase", asyncRoute(async (_req, res) => {
  const { importFromFirebase } = await import("../../integrations/bascula-firebase.js");
  const result = await importFromFirebase();
  if (!result.ok) throw new ApiError(400, result.reason);
  res.json(result);
}));

async function assertTicketBelongsToAccionista(ticketId: string, accionistaId: string | undefined) {
  const ticket = await pool.query(
    "SELECT accionista_id FROM mobile_synced_tickets WHERE id = $1",
    [ticketId]
  );
  if (!ticket.rowCount) throw new ApiError(404, "Ticket no encontrado");
  if (ticket.rows[0].accionista_id && ticket.rows[0].accionista_id !== accionistaId) {
    throw new ApiError(403, "Este ticket pertenece a otro accionista.");
  }
}

mobileTicketsRouter.post("/:id/liquidation-preview", requireAuth, resolveAccionista, asyncRoute(async (req, res) => {
  const body = liquidationSchema.parse(req.body);
  await assertTicketBelongsToAccionista(String(req.params.id), (req as AuthenticatedRequest).accionistaId);
  res.json(await previewLiquidacionTicket(String(req.params.id), body.precioQQ));
}));

mobileTicketsRouter.post("/:id/liquidate", requireAuth, resolveAccionista, asyncRoute(async (req, res) => {
  const body = liquidationSchema.parse(req.body);
  await assertTicketBelongsToAccionista(String(req.params.id), (req as AuthenticatedRequest).accionistaId);
  const result = await procesarLiquidacionTicket(
    String(req.params.id),
    body.precioQQ,
    body.cash_register_id,
    body.created_by
  );
  res.status(201).json(result);
}));
