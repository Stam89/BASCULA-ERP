import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { nextCode } from "../../utils/codes.js";
import { createLotProcessReport } from "../../utils/process-reports.js";
import { calculateNetWeight, calculateQuintals } from "../../utils/rice-formulas.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const weighingRouter = Router();

// ── Corregir el accionista de un ingreso de materia prima ───────────────────
// Ingresos que aún NO forman parte de un lote. Filtrado por el accionista ACTIVO
// (header X-Accionista-Id → req.accionistaId):
//   · Vista global (MATRIZ/admin): todos los ingresos pendientes.
//   · Un socio específico: solo los suyos O los "Sin asignar" (accionista_id NULL);
//     se ocultan los que ya pertenecen a OTRO socio.
weighingRouter.get("/materia-prima", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId ?? null;
  const result = await pool.query(
    `SELECT w.id, w.ticket_number, w.quintals, w.net_weight, w.rice_type, w.created_at,
            w.accionista_id,
            a.name AS accionista_name,
            f.full_name AS farmer_name,
            m.raw_payload->>'numeroTicket' AS numero_bascula,
            EXISTS (
              SELECT 1 FROM liquidations q
              WHERE q.weighing_ticket_id = w.id AND q.status <> 'CANCELLED'
            ) AS liquidado
     FROM weighing_tickets w
     LEFT JOIN accionistas a ON a.id = w.accionista_id
     LEFT JOIN farmers f ON f.id = w.farmer_id
     LEFT JOIN mobile_synced_tickets m ON m.weighing_ticket_id = w.id
     WHERE w.lot_id IS NULL
       AND w.is_maquila = false
       AND (
         -- Vista global (MATRIZ) o sin contexto: todos.
         COALESCE((SELECT tipo FROM accionistas WHERE id = $1), 'MATRIZ') = 'MATRIZ'
         -- Socio activo: los suyos o los sin asignar.
         OR w.accionista_id = $1
         OR w.accionista_id IS NULL
       )
     ORDER BY w.created_at DESC
     LIMIT 300`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// Mueve el ingreso al accionista correcto. Arrastra su movimiento de inventario
// y el ticket de báscula, que también guardan a quién pertenecen: si se moviera
// solo el pesaje, el stock quedaría en el accionista equivocado.
weighingRouter.put("/:id/accionista", asyncRoute(async (req, res) => {
  const body = z.object({ accionista_id: z.string().uuid() }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const ticket = await client.query(
      "SELECT id, ticket_number, lot_id, accionista_id FROM weighing_tickets WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (!ticket.rowCount) throw new ApiError(404, "Ingreso de materia prima no encontrado");
    const actual = ticket.rows[0];
    if (actual.accionista_id === body.accionista_id) return { ...actual, sin_cambios: true };

    // Si ya entró a un lote, mover solo este pesaje descuadraría el lote: para
    // eso está el traspaso de lote, que además reparte la plata ya pagada.
    if (actual.lot_id) {
      const lote = await client.query("SELECT lot_code FROM lots WHERE id = $1", [actual.lot_id]);
      throw new ApiError(
        409,
        `Este ingreso ya forma parte del lote ${lote.rows[0]?.lot_code ?? ""}. Usa «Pasar un lote a otro accionista» en Báscula.`
      );
    }

    // Si ya se le pagó al agricultor, hay plata de por medio: la liquidación y
    // su cuenta por pagar son del accionista actual y no se pueden mover solas.
    const liquidado = await client.query(
      "SELECT liquidation_number FROM liquidations WHERE weighing_ticket_id = $1 AND status <> 'CANCELLED' LIMIT 1",
      [req.params.id]
    );
    if (liquidado.rowCount) {
      throw new ApiError(
        409,
        `Este ingreso ya fue liquidado (${liquidado.rows[0].liquidation_number}). Anula esa liquidación antes de cambiar de accionista.`
      );
    }

    const destino = await client.query(
      "SELECT id, name FROM accionistas WHERE id = $1 AND is_active = true",
      [body.accionista_id]
    );
    if (!destino.rowCount) throw new ApiError(404, "Accionista no encontrado");

    const updated = await client.query(
      "UPDATE weighing_tickets SET accionista_id = $2 WHERE id = $1 RETURNING id, ticket_number",
      [req.params.id, body.accionista_id]
    );
    // El stock: sin esto la cáscara se quedaría con el accionista equivocado.
    await client.query(
      `UPDATE inventory_movements SET accionista_id = $2
       WHERE reference_type = 'weighing_tickets' AND reference_id = $1`,
      [req.params.id, body.accionista_id]
    );
    await client.query(
      "UPDATE mobile_synced_tickets SET accionista_id = $2 WHERE weighing_ticket_id = $1",
      [req.params.id, body.accionista_id]
    );

    return { ...updated.rows[0], accionista_name: destino.rows[0].name };
  });

  res.json(result);
}));

const createSchema = z.object({
  farmer_id: z.string().uuid(),
  vehicle_id: z.string().uuid().optional(),
  rice_type: z.enum(["0.11", "CORRIENTE"]).default("0.11"),
  ownership: z.enum(["OWNED", "MAQUILA", "SERVICE_ONLY"]).default("OWNED"),
  is_maquila: z.boolean().default(false),
  gross_weight: z.number().nonnegative().default(0),
  created_by: z.string().uuid().optional(),
  notes: z.string().optional()
});

weighingRouter.post("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const data = createSchema.parse(req.body);
  const result = await inTransaction(async (client) => {
    const lot = await client.query(
      `INSERT INTO lots (lot_code, print_batch_code, farmer_id, rice_type, ownership, is_maquila, status, notes, accionista_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8)
       RETURNING *`,
      [
        nextCode("LT"),
        nextCode("IMP"),
        data.farmer_id,
        data.rice_type,
        data.is_maquila ? "MAQUILA" : data.ownership,
        data.is_maquila,
        data.notes,
        accionistaId
      ]
    );

    const ticket = await client.query(
      `INSERT INTO weighing_tickets
       (ticket_number, lot_id, farmer_id, vehicle_id, is_maquila, gross_weight, weighed_in_at, created_by, notes, accionista_id)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9)
       RETURNING *`,
      [
        nextCode("BAS"),
        lot.rows[0].id,
        data.farmer_id,
        data.vehicle_id,
        data.is_maquila,
        data.gross_weight,
        data.created_by,
        data.notes,
        accionistaId
      ]
    );

    return { lot: lot.rows[0], ticket: ticket.rows[0] };
  });

  res.status(201).json(result);
}));

