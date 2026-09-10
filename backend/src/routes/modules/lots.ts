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
    // Un lote agrupa varios pesos de materia prima. El join los multiplicaba:
    // el mismo lote salia repetido, una vez por peso. Aqui va sumado, una fila
    // por lote. El detalle peso por peso se ve en la liquidacion y en /lots/:id.
    `SELECT l.*, f.full_name AS farmer_name,
            COUNT(t.id)::int AS entries_count,
            COALESCE(SUM(t.net_weight), 0) AS net_weight,
            COALESCE(SUM(t.quintals), 0) AS quintals
     FROM lots l
     LEFT JOIN farmers f ON f.id = l.farmer_id
     LEFT JOIN weighing_tickets t ON t.lot_id = l.id
     WHERE l.accionista_id = $2 AND ($1::text IS NULL OR l.status = $1::lot_status)
     GROUP BY l.id, f.full_name
     ORDER BY l.created_at DESC
     LIMIT 500`,
    [req.query.status ?? null, accionistaId]
  );
  res.json(result.rows);
}));

// Lotes de ARROZ SECO EN BODEGA disponibles para pilar directo (dropdown
// "Lote de arroz seco (bodega)" de Producción). Filtro ESTRICTO: NO basta con que
// el secado esté COMPLETED — eso solo dice que el arroz terminó de secar DENTRO
// del túnel. Para estar EN BODEGA el lote tuvo que ser BOTADO/VACIADO del túnel,
// que es el paso físico de sacarlo y guardarlo. El vaciado se registra como la
// labor de cuadrilla "BOTADA DE TUNEL" (drying_tunnel_cuadrilla.momento='VACIADO')
// y es la marca inequívoca de "enviado a bodega" (equivale a ubicacion=BODEGA_SECO).
//
// Un lote pasa el filtro solo cuando TODO se cumple:
//   • Tiene un secado COMPLETED, no apartado como arianos, Y con VACIADO
//     registrado (botado a bodega). Un secado recién finalizado sin botar NO
//     entra aquí: se pila por "Desde Secadoras" (arroz aún en el túnel).
//   • Ningún túnel suyo sigue 'IN_PROGRESS' (excluye lo que aún se está secando).
//   • Aún no entró a producción: lot.status = 'WEIGHED' y sin processing_batch
//     vivo (excluye lo ya pilado/liquidado).
// Los lotes solo pesados/recepcionados en báscula (sin secar ni botar) nunca
// tienen ese VACIADO, así que quedan fuera por definición.
lotsRouter.get("/dry-in-storage", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name,
            COUNT(t.id)::int AS entries_count,
            COALESCE(SUM(t.net_weight), 0) AS net_weight,
            COALESCE(SUM(t.quintals), 0) AS quintals
     FROM lots l
     LEFT JOIN farmers f ON f.id = l.farmer_id
     LEFT JOIN weighing_tickets t ON t.lot_id = l.id
     WHERE l.accionista_id = $1
       AND l.status = 'WEIGHED'
       AND EXISTS (
         SELECT 1
         FROM drying_tunnel_reports d
         JOIN drying_tunnel_cuadrilla c
           ON c.drying_report_id = d.id AND c.momento = 'VACIADO'
         WHERE d.lot_id = l.id
           AND d.status = 'COMPLETED'
           AND d.apartado_arianos = false
       )
       AND NOT EXISTS (
         SELECT 1 FROM drying_tunnel_reports d
         WHERE d.lot_id = l.id AND d.status = 'IN_PROGRESS'
       )
       AND NOT EXISTS (
         SELECT 1 FROM processing_batches b
         WHERE b.lot_id = l.id AND b.status <> 'CANCELLED'
       )
     GROUP BY l.id, f.full_name
     HAVING COALESCE(SUM(t.quintals), 0) > 0
     ORDER BY l.created_at DESC
     LIMIT 500`,
    [accionistaId]
  );
  res.json(result.rows);
}));

// Lotes de SERVICIO (maquila) ya secados y disponibles para cobrar SOLO el
// secado: mismo criterio que dry-in-storage (secado COMPLETED + VACIADO, sin
// pilar) pero acotado a is_maquila = true y excluyendo los que ya tienen un
// cobro de secado registrado (reference_type='secado_service'). Alimenta el
// formulario "Solo Servicio de Secado".
lotsRouter.get("/service-dried-lots", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT l.id AS lot_id, l.lot_code, l.farmer_id, f.full_name AS farmer_name,
            -- Peso EXACTO del kárdex de secado (total_quintals del informe VACIADO);
            -- fallback al peso de báscula solo si faltara en informes viejos.
            COALESCE(dr.total_quintals, SUM(t.quintals), 0)::float AS quintals,
            dr.dry_method
     FROM lots l
     LEFT JOIN farmers f ON f.id = l.farmer_id
     LEFT JOIN weighing_tickets t ON t.lot_id = l.id
     -- Informe de secado COMPLETED + VACIADO más reciente del lote (túnel o tendal).
     LEFT JOIN LATERAL (
       SELECT d.total_quintals, d.dry_method
       FROM drying_tunnel_reports d
       WHERE d.lot_id = l.id
         AND d.status = 'COMPLETED'
         AND d.apartado_arianos = false
         AND EXISTS (
           SELECT 1 FROM drying_tunnel_cuadrilla c
           WHERE c.drying_report_id = d.id AND c.momento = 'VACIADO'
         )
       ORDER BY d.created_at DESC
       LIMIT 1
     ) dr ON true
     WHERE l.accionista_id = $1
       AND l.is_maquila = true
       AND l.status = 'WEIGHED'
       AND dr.dry_method IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM drying_tunnel_reports d
         WHERE d.lot_id = l.id AND d.status = 'IN_PROGRESS'
       )
       AND NOT EXISTS (
         SELECT 1 FROM processing_batches b
         WHERE b.lot_id = l.id AND b.status <> 'CANCELLED'
       )
       AND NOT EXISTS (
         SELECT 1 FROM accounts_receivable ar
         WHERE ar.reference_type = 'secado_service' AND ar.reference_id = l.id
       )
     GROUP BY l.id, f.full_name, dr.total_quintals, dr.dry_method
     HAVING COALESCE(dr.total_quintals, SUM(t.quintals), 0) > 0
     ORDER BY l.created_at DESC
     LIMIT 500`,
    [accionistaId]
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
