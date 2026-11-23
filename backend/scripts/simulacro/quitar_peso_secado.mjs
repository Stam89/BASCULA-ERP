// ➖ Quitar un peso mal puesto de una secadora en proceso (2026-11-23): se recalculan QQ, informe y cuadrilla, y el peso
// queda libre para otra secadora. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
try {
  const rep = (await q(`SELECT d.id, d.total_quintals::float qq, d.process_report_id pr, d.lot_id, l.accionista_id acc FROM drying_tunnel_reports d JOIN lots l ON l.id=d.lot_id
    WHERE d.status='IN_PROGRESS' AND d.motor_fuel_id IS NULL AND COALESCE(d.dry_method,'TUNEL')<>'TENDAL'
      AND (SELECT count(*) FROM drying_tunnel_report_lots x WHERE x.drying_report_id=d.id)>1
      AND NOT EXISTS (SELECT 1 FROM cuadrilla_entries e WHERE e.referencia_id=d.id AND e.paid_at IS NOT NULL) ORDER BY d.created_at DESC LIMIT 1`))[0];
  if (!rep) throw new Error("la copia no tiene un secado en proceso con varios pesos");
  const ts = await q("SELECT weighing_ticket_id id, quintals::float qq FROM drying_tunnel_report_lots WHERE drying_report_id=$1 ORDER BY quintals", [rep.id]);
  const cuad = async () => (await q("SELECT COALESCE(sum(quantity),0)::float n, COALESCE(sum(subtotal),0)::float s FROM cuadrilla_entries WHERE origen='SECADORA' AND referencia_id=$1", [rep.id]))[0];
  const c0 = await cuad(), [t] = ts;
  const quitar = (id) => api("POST", `/process-flow/drying/${rep.id}/quitar-ticket`, { weighing_ticket_id: id }, rep.acc);
  const r = await quitar(t.id);
  check(r.ok, "1. se quita el peso", r.data);
  const d = (await q("SELECT total_quintals::float qq FROM drying_tunnel_reports WHERE id=$1", [rep.id]))[0];
  const queda = ts.slice(1).reduce((s, x) => s + x.qq, 0);
  check(Math.abs(d.qq - queda) < 0.01, "2. el total es la suma de los pesos que quedan", { antes: rep.qq, ahora: d.qq });
  const c1 = await cuad();
  check(Math.abs(c1.n - (c0.n * d.qq) / rep.qq) < 0.02 && (c0.n === 0 || c1.s < c0.s), "3. baja la cuadrilla", { c0, c1 });
  const i = (await q("SELECT (report_data->>'total_quintals')::float qq, jsonb_array_length(report_data->'lots') n FROM lot_process_reports WHERE id=$1", [rep.pr]))[0];
  check(Math.abs(i.qq - d.qq) < 0.01 && i.n === ts.length - 1, "4. informe del túnel", i);
  check((await q("SELECT 1 FROM weighing_tickets WHERE id=$1 AND lot_id IS NULL", [t.id])).length === 1
    && (await q("SELECT 1 FROM inventory_movements WHERE reference_id=$1 AND lot_id IS NOT NULL", [t.id])).length === 0, "5. el ticket y su inventario quedan libres del lote");
  const av = await api("GET", "/process-flow/drying/available-lots", undefined, rep.acc);
  check(av.data.some((x) => x.id === t.id), "6. vuelve a salir disponible para secar");
  const lista = await api("GET", "/process-flow/drying/reports", undefined, rep.acc);
  check(lista.data.find((x) => x.id === rep.id).lots.every((l) => l.weighing_ticket_id), "7. la pantalla recibe el id de cada peso");
  check((await quitar(t.id)).status === 404, "8. no se quita dos veces");
  for (const x of ts.slice(1, -1)) check((await quitar(x.id)).ok, "9. otro peso");
  check((await quitar(ts.at(-1).id)).status === 409, "10. el último no se quita");
  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad", h.map((x) => x.regla));
} catch (e) { console.log("⛔", e.message); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
