// 🔢 TOTAL DE UN SECADO: vuelve a sumar los pesos que tiene adentro y arrastra el cambio a su informe y a la cuadrilla que
// aún no se paga. Lo usan «Quitar un peso» y la corrección de la báscula (2026-11-23).
import type { PoolClient } from "pg";
import { upsertCuadrillaSecadoraEntry } from "../routes/modules/cuadrilla.js";

/** `quitado`: ticket que ya salió del secado (se saca de la lista del informe). Lo pagado a la cuadrilla nunca se toca. */
export async function recalcularTotalDeSecado(client: PoolClient, dryingId: string, userId: string | null, quitado: string | null = null) {
  const rep = (await client.query(
    "SELECT d.*, l.accionista_id FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id WHERE d.id = $1 FOR UPDATE OF d", [dryingId]
  )).rows[0];
  const antesQq = Number(rep.total_quintals) || 0;
  const nuevo = (await client.query(
    `UPDATE drying_tunnel_reports d SET input_weight_kg = x.kg, total_quintals = x.qq
       FROM (SELECT sum(net_weight_kg) AS kg, sum(quintals) AS qq FROM drying_tunnel_report_lots WHERE drying_report_id = $1) x
      WHERE d.id = $1 RETURNING d.total_quintals::float AS qq, d.input_weight_kg::float AS kg`, [dryingId]
  )).rows[0] as { qq: number; kg: number };
  if (rep.process_report_id) {
    await client.query(
      `UPDATE lot_process_reports
          SET report_data = report_data || jsonb_build_object('total_quintals', $2::numeric, 'total_weight_kg', $3::numeric,
                'lots', COALESCE((SELECT jsonb_agg(CASE WHEN m.id IS NULL THEN x ELSE x
                                     || CASE WHEN x ? 'quintals' THEN jsonb_build_object('quintals', m.quintals) ELSE '{}'::jsonb END
                                     || CASE WHEN x ? 'net_weight_kg' THEN jsonb_build_object('net_weight_kg', m.net_weight_kg) ELSE '{}'::jsonb END END)
                                    FROM jsonb_array_elements(COALESCE(report_data->'lots', '[]'::jsonb)) x
                                    LEFT JOIN drying_tunnel_report_lots m ON m.drying_report_id = $5 AND m.weighing_ticket_id::text = x->>'weighing_ticket_id'
                                   WHERE $4::text IS NULL OR x->>'weighing_ticket_id' IS DISTINCT FROM $4::text), '[]'::jsonb))
        WHERE id = $1`,
      [rep.process_report_id, nuevo.qq, nuevo.kg, quitado, dryingId]
    );
  }
  // Cuadrilla: lo asignado por QQ cambia en la misma proporción; lo que va por sacos se corrige a mano.
  let sacosAMano = false, yaPagada = false;
  if (!rep.cuadrilla_pagada_fuera && antesQq > 0 && Math.abs(nuevo.qq - antesQq) > 0.0005) {
    const asig = (await client.query(
      "SELECT id, worker_name, activity_id, momento, quintals::float AS quintals FROM drying_tunnel_cuadrilla WHERE drying_report_id = $1", [dryingId]
    )).rows;
    for (const a of asig) {
      const empaque = a.momento === "VACIADO" ? rep.botada_empaque ?? rep.recepcion_empaque : rep.recepcion_empaque;
      if (empaque === "SACOS") { sacosAMano = true; continue; }
      const entrada = (await client.query(
        "SELECT to_char(work_date, 'YYYY-MM-DD') AS dia, paid_at FROM cuadrilla_entries WHERE origen = 'SECADORA' AND referencia_id = $1 AND momento = $2 AND lower(btrim(worker_name)) = lower(btrim($3))",
        [dryingId, a.momento, a.worker_name]
      )).rows[0];
      if (entrada?.paid_at) { yaPagada = true; continue; }
      const qq = Math.round(Number(a.quintals) * (nuevo.qq / antesQq) * 1000) / 1000;
      await client.query("UPDATE drying_tunnel_cuadrilla SET quintals = $2 WHERE id = $1", [a.id, qq]);
      if (entrada) {
        await upsertCuadrillaSecadoraEntry(client, {
          referencia_id: dryingId, tunnel_number: Number(rep.tunnel_number), momento: a.momento, activity_id: a.activity_id,
          worker_name: a.worker_name, quantity: qq, work_date: entrada.dia, created_by: userId, accionista_id: rep.accionista_id
        });
      }
    }
  }
  return { tunel: rep.tunnel_number as number | null, tendal: String(rep.dry_method ?? "").toUpperCase() === "TENDAL", lotId: String(rep.lot_id),
    finalizado: rep.status === "COMPLETED", conCombustible: !!rep.motor_fuel_id, antesQq, nuevo, sacosAMano, yaPagada };
}
