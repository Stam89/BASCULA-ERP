// Combustible del motor: fórmula de la planta y reparto por tiempo compartido del quemador.
// Sobre una COPIA de la base (servidor real en :4001). Usa los túneles reales del Motor 1 de la copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
// Este simulacro necesita ver SOLO los túneles ya terminados del Motor 1: si hay secados en proceso en la base real (operación del día), se sacan de su alcance SOLO en la copia.
await q("UPDATE drying_tunnel_reports SET motor_number = NULL WHERE status = 'IN_PROGRESS'").catch(() => undefined);
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;

try {
  // Tarifas de la planta: $0.334 por kg, 10 kg por cada 1%, cilindro $2.45.
  const tar = (await api("GET", "/labor/rates")).data;
  const guardar = await api("PUT", "/labor/rates", { ...tar, precio_gas_bombona: 0.334, gas_bombona_kg_por_punto: 10, precio_gas_cilindro: 2.45 });
  check(guardar.ok && guardar.data.gas_bombona_kg_por_punto === 10 && guardar.data.precio_gas_bombona === 0.334, "1. Configuración guarda $0.334/kg y 10 kg por cada 1%", guardar.ok ? { kg: guardar.data.gas_bombona_kg_por_punto, precio: guardar.data.precio_gas_bombona } : mostrar(guardar));

  // En la COPIA se deja el combustible del Motor 1 sin registrar (en la base real el dueño ya lo registró).
  await q("UPDATE drying_tunnel_reports SET motor_fuel_id = NULL, gas_costo_total = 0, diesel_costo = 0 WHERE motor_number = 1");
  await q("DELETE FROM motor_fuel_records WHERE motor_number = 1");
  // La base real ya tiene más secados del Motor 1 (operación diaria): SOLO en la COPIA se dejan las dos últimas corridas
  // (la última de cada túnel); las anteriores se pasan a un motor que no existe (9), para que el escenario sea siempre el mismo.
  await q(`UPDATE drying_tunnel_reports SET motor_number = 9 WHERE motor_number = 1 AND id NOT IN (
             SELECT DISTINCT ON (tunnel_number) id FROM drying_tunnel_reports WHERE motor_number = 1
              ORDER BY tunnel_number, COALESCE(filled_at, created_at) DESC)`);
  // Los dos túneles del Motor 1 (pendientes de combustible): mismo inicio, uno seca 2 h más.
  const tun = await q("SELECT id, tunnel_number, total_quintals::float qq FROM drying_tunnel_reports WHERE motor_number = 1 AND motor_fuel_id IS NULL AND status <> 'CANCELLED' ORDER BY tunnel_number");
  check(tun.length === 2, "2. hay 2 túneles del Motor 1 pendientes de combustible", tun.map((t) => `T${t.tunnel_number}: ${t.qq} QQ`));
  const [t1, t2] = tun;
  await q("UPDATE drying_tunnel_reports SET dry_start_at = '2026-10-05 18:00:00-05', dry_end_at = '2026-10-06 07:20:00-05', drying_hours = 13.33 WHERE id = $1", [t1.id]);
  await q("UPDATE drying_tunnel_reports SET dry_start_at = '2026-10-05 18:00:00-05', dry_end_at = '2026-10-06 09:20:00-05', drying_hours = 15.33 WHERE id = $1", [t2.id]);

  // Bombona 80% → 50% (30% × 10 kg × $0.334 = $100.20) + 2 cilindros × $2.45 = $4.90 → $105.10
  const fuel = await api("POST", "/process-flow/drying/motor-fuel", { motor_number: 1, gas_bombona_inicio: 80, gas_bombona_fin: 50, gas_cilindro_cantidad: 2, finalize: true });
  check(fuel.ok, "3. Registrar el combustible del Motor 1 y finalizar la corrida", fuel.ok ? undefined : mostrar(fuel));
  const reg = fuel.data.registro;
  check(r2(reg.gas_costo) === 105.10, "4. costo del gas = (80−50) × 10 × $0.334 + 2 × $2.45 = $105.10 (antes daba $14.92)", reg.gas_costo);
  const qqTot = t1.qq + t2.qq;
  check(r2(fuel.data.costo_por_qq) === r2(105.10 / qqTot), "5. costo GLOBAL por QQ = $105.10 ÷ QQ de los dos túneles", { global: fuel.data.costo_por_qq, esperado: r2(105.10 / qqTot) });
  check(fuel.data.reparto_metodo === "TIEMPO", "6. se repartió por horas de quemador (los dos túneles tienen horas)", fuel.data.reparto_metodo);
  const p1 = fuel.data.reparto.find((p) => p.drying_report_id === t1.id), p2 = fuel.data.reparto.find((p) => p.drying_report_id === t2.id);
  // Tiempo compartido: 13.33 h juntos (por QQ) + 2 h solo el túnel 2.
  const juntos = 13 + 20 / 60, solo = 2;
  const w1 = juntos * t1.qq / qqTot, w2 = juntos * t2.qq / qqTot + solo;
  const esperado1 = r2(105.10 * w1 / (w1 + w2));
  check(Math.abs(p1.gas - esperado1) <= 0.01 && r2(p1.gas + p2.gas) === 105.10, "7. el túnel que secó 2 h más paga esas horas (reparto exacto, suma $105.10)", { t1: p1.gas, t2: p2.gas, esperado_t1: esperado1, por_qq_seria: r2(105.10 * t1.qq / qqTot) });
  check(p2.costo_por_qq > p1.costo_por_qq, "8. el costo por QQ del túnel 2 es mayor que el del túnel 1", { t1: p1.costo_por_qq, t2: p2.costo_por_qq });
  const enBase = await q("SELECT id, gas_costo_total::float g FROM drying_tunnel_reports WHERE id = ANY($1::uuid[])", [[t1.id, t2.id]]);
  check(r2(enBase.find((x) => x.id === t1.id).g) === p1.gas && r2(enBase.find((x) => x.id === t2.id).g) === p2.gas, "9. cada túnel guarda su costo de gas");
  const partes = await q("SELECT drying_report_id, gas::float g FROM motor_fuel_partes WHERE motor_fuel_id = $1", [reg.id]);
  check(partes.length === 2 && r2(partes.reduce((s, x) => s + x.g, 0)) === 105.10, "10. queda guardado lo que le tocó a cada túnel", partes.length);

  // Reporte de Combustible: valores REALES, sin redondear para presentar
  const hoy = new Date().toISOString().slice(0, 10);
  const rep = await api("GET", `/reports/fuel?from=2026-01-01&to=${hoy}`);
  check(rep.ok, "13b. el reporte de Combustible responde", rep.ok ? undefined : mostrar(rep));
  if (rep.ok) {
    const f1 = rep.data.rows.find((x) => x.tunnel_number === t1.tunnel_number && Number(x.quintals) === t1.qq);
    const esperadoQq = p1.gas / t1.qq;
    check(f1 && Math.abs(f1.costo_por_qq_gas - esperadoQq) < 1e-9 && f1.costo_por_qq_gas !== r2(esperadoQq), "13c. el costo por QQ de gas viene con su valor real (no a 2 decimales)", f1 && { reporte: f1.costo_por_qq_gas, real: esperadoQq });
    check(f1 && Math.abs(f1.horas_secado - 13.3333333) < 0.001, "13d. las horas de secado vienen exactas (13.33… h, no 13.3)", f1?.horas_secado);
    const mt = rep.data.motors.find((x) => x.motor === 1);
    check(mt && mt.gas_bombona_pct === 30 && mt.gas_bombona_kg === 300, "13e. el consumo de la bombona se ve en % y en kg (30 % = 300 kg)", mt && { pct: mt.gas_bombona_pct, kg: mt.gas_bombona_kg });
  }

  // Reabrir (admin) deshace EXACTAMENTE lo asignado
  const reab = await api("POST", `/process-flow/drying/${t1.id}/reabrir`, { motivo: "prueba de reparto de combustible" });
  check(reab.ok, "11. reabrir el túnel 1 deshace el cierre del combustible", reab.ok ? undefined : mostrar(reab));
  if (reab.ok) {
    const tras = await q("SELECT gas_costo_total::float g, motor_fuel_id FROM drying_tunnel_reports WHERE id = ANY($1::uuid[])", [[t1.id, t2.id]]);
    check(tras.every((x) => r2(x.g) === 0 && x.motor_fuel_id === null), "12. los dos túneles vuelven a $0 de gas, sin centavos sueltos", tras);
    check((await q("SELECT count(*)::int n FROM motor_fuel_partes WHERE motor_fuel_id = $1", [reg.id]))[0].n === 0, "13. y se borra el detalle del reparto");
  }
  // ── Tarifas de planta vistas desde un socio (la pantalla de Secadoras las usa) ──
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  await q("UPDATE labor_rates SET precio_gas_cilindro = 2.20, precio_gas_bombona = 0.90, secado_servicio_per_qq = 1.50, pilador_per_qq = 0.20 WHERE socio_id = $1", [stalyn]);
  const deSocio = (await api("GET", "/labor/rates", undefined, stalyn)).data;
  check(deSocio.precio_gas_cilindro === 2.45 && deSocio.precio_gas_bombona === 0.334 && deSocio.gas_bombona_kg_por_punto === 10, "14. estando en STALYN, el combustible sale con los precios de la planta ($2.45 cilindro, $0.334/kg)", { cilindro: deSocio.precio_gas_cilindro, bombona: deSocio.precio_gas_bombona });
  check(deSocio.secado_servicio_per_qq === Number(tar.secado_servicio_per_qq), "15. y el secado como servicio también es el de la planta", { socio: deSocio.secado_servicio_per_qq, planta: tar.secado_servicio_per_qq });
  check(deSocio.pilador_per_qq === 0.2, "16. pero las tarifas propias del socio (pilador) siguen siendo las suyas", deSocio.pilador_per_qq);
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
