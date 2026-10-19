// ⏳ Finalizar el secado SIN combustible (el informe llega después): los túneles quedan libres para otra corrida y
// el combustible se completa luego, repartiéndose SOLO entre los túneles de esa corrida. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
import fs from "fs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261109_combustible_pendiente.sql", import.meta.url), "utf8"));
  const tar = (await api("GET", "/labor/rates")).data;
  await api("PUT", "/labor/rates", { ...tar, precio_gas_bombona: 0.334, gas_bombona_kg_por_punto: 10, precio_gas_cilindro: 2.45 });
  // Escenario fijo SOLO en la copia: lo que estaba en proceso sale del alcance; quedan las 2 últimas partidas del Motor 1
  // (una por túnel) como una corrida EN PROCESO sin combustible, y otra partida vieja se guarda para la corrida nueva.
  await q("UPDATE drying_tunnel_reports SET motor_number = NULL WHERE status = 'IN_PROGRESS'");
  // El combustible ya registrado del Motor 1 en la base real se quita SOLO en la copia (el escenario parte de cero).
  await q("UPDATE drying_tunnel_reports SET motor_fuel_id = NULL, gas_costo_total = 0, diesel_costo = 0 WHERE motor_number = 1");
  await q("DELETE FROM motor_fuel_partes WHERE motor_fuel_id IN (SELECT id FROM motor_fuel_records WHERE motor_number = 1)").catch(() => undefined);
  await q("DELETE FROM motor_fuel_records WHERE motor_number = 1");
  const ult = await q(`SELECT DISTINCT ON (tunnel_number) id, tunnel_number FROM drying_tunnel_reports
                        WHERE motor_number = 1 AND tunnel_number IN (1, 2) ORDER BY tunnel_number, COALESCE(filled_at, created_at) DESC`);
  check(ult.length === 2, "0. hay dos túneles del Motor 1 para la prueba", ult);
  const otra = (await q("SELECT id FROM drying_tunnel_reports WHERE motor_number = 1 AND NOT (id = ANY($1::uuid[])) ORDER BY created_at DESC LIMIT 1", [ult.map((x) => x.id)]))[0];
  await q("UPDATE drying_tunnel_reports SET motor_number = 9 WHERE motor_number = 1 AND NOT (id = ANY($1::uuid[]))", [ult.map((x) => x.id)]);
  await q(`UPDATE drying_tunnel_reports SET status = 'IN_PROGRESS', motor_fuel_id = NULL, gas_costo_total = 0, diesel_costo = 0,
             dry_start_at = '2026-10-18 18:00:00-05', dry_end_at = NULL, drying_hours = NULL WHERE id = ANY($1::uuid[])`, [ult.map((x) => x.id)]);
  const [t1, t2] = ult;

  exigir(await api("POST", "/process-flow/drying/tunnel-finalize", { drying_report_id: t1.id, dry_start_at: "2026-10-18T18:00:00-05:00", dry_end_at: "2026-10-19T07:00:00-05:00" }), "1. finalizar el túnel 1 (no es el último)");
  const f2 = exigir(await api("POST", "/process-flow/drying/tunnel-finalize", { drying_report_id: t2.id, dry_start_at: "2026-10-18T18:00:00-05:00", dry_end_at: "2026-10-19T08:00:00-05:00" }), "2. el túnel 2 es el último");
  check(f2.requires_fuel === true, "3. pide el combustible (como siempre)", f2.requires_fuel);

  const sc = exigir(await api("POST", "/process-flow/drying/motor/1/finalizar-sin-combustible", {}), "4. ⏳ finalizar SIN combustible");
  check(sc.finalized === 2 && JSON.stringify(sc.tuneles) === "[1,2]", "5. cierra la corrida completa (túneles 1 y 2)", sc);
  const est = await q("SELECT status, motor_fuel_id FROM drying_tunnel_reports WHERE id = ANY($1::uuid[])", [[t1.id, t2.id]]);
  check(est.every((x) => x.status === "COMPLETED" && x.motor_fuel_id === sc.motor_fuel_id), "6. ambos quedan FINALIZADOS y ligados al registro pendiente", est);
  const act = exigir(await api("GET", "/process-flow/drying/motor/1/active"), "7. motor activo");
  check(act.length === 0, "8. el Motor 1 queda libre (sin corrida activa)", act.length);
  const pend = exigir(await api("GET", "/process-flow/drying/combustible-pendiente"), "9. lista de combustible pendiente");
  const p = pend.find((x) => x.id === sc.motor_fuel_id);
  check(p && p.motor_number === 1 && p.tuneles.length === 2, "10. aparece como pendiente del Motor 1", p);

  // Corrida NUEVA en el mismo motor antes de que llegue el informe
  await q(`UPDATE drying_tunnel_reports SET motor_number = 1, tunnel_number = 1, status = 'IN_PROGRESS', motor_fuel_id = NULL,
             gas_costo_total = 0, diesel_costo = 0, dry_start_at = '2026-10-19 10:00:00-05', dry_end_at = NULL WHERE id = $1`, [otra.id]);
  const act2 = exigir(await api("GET", "/process-flow/drying/motor/1/active"), "11. motor activo con la corrida nueva");
  check(act2.length === 1 && act2[0].id === otra.id, "12. la corrida nueva no se mezcla con la anterior", act2.map((x) => x.id));

  // Llega el informe: bombona 80 → 50 (30 % × 10 kg × $0.334 = $100.20)
  const comp = exigir(await api("POST", `/process-flow/drying/motor-fuel/${sc.motor_fuel_id}/completar`, { gas_bombona_inicio: 80, gas_bombona_fin: 50 }), "13. completar el combustible pendiente");
  check(r2(comp.registro.gas_costo) === 100.2 && comp.registro.pendiente === false, "14. costo $100.20 y deja de estar pendiente", { gas: comp.registro.gas_costo, pend: comp.registro.pendiente });
  check(comp.reparto.length === 2 && comp.reparto.every((x) => [t1.id, t2.id].includes(x.drying_report_id)), "15. se reparte SOLO entre los túneles de esa corrida", comp.reparto.map((x) => x.tunel));
  const g = await q("SELECT id, gas_costo_total::float g, motor_fuel_id FROM drying_tunnel_reports WHERE id = ANY($1::uuid[])", [[t1.id, t2.id, otra.id]]);
  check(r2(g.filter((x) => x.id !== otra.id).reduce((s, x) => s + x.g, 0)) === 100.2, "16. los dos túneles suman $100.20", g);
  check(g.find((x) => x.id === otra.id).g === 0 && g.find((x) => x.id === otra.id).motor_fuel_id === null, "17. la corrida nueva sigue sin combustible (no le tocó nada)");
  check(!(exigir(await api("GET", "/process-flow/drying/combustible-pendiente"), "18. lista").some((x) => x.id === sc.motor_fuel_id)), "19. ya no aparece como pendiente");
  const otraVez = await api("POST", `/process-flow/drying/motor-fuel/${sc.motor_fuel_id}/completar`, { gas_bombona_inicio: 80, gas_bombona_fin: 50 });
  check(otraVez.status === 409, "20. no se puede registrar dos veces", otraVez.status);
  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
