// Combustible del motor: fórmula de la planta y reparto por tiempo compartido del quemador.
// Sobre una COPIA de la base (servidor real en :4001). Usa los túneles reales del Motor 1 de la copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;

try {
  // Tarifas de la planta: $0.334 por kg, 10 kg por cada 1%, cilindro $2.45.
  const tar = (await api("GET", "/labor/rates")).data;
  const guardar = await api("PUT", "/labor/rates", { ...tar, precio_gas_bombona: 0.334, gas_bombona_kg_por_punto: 10, precio_gas_cilindro: 2.45 });
  check(guardar.ok && guardar.data.gas_bombona_kg_por_punto === 10 && guardar.data.precio_gas_bombona === 0.334, "1. Configuración guarda $0.334/kg y 10 kg por cada 1%", guardar.ok ? { kg: guardar.data.gas_bombona_kg_por_punto, precio: guardar.data.precio_gas_bombona } : mostrar(guardar));

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

  // Reabrir (admin) deshace EXACTAMENTE lo asignado
  const reab = await api("POST", `/process-flow/drying/${t1.id}/reabrir`, { motivo: "prueba de reparto de combustible" });
  check(reab.ok, "11. reabrir el túnel 1 deshace el cierre del combustible", reab.ok ? undefined : mostrar(reab));
  if (reab.ok) {
    const tras = await q("SELECT gas_costo_total::float g, motor_fuel_id FROM drying_tunnel_reports WHERE id = ANY($1::uuid[])", [[t1.id, t2.id]]);
    check(tras.every((x) => r2(x.g) === 0 && x.motor_fuel_id === null), "12. los dos túneles vuelven a $0 de gas, sin centavos sueltos", tras);
    check((await q("SELECT count(*)::int n FROM motor_fuel_partes WHERE motor_fuel_id = $1", [reg.id]))[0].n === 0, "13. y se borra el detalle del reparto");
  }
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