weighingRouter.put("/:id/gross-weight", asyncRoute(async (req, res) => {
  const body = z.object({ gross_weight: z.number().nonnegative() }).parse(req.body);
  const locked = await pool.query("SELECT is_locked FROM weighing_tickets WHERE id = $1", [req.params.id]);
  if (!locked.rowCount) throw new ApiError(404, "Ticket no encontrado");
  if (locked.rows[0].is_locked) throw new ApiError(423, "Ticket bloqueado");

  const result = await pool.query(
    `UPDATE weighing_tickets
     SET gross_weight = $2, weighed_in_at = COALESCE(weighed_in_at, now())
     WHERE id = $1
     RETURNING *`,
    [req.params.id, body.gross_weight]
  );
  if (!result.rowCount) throw new ApiError(404, "Ticket no encontrado");
  res.json(result.rows[0]);
}));

weighingRouter.put("/:id/tare-weight", asyncRoute(async (req, res) => {
  const body = z.object({ tare_weight: z.number().nonnegative() }).parse(req.body);
  const locked = await pool.query("SELECT is_locked FROM weighing_tickets WHERE id = $1", [req.params.id]);
  if (!locked.rowCount) throw new ApiError(404, "Ticket no encontrado");
  if (locked.rows[0].is_locked) throw new ApiError(423, "Ticket bloqueado");

  const result = await pool.query(
    `UPDATE weighing_tickets
     SET tare_weight = $2, weighed_out_at = COALESCE(weighed_out_at, now())
     WHERE id = $1
     RETURNING *`,
    [req.params.id, body.tare_weight]
  );
  if (!result.rowCount) throw new ApiError(404, "Ticket no encontrado");
  res.json(result.rows[0]);
}));

