// ⚖️ TICKETS QUE LA BÁSCULA CAMBIÓ DESPUÉS DE INGRESARLOS (raw_payload.cambioPosterior, lo marca la sincronización).
// El dueño decide:
//  · «Aplicar el peso nuevo»: corrige el ingreso (weighing_tickets), el ticket, el lote/secado/pilado y la cáscara
//    (entra y sale lo mismo de más: el stock no cambia si ya se piló) y recalcula la liquidación y la Por Pagar al
//    agricultor. Solo si esa liquidación NO tiene pagos.
//  · «Mantener el ingresado»: descarta el cambio (queda en cambioDescartado y la sincronización no lo vuelve a marcar).
import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { calculateNetWeight, calculateQuintals, round2 } from "../utils/rice-formulas.js";

type Db = Pick<PoolClient, "query">;

export async function listarCambiosBascula(db: Db) {
  return (await db.query(
    `SELECT mt.id, mt.raw_payload->>'numeroTicket' AS numero, mt.farmer_name AS agricultor,
            mt.gross_weight::float AS bruto, mt.tare_weight::float AS tara, mt.net_weight::float AS neto,
            mt.qualification::float AS calificacion, mt.quintals::float AS qq,
            mt.raw_payload->'cambioPosterior' AS cambio,
            (SELECT a.name FROM accionistas a JOIN weighing_tickets w ON w.accionista_id = a.id WHERE w.id = mt.weighing_ticket_id) AS accionista,
            (SELECT l.liquidation_number FROM liquidations l WHERE l.weighing_ticket_id = mt.weighing_ticket_id AND l.status <> 'CANCELLED' LIMIT 1) AS liquidacion
       FROM mobile_synced_tickets mt
      WHERE mt.raw_payload ? 'cambioPosterior' AND (mt.weighing_ticket_id IS NOT NULL OR mt.liquidated_at IS NOT NULL)
      ORDER BY (mt.raw_payload->'cambioPosterior'->>'en') DESC LIMIT 30`
  )).rows.map((r) => {
    const c = r.cambio ?? {};
    const neto = calculateNetWeight(Number(c.pesoBruto), Number(c.pesoTara));
    return { ...r, nuevo: { bruto: Number(c.pesoBruto), tara: Number(c.pesoTara), calificacion: Number(c.calificacion ?? r.calificacion), neto, qq: round2(calculateQuintals(neto, Number(c.calificacion ?? r.calificacion))), en: c.en } };
  });
}

export async function descartarCambioBascula(client: PoolClient, mobileId: string, userName: string | null): Promise<void> {
  const r = await client.query(
    `UPDATE mobile_synced_tickets
        SET raw_payload = (raw_payload - 'cambioPosterior')
              || jsonb_build_object('cambioDescartado', (raw_payload->'cambioPosterior') || jsonb_build_object('descartadoEn', now(), 'por', $2::text))
      WHERE id = $1 AND raw_payload ? 'cambioPosterior'`,
    [mobileId, userName ?? "admin"]
  );
  if (!r.rowCount) throw new ApiError(404, "Ese ticket ya no tiene un cambio pendiente.");
}

