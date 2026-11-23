// ⚖️ La báscula corrige un peso que ya está en una secadora (2026-11-23): el total del secado, su informe y la cuadrilla por
// pagar siguen solos; la cuadrilla ya pagada no se toca y se avisa. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, matriz } = S;
try {
  const c = (await q(`SELECT d.id, d.total_quintals::float qq, d.process_report_id pr, mt.id mt, mt.weighing_ticket_id wt
    FROM drying_tunnel_reports d JOIN drying_tunnel_report_lots x ON x.drying_report_id=d.id JOIN mobile_synced_tickets mt ON mt.weighing_ticket_id=x.weighing_ticket_id
    WHERE d.status='IN_PROGRESS' AND COALESCE(d.dry_method,'TUNEL')<>'TENDAL' AND d.motor_fuel_id IS NULL AND mt.raw_payload ? 'numeroTicket'
      AND d.recepcion_empaque IS DISTINCT FROM 'SACOS' AND NOT EXISTS (SELECT 1 FROM liquidations l WHERE l.status<>'CANCELLED' AND (l.weighing_ticket_id=mt.weighing_ticket_id OR l.lot_id=d.lot_id))
      AND EXISTS (SELECT 1 FROM cuadrilla_entries e WHERE e.origen='SECADORA' AND e.referencia_id=d.id AND e.paid_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM cuadrilla_entries e WHERE e.origen='SECADORA' AND e.referencia_id=d.id AND e.paid_at IS NOT NULL) LIMIT 1`))[0];
  if (!c) throw new Error("la copia no tiene un secado en proceso con cuadrilla por pagar");
  const est = async () => ({
    ...(await q("SELECT total_quintals::float qq, input_weight_kg::float kg FROM drying_tunnel_reports WHERE id=$1", [c.id]))[0],
    ...(await q("SELECT sum(quintals)::float suma, sum(net_weight_kg)::float skg FROM drying_tunnel_report_lots WHERE drying_report_id=$1", [c.id]))[0],
    ...(await q("SELECT sum(quantity)::float cn, sum(subtotal)::float cs, max(work_date::text) dia FROM cuadrilla_entries WHERE origen='SECADORA' AND referencia_id=$1", [c.id]))[0],
    ...(await q("SELECT (report_data->>'total_quintals')::float iqq, jsonb_array_length(report_data->'lots') n FROM lot_process_reports WHERE id=$1", [c.pr]))[0] });
  const cambiar = async (kg) => {
    await q(`UPDATE mobile_synced_tickets SET raw_payload = raw_payload || jsonb_build_object('cambioPosterior', jsonb_build_object('pesoBruto', gross_weight + $2::numeric, 'pesoTara', tare_weight, 'calificacion', qualification, 'en', now())) WHERE id=$1`, [c.mt, kg]);
    return api("POST", `/tickets/${c.mt}/aplicar-cambio`, {}, matriz);
  };
  const e0 = await est(), r = await cambiar(500), e1 = await est();
  check(r.ok && r.data.avisos.length === 0, "1. se aplica sin avisos", r.data);
  check(Math.abs(e1.qq - e0.qq - r.data.qq_delta) < 0.01 && Math.abs(e1.qq - e1.suma) < 0.005 && Math.abs(e1.kg - e1.skg) < 0.01 && e1.qq > e0.qq, "2. el total del secado sube solo", { e0, e1 });
  check(Math.abs(e1.cn - (e0.cn * e1.qq) / e0.qq) < 0.02 && e1.cs > e0.cs && e1.dia === e0.dia, "3. sube la cuadrilla, con su misma fecha");
  check(Math.abs(e1.iqq - e1.qq) < 0.005 && e1.n === e0.n, "4. informe del túnel");
  await q("UPDATE cuadrilla_entries SET paid_at=now() WHERE origen='SECADORA' AND referencia_id=$1", [c.id]);
  const r2 = await cambiar(-300), e2 = await est();
  check(r2.ok && e2.cs === e1.cs && Math.abs(e2.qq - e2.suma) < 0.005 && e2.qq < e1.qq, "5. cuadrilla pagada: no se toca; el secado sí", { r: r2.data, e2 });
  check(r2.data?.avisos?.some((a) => /ya se pagó/.test(a)), "6. y lo avisa", r2.data?.avisos);
  await q("UPDATE cuadrilla_entries SET paid_at=NULL WHERE origen='SECADORA' AND referencia_id=$1", [c.id]);
  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad", h.map((x) => x.regla));
} catch (e) { console.log("⛔", e.message); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
