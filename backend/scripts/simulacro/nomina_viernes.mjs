// 🗓️ Nómina del viernes (mejora 4 de la caja, 2026-10-28): casillas para dejar a alguien sin pagar hoy, sueldo SEMANAL
// por día (la cocinera) con los días editables, y anular un sueldo no toca a los demás pagados a la vez. SOLO copia.
import fs from "fs";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261122_sueldo_semanal.sql", import.meta.url), "utf8"));
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 2000 }, matriz), "0. caja de CEYRO");
  const saldo = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s);
  const hasta = "2026-10-30"; // viernes

  // ── A. Sueldos semanales por día ──
  const dani = exigir(await api("POST", "/admin-payroll/staff", { cargo: "Cocinera", worker_name: "SIM DANIELA", base_salary: 11.67, periodicidad: "SEMANAL", dias_semana: 6 }, matriz), "A1. cocinera de pago semanal ($11.67 por día, 6 días)");
  const ana = exigir(await api("POST", "/admin-payroll/staff", { cargo: "Limpieza", worker_name: "SIM ANA", base_salary: 10, periodicidad: "SEMANAL", dias_semana: 6 }, matriz), "A2. otra semanal ($10 por día)");
  check(dani.periodicidad === "SEMANAL" && dani.dias_semana === 6 && dani.salario_fin_mes === null, "A3. queda como semanal", dani);
  const pend = exigir(await api("GET", "/admin-payroll/pending", undefined, matriz), "A4. sueldos de quincena pendientes");
  check(!(pend.staff ?? []).some((s) => s.id === dani.id), "A5. la semanal no sale entre las quincenas");

  // ── B. Vista del viernes ──
  const v = exigir(await api("GET", `/nomina-semanal/vista?hasta=${hasta}`, undefined, matriz), "B1. lista del viernes");
  const pD = v.personas.find((p) => p.staff_id === dani.id), pA = v.personas.find((p) => p.staff_id === ana.id);
  check(pD?.grupo === "sueldo" && pD.neto === 70.02 && pD.dias === 6, "B2. la cocinera sale con 6 días × $11.67 = $70.02", pD);
  const otros = v.personas.filter((p) => p.grupo !== "sueldo");
  check(v.personas.every((p) => typeof p.clave === "string"), "B3. cada persona tiene su clave para la casilla");

  // ── C. Pagar: dejar a uno sin pagar y cambiar días ──
  const excluir = [pA.clave, ...(otros[0] ? [otros[0].clave] : [])];
  const pagados = v.personas.filter((p) => !excluir.includes(p.clave));
  const neto = r2(pagados.reduce((a, p) => a + (p.staff_id === dani.id ? 11.67 * 5 : p.neto), 0));
  const mal = await api("POST", "/nomina-semanal/pagar", { hasta, cash_register_id: caja.id, confirmar_neto: r2(neto + 1), excluir, dias: { [dani.id]: 5 } }, matriz);
  check(mal.status === 409, "C1. si el total no es el revisado, no se paga nada", mostrar(mal));
  const s0 = await saldo();
  const r = exigir(await api("POST", "/nomina-semanal/pagar", { hasta, cash_register_id: caja.id, confirmar_neto: neto, excluir, dias: { [dani.id]: 5 } }, matriz), `C2. pagar lo marcado (${neto}): sin ANA${otros[0] ? ` ni ${otros[0].nombre}` : ""}, cocinera 5 días`);
  check(Math.abs((await saldo()) - (s0 - neto)) < 0.01 && r2(r.totales.neto) === neto, "C3. sale de la caja solo lo marcado", { neto, pagado: r.totales.neto });
  const pagoD = (await q("SELECT net_amount::float n, dias::float d, periodo FROM admin_salary_payments WHERE staff_id=$1 AND anulado_at IS NULL", [dani.id]))[0];
  check(pagoD?.n === 58.35 && pagoD.d === 5 && pagoD.periodo === "Semana 2026-10-26", "C4. la cocinera cobra 5 días ($58.35), semana del lunes 26", pagoD);
  const v2 = exigir(await api("GET", `/nomina-semanal/vista?hasta=${hasta}`, undefined, matriz), "C5. lista otra vez");
  check(!v2.personas.some((p) => p.staff_id === dani.id) && v2.personas.some((p) => p.staff_id === ana.id)
    && (!otros[0] || v2.personas.some((p) => p.clave === otros[0].clave)), "C6. la cocinera ya cobró esa semana; los desmarcados siguen pendientes");
  const doble = await api("POST", "/admin-payroll/pay", { staff_id: dani.id, cash_register_id: caja.id, periodo: "Semana 2026-10-26" }, matriz);
  check(doble.status === 409, "C7. la misma semana no se paga dos veces", mostrar(doble));

  // ── D. Pagar ANA y anular SOLO su sueldo ──
  const v3 = exigir(await api("GET", `/nomina-semanal/vista?hasta=${hasta}`, undefined, matriz), "D1. lista");
  const soloAna = v3.personas.filter((p) => p.staff_id !== ana.id).map((p) => p.clave);
  exigir(await api("POST", "/nomina-semanal/pagar", { hasta, cash_register_id: caja.id, confirmar_neto: 60, excluir: soloAna }, matriz), "D2. pagar a ANA ($60)");
  const movA = (await q("SELECT m.id FROM cash_movements m JOIN admin_salary_payments p ON p.id = m.reference_id WHERE p.staff_id=$1", [ana.id]))[0];
  check(!!movA, "D3. el egreso queda enlazado a su pago de sueldo");
  exigir(await api("POST", `/cash/movements/${movA.id}/reverse`, { reason: "SIM anular sueldo de ANA" }, matriz), "D4. anular el sueldo de ANA");
  const quedan = await q("SELECT staff_id, anulado_at IS NOT NULL an FROM admin_salary_payments WHERE staff_id = ANY($1::uuid[])", [[dani.id, ana.id]]);
  check(quedan.find((x) => x.staff_id === ana.id)?.an === true && quedan.find((x) => x.staff_id === dani.id)?.an === false, "D5. solo se anula el de ANA; el de la cocinera sigue pagado", quedan);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
