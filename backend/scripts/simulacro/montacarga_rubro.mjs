// 🚜 Montacarga como rubro aparte: mantenimiento con área MONTACARGA, diésel/repuestos que lo nombran y la
// categoría «Montacarga» con sus subcategorías van al rubro Montacarga en Costos operativos. SOLO copia.
import fs from "fs";
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261101_montacarga_subcategorias.sql", import.meta.url), "utf8"));
  const subs = await q("SELECT nombre FROM subcategorias_gastos WHERE categoria = 'GASOLINA_MONTACARGA' ORDER BY nombre");
  check(subs.length >= 7, "A1. la categoría Montacarga tiene sus subcategorías", subs.map((s) => s.nombre));
  const reg = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim montacarga", tipo: "EFECTIVO", opening_balance_cash: 500 }, matriz), "A2. caja de la Matriz");
  const regId = reg.id ?? reg.register?.id;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
  const [y, m] = hoy.split("-").map(Number);
  const rubros0 = exigir(await api("GET", `/resultado-mensual?year=${y}&month=${m}`, undefined, matriz), "A3. costos antes").rubros;
  const gasto = (rs, re) => Number(rs.find((r) => re.test(r.nombre))?.gasto_total ?? 0);

  exigir(await api("POST", "/equipment/maintenance", { area: "MONTACARGA", section: "MOTOR", maintenance_type: "CORRECTIVO", description: "SIM cambio de aceite", amount: 40, cash_register_id: regId }, matriz), "B1. mantenimiento del montacarga (área MONTACARGA) por $40");
  exigir(await api("POST", "/equipment/maintenance", { area: "PILADORA", section: "MOTOR", maintenance_type: "CORRECTIVO", description: "SIM banda", amount: 10, cash_register_id: regId }, matriz), "B2. mantenimiento de la piladora por $10");
  exigir(await api("POST", `/cash/${regId}/movements`, { movement: "EXPENSE", category: "DIESEL", amount: 20, description: "SIM diésel para el montacarga" }, matriz), "B3. diésel del montacarga por $20");
  exigir(await api("POST", `/cash/${regId}/movements`, { movement: "EXPENSE", category: "DIESEL", amount: 15, description: "SIM diésel secadora" }, matriz), "B4. diésel de la secadora por $15");
  exigir(await api("POST", `/cash/${regId}/movements`, { movement: "EXPENSE", category: "GASOLINA_MONTACARGA", subcategoria: "Llantas montacarga", amount: 30, description: "SIM llanta" }, matriz), "B5. categoría Montacarga · Llantas por $30");

  const rubros1 = exigir(await api("GET", `/resultado-mensual?year=${y}&month=${m}`, undefined, matriz), "C1. costos después").rubros;
  check(Math.abs(gasto(rubros1, /montacarga/i) - gasto(rubros0, /montacarga/i) - 90) < 0.01, "C2. el rubro Montacarga sube $90 (mantenimiento 40 + diésel 20 + llanta 30)", { antes: gasto(rubros0, /montacarga/i), ahora: gasto(rubros1, /montacarga/i) });
  check(Math.abs(gasto(rubros1, /mantenimiento/i) - gasto(rubros0, /mantenimiento/i) - 10) < 0.01, "C3. Mantenimiento piladora sube solo $10", { antes: gasto(rubros0, /mantenimiento/i), ahora: gasto(rubros1, /mantenimiento/i) });
  check(Math.abs(gasto(rubros1, /^diesel/i) - gasto(rubros0, /^diesel/i) - 15) < 0.01, "C4. Diesel sube solo $15 (el de la secadora)", { antes: gasto(rubros0, /^diesel/i), ahora: gasto(rubros1, /^diesel/i) });
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
