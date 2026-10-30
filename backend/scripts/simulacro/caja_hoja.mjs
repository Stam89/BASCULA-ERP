// 📋 Caja tipo hoja de cálculo (2026-10-30): rubro «Gastos/Ingresos varios · Donación · Contribución económica», columna
// CÓDIGO (001 por defecto) y el resumen global por día/fechas/mes (GET /cash/resumen). SOLO copia.
// `node scripts/simulacro/caja_hoja.mjs mantener` deja el servidor de la copia en :4001 para mirar la pantalla.
import fs from "fs";
import os from "os";
import path from "path";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const mantener = process.argv.includes("mantener");
const S = await montar({ copiar: !process.argv.includes("nocopia") });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const hoy = (await q("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text AS d"))[0].d;
try {
  const cats = await q("SELECT codigo, tipo, activo, aplicable_a FROM cash_categories WHERE codigo IN ('GASTOS_VARIOS','INGRESOS_VARIOS') ORDER BY codigo");
  check(cats.length === 2 && cats.every((c) => c.activo && c.aplicable_a === "AMBOS"), "A1. el rubro varios existe de ingreso y de egreso, activo, para todos", cats);

  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 100 }, matriz), "B0. caja con $100");
  const g = exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "GASTOS_VARIOS", amount: 12.5, description: "SIM donación a la escuela", codigo: "002" }, matriz), "B1. donación de $12.50 con código 002");
  check(g.codigo === "002", "B2. guarda el código escrito", g.codigo);
  const i = exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "INCOME", category: "INGRESOS_VARIOS", amount: 20, description: "SIM aporte para refrigerio", codigo: "001" }, matriz), "B3. aporte de $20 con código 001");
  check(i.codigo === null, "B4. el 001 por defecto se guarda vacío (se muestra 001)", i.codigo);
  const mal = await api("POST", `/cash/${caja.id}/movements`, { movement: "INCOME", category: "GASTOS_VARIOS", amount: 5, description: "SIM" }, matriz);
  check(mal.status === 400, "B5. el rubro de egreso no entra como ingreso", mostrar(mal));
  const sum = exigir(await api("GET", `/cash/registers/${caja.id}/summary`, undefined, matriz), "C0. resumen de la caja");
  check(Math.abs(sum.current_balance - 107.5) < 0.005, "C1. saldo = 100 + 20 − 12.50 = 107.50", sum.current_balance);

  const r = exigir(await api("GET", `/cash/resumen?desde=${hoy}&hasta=${hoy}&detalle=${hoy}`, undefined, matriz), "D0. resumen global de hoy");
  const real = (await q(`SELECT COALESCE(SUM(m.amount) FILTER (WHERE movement='INCOME'),0)::float e, COALESCE(SUM(m.amount) FILTER (WHERE movement='EXPENSE'),0)::float s
                           FROM cash_movements m JOIN cash_registers cr ON cr.id=m.cash_register_id
                          WHERE cr.accionista_id=$1 AND (m.created_at AT TIME ZONE 'America/Guayaquil')::date = $2::date`, [matriz, hoy]))[0];
  check(Math.abs(r.entradas - real.e) < 0.005 && Math.abs(r.salidas - real.s) < 0.005, "D1. entradas y salidas de hoy = las de todas las cajas de la Matriz", { api: [r.entradas, r.salidas], sql: [real.e, real.s] });
  check(Math.abs(r.saldo_final - 107.5) < 0.005, "D2. saldo al cierre de hoy = el de la caja vigente (la del simulacro)", r.saldo_final);
  check(r.detalle.some((m) => m.id === g.id && m.codigo === "002") && r.detalle.some((m) => m.id === i.id), "D3. el detalle del día trae los movimientos con su código", r.detalle.length);
  check(r.dias.length === 1 && Math.abs(r.dias[0].neto - (real.e - real.s)) < 0.005, "D4. un día con su neto", r.dias);

  const mes = hoy.slice(0, 7);
  const ult = (await q("SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date::text d", [hoy]))[0].d;
  const rm = exigir(await api("GET", `/cash/resumen?desde=${mes}-01&hasta=${ult}`, undefined, matriz), "E0. resumen del mes");
  check(rm.dias.length === Number(ult.slice(8)), "E1. un renglón por cada día del mes", rm.dias.length);
  check(Math.abs(rm.neto - (rm.entradas - rm.salidas)) < 0.005 && rm.dias.at(-1).saldo_final === rm.saldo_final, "E2. totales del mes cuadran con sus días");
  const ini = rm.dias.findIndex((d) => d.fecha === hoy);
  check(ini >= 0 && rm.dias.slice(ini + 1).every((d) => d.movimientos === 0 && d.saldo_final === 107.5), "E3. los días que vienen quedan con el saldo vigente");
  const al = await api("GET", `/cash/resumen?desde=${ult}&hasta=${mes}-01`, undefined, matriz);
  check(al.status === 400, "E4. «desde» después de «hasta» se rechaza", mostrar(al));
  const socio = (await q("SELECT id FROM accionistas WHERE tipo='SOCIO' ORDER BY code LIMIT 1"))[0].id;
  const rs = exigir(await api("GET", `/cash/resumen?desde=${hoy}&hasta=${hoy}&detalle=${hoy}`, undefined, socio), "F0. resumen de un socio");
  check(!rs.detalle.some((m) => m.id === g.id), "F1. un socio no ve los movimientos de la caja de la Matriz");

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); }
if (mantener) {
  // Sesión para el navegador (solo la copia): se pega en localStorage «bascula-erp:auth».
  const { signToken } = await import(new URL("../../dist/auth/jwt.js", import.meta.url).href);
  const u = S.admin;
  const sesion = { token: signToken({ id: u.id, username: u.username, name: u.name, role_id: u.role_id, role_name: u.role_name, allowed_modules: null }), user: u, matriz };
  fs.writeFileSync(path.join(os.tmpdir(), "caja_hoja_sesion.json"), JSON.stringify(sesion));
  console.log("Servidor de la COPIA en http://127.0.0.1:4001 · sesión en", path.join(os.tmpdir(), "caja_hoja_sesion.json"));
  await new Promise(() => {});
}
const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0);