weighingRouter.put("/:id/qualification", asyncRoute(async (req, res) => {
  const body = z.object({ qualification: z.number().positive() }).parse(req.body);
  const current = await pool.query("SELECT gross_weight, tare_weight, is_locked FROM weighing_tickets WHERE id = $1", [req.params.id]);
  if (!current.rowCount) throw new ApiError(404, "Ticket no encontrado");
  if (current.rows[0].is_locked) throw new ApiError(423, "Ticket bloqueado");

  const net = calculateNetWeight(Number(current.rows[0].gross_weight), Number(current.rows[0].tare_weight));
  const quintals = calculateQuintals(net, body.qualification);
  const result = await pool.query(
    `UPDATE weighing_tickets
     SET qualification = $2, quintals = $3
     WHERE id = $1
     RETURNING *`,
    [req.params.id, body.qualification, quintals]
  );
  res.json(result.rows[0]);
}));

weighingRouter.post("/:id/close", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const body = z.object({
    product_id: z.string().uuid().optional(),
    warehouse_id: z.string().uuid().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const ticket = await client.query(
      `SELECT t.*, l.ownership
       FROM weighing_tickets t
       JOIN lots l ON l.id = t.lot_id
       WHERE t.id = $1
       FOR UPDATE`,
      [req.params.id]
    );
    if (!ticket.rowCount) throw new ApiError(404, "Ticket no encontrado");
    if (!ticket.rows[0].qualification || !ticket.rows[0].quintals) {
      throw new ApiError(400, "Debe ingresar calificacion antes de cerrar el ticket");
    }

    const updated = await client.query(
      "UPDATE weighing_tickets SET status = 'CONFIRMED', is_locked = true WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    await client.query("UPDATE lots SET status = 'WEIGHED' WHERE id = $1", [ticket.rows[0].lot_id]);

    if (body.product_id && body.warehouse_id) {
      await client.query(
        `INSERT INTO inventory_movements
         (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, created_by, accionista_id)
         VALUES ($1, $2, $3, 'IN', $4, 'weighing_tickets', $5, $6, $7, $8)`,
        [
          body.product_id,
          body.warehouse_id,
          ticket.rows[0].lot_id,
          ticket.rows[0].quintals,
          ticket.rows[0].id,
          ticket.rows[0].ownership,
          body.created_by,
          accionistaId
        ]
      );
    }

    await createLotProcessReport(client, {
      lotId: ticket.rows[0].lot_id,
      stage: "BASCULA",
      title: `Informe de bascula ${ticket.rows[0].ticket_number}`,
      referenceType: "weighing_tickets",
      referenceId: ticket.rows[0].id,
      data: {
        ticket_number: ticket.rows[0].ticket_number,
        gross_weight: Number(updated.rows[0].gross_weight),
        tare_weight: Number(updated.rows[0].tare_weight),
        net_weight: Number(updated.rows[0].net_weight),
        qualification: Number(updated.rows[0].qualification),
        quintals: Number(updated.rows[0].quintals),
        is_maquila: updated.rows[0].is_maquila
      },
      notes: updated.rows[0].notes,
      createdBy: body.created_by
    });

    return updated.rows[0];
  });

  res.json(result);
}));

weighingRouter.get("/:id", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT t.*, l.lot_code, l.print_batch_code, f.full_name AS farmer_name, v.plate
     FROM weighing_tickets t
     JOIN lots l ON l.id = t.lot_id
     LEFT JOIN farmers f ON f.id = t.farmer_id
     LEFT JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.id = $1`,
    [req.params.id]
  );
  if (!result.rowCount) throw new ApiError(404, "Ticket no encontrado");
  res.json(result.rows[0]);
}));
