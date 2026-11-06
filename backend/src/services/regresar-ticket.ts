import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";

// ↩️ Regresar un ticket a Báscula (pedido del dueño 2026-11-06): un ticket ingresado por error vuelve a pendiente.
// Se borra el ingreso y su cáscara sale del inventario con una reversa que queda en el kárdex. Si ya entró a un lote, a una
// secadora o a una liquidación, se frena: deshacerlo aquí descuadraría ese proceso.
export async function regresarTicketABascula(client: PoolClient, opts: { ticketId: string; motivo: string; userId: string | null }) {
  const t = (await client.query(
    `SELECT weighing_ticket_id, liquidated_at, raw_payload->>'numeroTicket' AS numero
       FROM mobile_synced_tickets WHERE id = $1 FOR UPDATE`,
    [opts.ticketId]
  )).rows[0];
  if (!t) throw new ApiError(404, "Ticket no encontrado");
  if (t.liquidated_at) throw new ApiError(409, "Ese ticket ya está liquidado: primero anula la liquidación.");
  if (!t.weighing_ticket_id) throw new ApiError(409, "Ese ticket no está ingresado.");
  const ingresoId = String(t.weighing_ticket_id);

  const w = (await client.query("SELECT lot_id FROM weighing_tickets WHERE id = $1 FOR UPDATE", [ingresoId])).rows[0];
  if (!w) throw new ApiError(404, "No se encontró el ingreso de este ticket.");
  if (w.lot_id) {
    const lote = (await client.query("SELECT lot_code FROM lots WHERE id = $1", [w.lot_id])).rows[0];
    throw new ApiError(409, `Ese ticket ya entró al lote ${lote?.lot_code ?? ""}: no se puede regresar a Báscula.`);
  }
  const enProceso = await client.query(
    `SELECT 1 FROM drying_tunnel_report_lots WHERE weighing_ticket_id = $1
     UNION ALL SELECT 1 FROM processing_batch_drying_lots WHERE weighing_ticket_id = $1 LIMIT 1`,
    [ingresoId]
  );
  if (enProceso.rowCount) throw new ApiError(409, "Ese ticket ya entró a una secadora o a una pilada: no se puede regresar a Báscula.");
  const liquidacion = (await client.query(
    "SELECT liquidation_number FROM liquidations WHERE weighing_ticket_id = $1 AND status <> 'CANCELLED' LIMIT 1", [ingresoId]
  )).rows[0];
  if (liquidacion) throw new ApiError(409, `Ese ticket ya tiene la liquidación ${liquidacion.liquidation_number}: primero anúlala.`);

  // Flete interno que nació con el ingreso: se borra, salvo que ya se haya cobrado o pagado al operador.
  const parte = (await client.query(
    "SELECT id, estado, operador_pagado_at FROM campo_partes WHERE origen_uid = $1 FOR UPDATE", [`weighing_ticket:${ingresoId}`]
  )).rows[0];
  if (parte && (parte.estado !== "por_cobrar" || parte.operador_pagado_at)) {
    throw new ApiError(409, "El flete de este ticket ya se cobró o ya se le pagó al operador en Transporte: primero anula eso.");
  }

  const nota = `Ticket #${t.numero ?? ""} regresado a Báscula: ${opts.motivo}`.slice(0, 480);
  const entradas = (await client.query(
    `SELECT product_id, warehouse_id, lot_id, quantity, ownership, accionista_id FROM inventory_movements
      WHERE reference_type = 'weighing_tickets' AND reference_id = $1`,
    [ingresoId]
  )).rows;
  for (const m of entradas) {
    await client.query(
      `INSERT INTO inventory_movements
         (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by, accionista_id)
       VALUES ($1, $2, $3, 'REVERSAL', $4, 'ticket_regresado', $5, $6, $7, $8, $9)`,
      [m.product_id, m.warehouse_id, m.lot_id, -Number(m.quantity), opts.ticketId, m.ownership, nota, opts.userId, m.accionista_id]
    );
  }
  if (parte) await client.query("DELETE FROM campo_partes WHERE id = $1", [parte.id]);
  // Una liquidación ya anulada no impide borrar el ingreso: queda en su historial sin el enlace.
  await client.query("UPDATE liquidations SET weighing_ticket_id = NULL WHERE weighing_ticket_id = $1", [ingresoId]);
  await client.query("UPDATE mobile_synced_tickets SET weighing_ticket_id = NULL WHERE id = $1", [opts.ticketId]);
  await client.query("DELETE FROM weighing_tickets WHERE id = $1", [ingresoId]);
  return { ok: true, numero: t.numero as string | null, flete_borrado: Boolean(parte) };
}
