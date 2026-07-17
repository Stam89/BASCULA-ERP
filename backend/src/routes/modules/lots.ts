import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";

export const lotsRouter = Router();

// Pasa un lote de un accionista a otro. Arrastra todo lo suyo —pesajes,
// inventario (incluido el arroz ya pilado), proceso y liquidaciones— para que
// el stock y las cuentas no queden descuadrados.
//
// Si al agricultor ya se le habia pagado algo, esa plata salio de la caja del
// que entrega: se le deja como cuenta por cobrar, y al que recibe como cuenta
// por pagar. Lo que aun se le debe al agricultor pasa al que recibe, que le
// paga directo. Asi el que entrega queda en cero y el que recibe termina
// pagando el costo real del lote.
//
// Solo se bloquea si el lote ya tiene ventas: ahi ya entro plata de un cliente
// y deshacerlo sale del alcance de un traspaso.
lotsRouter.put("/:id/accionista", asyncRoute(async (req, res) => {
  const body = z.object({
    accionista_id: z.string().uuid(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    const lotResult = await client.query(
      "SELECT id, lot_code, status, accionista_id FROM lots WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (!lotResult.rowCount) throw new ApiError(404, "Lote no encontrado");
    const lot = lotResult.rows[0];
    if (lot.accionista_id === body.accionista_id) return { ...lot, sin_cambios: true };

    const destino = await client.query(
      "SELECT id, name FROM accionistas WHERE id = $1 AND is_active = true",
      [body.accionista_id]
    );
    if (!destino.rowCount) throw new ApiError(404, "Accionista no encontrado");

    const origen = await client.query("SELECT id, name FROM accionistas WHERE id = $1", [lot.accionista_id]);
    if (!origen.rowCount) throw new ApiError(409, "El lote no tiene accionista de origen");

    const sold = await client.query("SELECT 1 FROM sale_items WHERE lot_id = $1 LIMIT 1", [req.params.id]);
    if (sold.rowCount) {
      throw new ApiError(409, "Este lote ya tiene ventas: no se puede cambiar de accionista.");
    }

    // Lo ya cancelado al agricultor es lo que salio de la caja del que entrega:
    // en cada cuenta por pagar, monto menos saldo.
    const cuentas = await client.query(
      `SELECT COALESCE(SUM(p.amount - p.balance), 0) AS pagado,
              COALESCE(SUM(p.balance), 0) AS pendiente
       FROM accounts_payable p
       JOIN liquidations l ON l.id = p.liquidation_id
       WHERE l.lot_id = $1`,
      [req.params.id]
    );
    const pagado = Number(cuentas.rows[0].pagado);
    const pendiente = Number(cuentas.rows[0].pendiente);

    // Mueve el lote y todo lo que cuelga de el.
    const updated = await client.query(
      "UPDATE lots SET accionista_id = $2 WHERE id = $1 RETURNING id, lot_code, accionista_id",
      [req.params.id, body.accionista_id]
    );
    await client.query("UPDATE weighing_tickets SET accionista_id = $2 WHERE lot_id = $1", [req.params.id, body.accionista_id]);
    await client.query("UPDATE inventory_movements SET accionista_id = $2 WHERE lot_id = $1", [req.params.id, body.accionista_id]);
    await client.query("UPDATE processing_batches SET accionista_id = $2 WHERE lot_id = $1", [req.params.id, body.accionista_id]);
    await client.query("UPDATE liquidations SET accionista_id = $2 WHERE lot_id = $1", [req.params.id, body.accionista_id]);
    await client.query(
      `UPDATE accounts_payable SET accionista_id = $2
       WHERE liquidation_id IN (SELECT id FROM liquidations WHERE lot_id = $1)`,
      [req.params.id, body.accionista_id]
    );
    await client.query(
      `UPDATE milling_drafts SET accionista_id = $2
       WHERE drying_report_id IN (SELECT id FROM drying_tunnel_reports WHERE lot_id = $1)`,
      [req.params.id, body.accionista_id]
    );

    const transfer = await client.query(
      `INSERT INTO lot_transfers
       (lot_id, from_accionista_id, to_accionista_id, amount_paid, amount_pending, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [req.params.id, lot.accionista_id, body.accionista_id, pagado, pendiente, body.notes ?? null, body.created_by ?? null]
    );
    const transferId = transfer.rows[0].id;

    // Solo hay deuda entre accionistas si el que entrega alcanzo a pagar algo.
    let receivableId: string | null = null;
    let payableId: string | null = null;
    if (pagado > 0) {
      const desc = `Lote ${lot.lot_code} traspasado de ${origen.rows[0].name} a ${destino.rows[0].name}`;
      const ar = await client.query(
        `INSERT INTO accounts_receivable
         (accionista_id, reference_type, reference_id, description, amount, balance)
         VALUES ($1, 'lot_transfer', $2, $3, $4, $4)
         RETURNING id`,
        [lot.accionista_id, transferId, `${desc} (ya cancelado al agricultor)`, pagado]
      );
      receivableId = ar.rows[0].id;

      const ap = await client.query(
        `INSERT INTO accounts_payable
         (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance)
         VALUES ($1, NULL, 'lot_transfer', $2, $3, $4, $4)
         RETURNING id`,
        [body.accionista_id, transferId, `${desc} (reintegro de lo que ya pago)`, pagado]
      );
      payableId = ap.rows[0].id;

      await client.query(
        "UPDATE lot_transfers SET receivable_id = $2, payable_id = $3 WHERE id = $1",
        [transferId, receivableId, payableId]
      );
    }

    return {
      ...updated.rows[0],
      accionista_name: destino.rows[0].name,
      traspaso: {
        id: transferId,
        de: origen.rows[0].name,
        para: destino.rows[0].name,
        ya_cancelado: pagado,
        pendiente_agricultor: pendiente,
        receivable_id: receivableId,
        payable_id: payableId
      }
    };
  });

  res.json(result);
}));

lotsRouter.get("/", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name,
            t.ticket_number, t.gross_weight, t.tare_weight, t.net_weight, t.qualification, t.quintals
     FROM lots l
     LEFT JOIN farmers f ON f.id = l.farmer_id
     LEFT JOIN weighing_tickets t ON t.lot_id = l.id
     WHERE l.accionista_id = $2 AND ($1::text IS NULL OR l.status = $1::lot_status)
     ORDER BY l.created_at DESC
     LIMIT 500`,
    [req.query.status ?? null, accionistaId]
  );
  res.json(result.rows);
}));

lotsRouter.get("/:id", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const lot = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name
     FROM lots l
     LEFT JOIN farmers f ON f.id = l.farmer_id
     WHERE l.id = $1 AND l.accionista_id = $2`,
    [req.params.id, accionistaId]
  );
  if (!lot.rowCount) throw new ApiError(404, "Lote no encontrado");

  const [tickets, movements, processing, liquidations] = await Promise.all([
    pool.query("SELECT * FROM weighing_tickets WHERE lot_id = $1", [req.params.id]),
    pool.query("SELECT * FROM inventory_movements WHERE lot_id = $1 ORDER BY created_at ASC", [req.params.id]),
    pool.query("SELECT * FROM processing_batches WHERE lot_id = $1 ORDER BY created_at ASC", [req.params.id]),
    pool.query("SELECT * FROM liquidations WHERE lot_id = $1 ORDER BY created_at ASC", [req.params.id])
  ]);

  res.json({
    lot: lot.rows[0],
    tickets: tickets.rows,
    inventory_movements: movements.rows,
    processing_batches: processing.rows,
    liquidations: liquidations.rows
  });
}));
