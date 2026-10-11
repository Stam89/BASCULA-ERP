// 💼 Sueldo administrativo distinto en la QUINCENA ($250 el 15) y a FIN DE MES ($300). Sin fin de mes = igual a la
// quincena (como antes). SOLO contra la copia.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const MIG = (f) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations", f);

try {
  await q(fs.readFileSync(MIG("20261088_sueldo_fin_de_mes.sql"), "utf8")); // idempotente
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim sueldos", tipo: "EFECTIVO", opening_balance_cash: 2000 }, matriz), "0. caja de CEYRO");

  // A. Alta con quincena $250 y fin de mes $300
  const ana = exigir(await api("POST", "/admin-payroll/staff", { cargo: "Oficina", worker_name: "SIM ANA QUINCENA", base_salary: 250, salario_fin_mes: 300 }, matriz), "A1. alta: $250 la quincena y $300 a fin de mes");
  check(ana.base_salary === 250 && ana.salario_fin_mes === 300 && ana.sueldo_mes === 550, "A2. queda guardado: quincena $250, fin de mes $300, al mes $550", ana);
  const p1 = exigir(await api("POST", "/admin-payroll/pay", { staff_id: ana.id, periodo: "2026-10 Quincena", cash_register_id: caja.id }, matriz), "A3. se le paga la quincena de octubre");
  check(p1.paid === 250, "A4. la quincena paga $250", p1);
  const p2 = exigir(await api("POST", "/admin-payroll/pay", { staff_id: ana.id, periodo: "2026-10 Fin de mes", incentivo: 20, descuentos: 10, cash_register_id: caja.id }, matriz), "A5. se le paga el fin de mes (con $20 de incentivo y $10 de descuento)");
  check(p2.base === 300 && p2.paid === 310, "A6. el fin de mes paga $300 + $20 − $10 = $310", p2);
  const egresos = (await q("SELECT amount::float a FROM cash_movements WHERE cash_register_id=$1 AND reference_type='admin_salary_payments' ORDER BY created_at", [caja.id])).map((r) => r.a);
  check(JSON.stringify(egresos) === "[250,310]", "A7. en Caja salen $250 y $310", egresos);
  const repetido = await api("POST", "/admin-payroll/pay", { staff_id: ana.id, periodo: "2026-10 Fin de mes", cash_register_id: caja.id }, matriz);
  check(repetido.status === 409, "A8. el mismo fin de mes no se paga dos veces", mostrar(repetido));

  // B. Sin fin de mes = igual a la quincena (los empleados de antes no cambian)
  const luis = exigir(await api("POST", "/admin-payroll/staff", { cargo: "Contador", worker_name: "SIM LUIS IGUAL", base_salary: 200 }, matriz), "B1. alta solo con quincena $200");
  check(luis.salario_fin_mes === null && luis.sueldo_mes === 400, "B2. fin de mes vacío = igual a la quincena (al mes $400)", luis);
  const p3 = exigir(await api("POST", "/admin-payroll/pay", { staff_id: luis.id, periodo: "2026-10 Fin de mes", cash_register_id: caja.id }, matriz), "B3. se le paga el fin de mes");
  check(p3.paid === 200, "B4. paga $200 (lo mismo que la quincena)", p3);

  // C. Editar
  const e1 = exigir(await api("PUT", `/admin-payroll/staff/${luis.id}`, { salario_fin_mes: 260 }, matriz), "C1. se le pone fin de mes $260");
  check(e1.base_salary === 200 && e1.salario_fin_mes === 260, "C2. cambia solo el fin de mes", e1);
  const e2 = exigir(await api("PUT", `/admin-payroll/staff/${luis.id}`, { cargo: "Contador general" }, matriz), "C3. se cambia solo el cargo");
  check(e2.salario_fin_mes === 260, "C4. … y el fin de mes se mantiene", e2);
  const e3 = exigir(await api("PUT", `/admin-payroll/staff/${luis.id}`, { salario_fin_mes: null }, matriz), "C5. se borra el fin de mes");
  check(e3.salario_fin_mes === null && e3.sueldo_mes === 400, "C6. vuelve a ser igual a la quincena", e3);
  const lista = (await api("GET", "/admin-payroll/staff", undefined, matriz)).data.find((x) => x.id === ana.id);
  check(lista?.salario_fin_mes === 300 && lista?.sueldo_mes === 550, "C7. la lista de personal trae quincena, fin de mes y total del mes", lista);

  // D. Historial
  const hist = (await api("GET", "/admin-payroll/history", undefined, matriz)).data.filter((h) => h.worker_name === "SIM ANA QUINCENA").map((h) => [h.periodo, h.base_salary, h.net_amount]);
  check(hist.some(([p, b, n]) => p === "2026-10 Fin de mes" && b === 300 && n === 310) && hist.some(([p, b]) => p === "2026-10 Quincena" && b === 250),
    "D1. el historial guarda cada corte con su sueldo", hist);

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