export async function aplicarCambioBascula(client: PoolClient, mobileId: string, userName: string | null) {
  const mt = (await client.query("SELECT * FROM mobile_synced_tickets WHERE id = $1 FOR UPDATE", [mobileId])).rows[0];
  if (!mt) throw new ApiError(404, "Ticket no encontrado.");
  const c = mt.raw_payload?.cambioPosterior;
  if (!c) throw new ApiError(409, "Ese ticket ya no tiene un cambio pendiente.");
  if (!mt.weighing_ticket_id) throw new ApiError(409, "Este ticket se liquidó sin ingreso de materia prima: corrígelo desde Liquidaciones.");
  const wt = (await client.query("SELECT * FROM weighing_tickets WHERE id = $1 FOR UPDATE", [mt.weighing_ticket_id])).rows[0];
  if (!wt) throw new ApiError(404, "No se encontró el ingreso de materia prima de este ticket.");

  const bruto = Number(c.pesoBruto), tara = Number(c.pesoTara), cal = Number(c.calificacion ?? wt.qualification);
  if (!(bruto > 0) || !(tara >= 0) || !(cal > 0)) throw new ApiError(400, "El cambio de la báscula no trae pesos válidos.");
  const neto = calculateNetWeight(bruto, tara);
  const qq = round2(calculateQuintals(neto, cal));
  const qqAntes = round2(Number(wt.quintals));
  const kgDelta = round2(neto - Number(wt.net_weight));
  const qqDelta = round2(qq - qqAntes);
  const avisos: string[] = [];

  // 1) Liquidación de ese ingreso: se recalcula si NO tiene pagos.
  let liquidacion: { numero: string; neto_antes: number; neto: number } | null = null;
  const liq = (await client.query(
    "SELECT * FROM liquidations WHERE weighing_ticket_id = $1 AND status <> 'CANCELLED' FOR UPDATE", [wt.id]
  )).rows[0];
  const liqDeLote = !liq && wt.lot_id ? (await client.query(
    "SELECT liquidation_number FROM liquidations WHERE lot_id = $1 AND weighing_ticket_id IS NULL AND status <> 'CANCELLED' LIMIT 1", [wt.lot_id]
  )).rows[0] : null;
  if (liqDeLote) throw new ApiError(409, `El lote se liquidó completo (${liqDeLote.liquidation_number}): corrige desde Liquidaciones.`);
  if (liq) {
    const ap = (await client.query(
      "SELECT id, amount::float AS amount, balance::float AS balance FROM accounts_payable WHERE liquidation_id = $1 AND reference_type IS NULL FOR UPDATE", [liq.id]
    )).rows[0];
    const pagos = ap ? Number((await client.query(
      `SELECT count(*)::int n FROM cash_movements
        WHERE reversed_at IS NULL AND reversal_of IS NULL
          AND ((reference_type = 'accounts_payable' AND reference_id = $1)
               OR id IN (SELECT cash_movement_id FROM cash_movement_cuentas WHERE cuenta_id = $1))`, [ap.id]
    )).rows[0].n) : 0;
    if (ap && (pagos > 0 || ap.balance < ap.amount - 0.005)) {
      throw new ApiError(409, `La liquidación ${liq.liquidation_number} ya tiene pagos al agricultor: anula el pago primero y vuelve a intentar.`);
    }
    const bruto$ = round2(qq * Number(liq.price_per_quintal));
    const neto$ = Math.max(0, round2(bruto$ - Number(liq.advances_discount) - Number(liq.other_discounts)));
    await client.query("UPDATE liquidations SET quintals = $2, gross_amount = $3, net_amount = $4 WHERE id = $1", [liq.id, qq, bruto$, neto$]);
    if (ap) {
      await client.query("UPDATE accounts_payable SET amount = $2, balance = $2, status = $3 WHERE id = $1", [ap.id, neto$, neto$ < 0.01 ? "PAID" : "CONFIRMED"]);
    }
    liquidacion = { numero: liq.liquidation_number, neto_antes: Number(liq.net_amount), neto: neto$ };
    const bd = liq.discount_breakdown ?? {};
    if (Number(bd.flete ?? 0) > 0 || Number(bd.cosechadora ?? 0) > 0) {
      avisos.push("La liquidación tiene descuento de flete o cosecha: si se cobran por QQ, revísalos (no se cambiaron).");
    }
  }

  // 2) Cáscara: el ingreso (IN) y, si ya se piló, su salida al pilado (PROCESS_INPUT) por lo mismo → el stock final
  //    queda igual; si aún está en bodega, el stock sube/baja la diferencia (lo que de verdad entró).
  await client.query(
    "UPDATE inventory_movements SET quantity = $2 WHERE reference_type = 'weighing_tickets' AND reference_id = $1 AND movement = 'IN'",
    [wt.id, qq]
  );
  const pilados = (await client.query("SELECT processing_batch_id, id FROM processing_batch_drying_lots WHERE weighing_ticket_id = $1", [wt.id])).rows;
  for (const p of pilados) {
    const salida = (await client.query(
      `SELECT id FROM inventory_movements
        WHERE reference_type = 'processing_batches' AND reference_id = $1 AND movement = 'PROCESS_INPUT' AND lot_id = $2
          AND abs(quantity + $3) < 0.006
        ORDER BY created_at LIMIT 1 FOR UPDATE`,
      [p.processing_batch_id, wt.lot_id, qqAntes]
    )).rows[0];
    if (salida) await client.query("UPDATE inventory_movements SET quantity = $2 WHERE id = $1", [salida.id, -qq]);
    else avisos.push("No se encontró la salida de esta cáscara al pilado: revisa el inventario de cáscara.");
    await client.query("UPDATE processing_batches SET input_quantity = input_quantity + $2 WHERE id = $1", [p.processing_batch_id, kgDelta]);
    await client.query("UPDATE processing_batch_drying_lots SET net_weight_kg = $2, quintals = $3 WHERE id = $1", [p.id, neto, qq]);
  }
  await client.query("UPDATE drying_tunnel_report_lots SET net_weight_kg = $2, quintals = $3 WHERE weighing_ticket_id = $1", [wt.id, neto, qq]);

  // 3) El ingreso y el ticket con los pesos nuevos (la sincronización ya no lo marca: coinciden con la báscula).
  await client.query(
    // net_weight es columna GENERADA (bruto − tara): no se escribe.
    "UPDATE weighing_tickets SET gross_weight = $2, tare_weight = $3, qualification = $4, quintals = $5 WHERE id = $1",
    [wt.id, bruto, tara, cal, qq]
  );
  const antes = { pesoBruto: Number(mt.gross_weight), pesoTara: Number(mt.tare_weight), calificacion: Number(mt.qualification), totalQQ: qqAntes };
  await client.query(
    `UPDATE mobile_synced_tickets
        SET gross_weight = $2, tare_weight = $3, net_weight = $4, qualification = $5, quintals = $6,
            raw_payload = (raw_payload - 'cambioPosterior')
              || jsonb_build_object('pesoBruto', $2::numeric, 'pesoTara', $3::numeric, 'pesoNeto', $4::numeric, 'calificacion', $5::numeric, 'totalQQ', $6::numeric)
              || jsonb_build_object('cambioAplicado', jsonb_build_object('en', now(), 'por', $7::text, 'antes', $8::jsonb))
      WHERE id = $1`,
    [mt.id, bruto, tara, neto, cal, qq, userName ?? "admin", JSON.stringify(antes)]
  );
  return { numero: mt.raw_payload?.numeroTicket ?? null, qq_antes: qqAntes, qq, qq_delta: qqDelta, neto_kg: neto, liquidacion, pilados: pilados.length, avisos };
}
