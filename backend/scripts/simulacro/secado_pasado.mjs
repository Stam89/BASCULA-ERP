// 🕒 Secado ya hecho (pedido del dueño 2026-11-05): solo administrador, con el túnel ocupado por otro secado. Conserva sus
// fechas, genera cuadrilla y secador, y su combustible se omite, aparte de la corrida en marcha. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${JSON.stringify(r.data).slice(0, 300)}`;
try {
  const t3 = (await q("SELECT id, status, dry_start_at FROM drying_tunnel_reports WHERE tunnel_number = 3 AND status = 'IN_PROGRESS' LIMIT 1"))[0];
  check(!!t3, "0. túnel 3 ocupado en la copia");
  const tks = await q("SELECT id FROM mobile_synced_tickets WHERE raw_payload->>'numeroTicket' IN ('000 499','000 502')");
  const ids = [];
  for (const t of tks) {
    const ya = (await q("SELECT weighing_ticket_id id FROM mobile_synced_tickets WHERE id = $1", [t.id]))[0].id;
    const r = ya ? { ok: true } : await api("POST", `/tickets/${t.id}/create-lot`, { operation_type: "SECADO_PILADO" });
    check(r.ok, "1. ingresar ticket como servicio", r.ok ? undefined : mostrar(r));
    ids.push((await q("SELECT weighing_ticket_id id FROM mobile_synced_tickets WHERE id = $1", [t.id]))[0].id);
  }
  const cuerpo = { entry_ids: ids, tunnel_number: 3, filled_at: "2026-11-04", dry_start_at: "2026-11-04T22:00:00.000Z", dry_end_at: "2026-11-05T10:00:00.000Z", operator_name: "MARGARO" };
  const jornal = async () => Number((await q("SELECT COALESCE(sum(net_amount),0)::float s FROM worker_payments WHERE worker_role = 'SECADOR' AND work_date = '2026-11-04'"))[0].s);
  const antes = await jornal();
  const cruza = await api("POST", "/process-flow/drying/secado-pasado", { ...cuerpo, dry_end_at: "2026-11-05T20:00:00.000Z" });
  check(cruza.status === 409, "2. rechaza horas cruzadas con el secado del túnel", mostrar(cruza));
  const r = await api("POST", "/process-flow/drying/secado-pasado", cuerpo);
  check(r.ok, "3. registra con el túnel ocupado", r.ok ? undefined : mostrar(r));
  const d = (await q("SELECT id, status, filled_at::text f, motor_fuel_id, total_quintals::float qq FROM drying_tunnel_reports WHERE id = $1", [r.data.id]))[0];
  check(d.status === "COMPLETED" && d.f.startsWith("2026-11-04"), "4. finalizado con su fecha, no la de la corrida", d);
  check(Math.abs(d.qq - 143.3) < 0.01, "5. 143.30 QQ", d.qq);
  const c = await q("SELECT momento, subtotal::float s, work_date::text w FROM cuadrilla_entries WHERE referencia_id = $1 ORDER BY 1", [d.id]);
  check(c.length === 2 && c.every((x) => Math.abs(x.s - 14.33) < 0.01), "6. cuadrilla llenado y botada", c);
  const despues = await jornal();
  check(Math.abs(despues - antes - 5) < 0.01, "7. el secador sube $5 ese día", { antes, despues });
  const f = (await q("SELECT pendiente, total_quintals::float qq FROM motor_fuel_records WHERE id = $1", [d.motor_fuel_id]))[0];
  check(!f.pendiente && Math.abs(f.qq - 143.3) < 0.01, "8. combustible omitido y aparte", f);
  const pend = await api("GET", "/process-flow/drying/combustible-pendiente");
  check(!pend.data.some((x) => x.id === d.motor_fuel_id), "8b. no aparece como pendiente");
  if (pend.data[0]) {
    const o = await api("POST", `/process-flow/drying/motor-fuel/${pend.data[0].id}/omitir`, {});
    check(o.ok, "8c. omitir una corrida pendiente", mostrar(o));
    const p2 = await api("GET", "/process-flow/drying/combustible-pendiente");
    check(!p2.data.some((x) => x.id === pend.data[0].id), "8d. ya no sale");
    const o2 = await api("POST", `/process-flow/drying/motor-fuel/${pend.data[0].id}/omitir`, {});
    check(o2.status === 409, "8e. no se omite dos veces", o2.status);
  }
  const act = await api("GET", "/process-flow/drying/motor/2/active");
  check(act.data.length === 1 && act.data[0].id === t3.id, "9. la corrida en marcha queda sola", act.data.length);
  const t3b = (await q("SELECT status, dry_start_at FROM drying_tunnel_reports WHERE id = $1", [t3.id]))[0];
  check(t3b.status === "IN_PROGRESS" && +t3b.dry_start_at === +t3.dry_start_at, "10. el secado en curso no cambió");
  const reps = await api("GET", "/process-flow/drying/reports");
  check(reps.data.some((x) => x.id === d.id), "11. sale en los secados de Producción");
  const re = await api("POST", `/process-flow/drying/${d.id}/reabrir`, { motivo: "prueba de simulacro" });
  check(re.ok, "12. reabrir deshace el omitido", re.ok ? undefined : mostrar(re));
} catch (e) { check(false, "detenido", String(e)); }
const fallas = resumen();
await S.cerrar?.();
process.exit(fallas ? 1 : 0);
