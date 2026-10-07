// Nómina: sueldos administrativos, cuadrilla (pago por persona, anticipos, edición de lo pagado) y cierre semanal.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dos = (f) => Promise.all([f(), f()]);

try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO", tipo: "EFECTIVO", opening_balance_cash: 2000 }), "0a. CEYRO abre caja con $2000");
  const cajaS = exigir(await api("POST", "/cash/registers/open", { name: "Caja STALYN", tipo: "EFECTIVO", opening_balance_cash: 500 }, stalyn), "0b. STALYN abre caja con $500");
  const saldo = async (id = caja.id, acc = matriz) => r2((await api("GET", `/cash/registers/${id}/summary`, undefined, acc)).data.current_balance);

  // ── A. Sueldos administrativos ─────────────────────────────────────────
  const emp = exigir(await api("POST", "/admin-payroll/staff", { cargo: "Contadora", worker_name: "EMPLEADA SIMULACRO", base_salary: 400 }), "A1. se crea la empleada (sueldo $400)");
  const s0 = await saldo();
  const pago1 = await api("POST", "/admin-payroll/pay", { staff_id: emp.id, incentivo: 50, descuentos: 20, periodo: "2026-10 Quincena", cash_register_id: caja.id });
  check(pago1.ok && pago1.data.paid === 430 && r2(s0 - (await saldo())) === 430, "A2. paga $400 + 50 − 20 = $430 y sale de la caja", mostrar(pago1));
  const pagoRep = await api("POST", "/admin-payroll/pay", { staff_id: emp.id, periodo: "2026-10 Quincena", cash_register_id: caja.id });
  check(pagoRep.status === 409, "A3. pagar OTRA VEZ la misma quincena a la misma persona se rechaza (409)", mostrar(pagoRep));
  const carr = await dos(() => api("POST", "/admin-payroll/pay", { staff_id: emp.id, periodo: "2026-10 Fin de mes", cash_register_id: caja.id }));
  check(carr.filter((r) => r.ok).length === 1 && carr.every((r) => r.status !== 500), "A4. doble clic al pagar el fin de mes: se paga UNA vez", carr.map((r) => r.status));
  check((await q("SELECT count(*)::int n FROM admin_salary_payments WHERE staff_id=$1 AND anulado_at IS NULL", [emp.id]))[0].n === 2, "A5. quedan exactamente 2 pagos registrados (quincena y fin de mes)");
  const ajena = await api("POST", "/admin-payroll/pay", { staff_id: emp.id, periodo: "2026-11 Quincena", cash_register_id: cajaS.id });
  check(ajena.status === 404, "A6. pagar con la caja de OTRO socio se rechaza", mostrar(ajena));
  const gordo = exigir(await api("POST", "/admin-payroll/staff", { cargo: "Gerente", worker_name: "SUELDO ALTO", base_salary: 9000 }), "A7. empleado con sueldo de $9000");
  const sobre = await api("POST", "/admin-payroll/pay", { staff_id: gordo.id, periodo: "2026-10 Quincena", cash_register_id: caja.id });
  check(sobre.status === 409 && sobre.data.confirmable === true, "A8. pagar más de lo que hay en la caja AVISA (sobregiro confirmable)", mostrar(sobre));
  const dsc = await api("POST", "/admin-payroll/pay", { staff_id: gordo.id, descuentos: 99999, periodo: "2026-10 Quincena", cash_register_id: caja.id });
  check(dsc.status === 400, "A9. descuentos mayores al sueldo → 400", mostrar(dsc));
  // Anular el pago en Caja lo libera para volver a pagarse
  const movQ = (await q("SELECT id FROM cash_movements WHERE reference_type='admin_salary_payments' ORDER BY created_at LIMIT 1"))[0];
  const rev = await api("POST", `/cash/movements/${movQ.id}/reverse`, { reason: "Pago equivocado" });
  check(rev.ok && (await q("SELECT count(*)::int n FROM admin_salary_payments WHERE staff_id=$1 AND anulado_at IS NULL", [emp.id]))[0].n === 1, "A10. anular el pago en Caja lo marca anulado en la nómina", mostrar(rev));
  const repago = await api("POST", "/admin-payroll/pay", { staff_id: emp.id, periodo: "2026-10 Quincena", cash_register_id: caja.id });
  check(repago.ok, "A11. tras anular, esa quincena se puede pagar de nuevo", mostrar(repago));
  const otroSocio = await api("PUT", `/admin-payroll/staff/${emp.id}`, { base_salary: 1 }, stalyn);
  const otroDel = await api("DELETE", `/admin-payroll/staff/${emp.id}`, undefined, stalyn);
  check(otroSocio.status === 404 && otroDel.status === 404, "A12. otro socio no puede editar ni borrar a tu empleada", [otroSocio.status, otroDel.status]);

  // ── B. Cuadrilla ───────────────────────────────────────────────────────
  const acts = exigir(await api("GET", "/cuadrilla/activities"), "B0. actividades de cuadrilla");
  const act = acts.find((a) => Number(a.unit_rate) > 0 && a.categoria !== "SECADORA") ?? acts[0];
  const tarifa = Number(act.unit_rate);
  const W = "SIM CUADRILLA";
  const hoy = (await q("SELECT CURRENT_DATE::text d"))[0].d;
  const e1 = exigir(await api("POST", "/cuadrilla/entries", { work_date: hoy, activity_id: act.id, worker_name: W, quantity: 400 }), `B1. registra 400 × $${tarifa} de "${act.name}"`);
  const bruto = r2(400 * tarifa);
  const adv = exigir(await api("POST", "/cuadrilla/advances", { worker_name: W, amount: 30, concept: "Adelanto" }), "B2. anticipo de $30 a la cuadrilla");
  const sAntes = await saldo();
  const pw = await api("POST", "/cuadrilla/pay-worker", { worker_name: W, from: hoy, to: hoy, cash_register_id: caja.id });
  check(pw.ok && pw.data.gross === bruto && pw.data.anticipos === 30 && pw.data.paid === r2(bruto - 30) && r2(sAntes - (await saldo())) === r2(bruto - 30), `B3. paga: bruto $${bruto} − anticipo 30 = $${r2(bruto - 30)} y esa cifra sale de caja`, mostrar(pw));
  const pwRep = await api("POST", "/cuadrilla/pay-worker", { worker_name: W, from: hoy, to: hoy, cash_register_id: caja.id });
  check(pwRep.status === 400, "B4. pagar otra vez lo mismo se rechaza (nada pendiente)", mostrar(pwRep));
  // Lo ya pagado no se edita ni se borra
  const edita = await api("PUT", `/cuadrilla/entries/${e1.id}`, { work_date: hoy, activity_id: act.id, worker_name: W, quantity: 900 });
  check(edita.status === 409, "B5. un registro YA PAGADO no se puede editar (descuadraría la caja)", mostrar(edita));
  const borra = await api("DELETE", `/cuadrilla/entries/${e1.id}`);
  check(borra.status === 409, "B6. un registro YA PAGADO no se puede borrar", borra.status);
  // Pago a la vez
  await api("POST", "/cuadrilla/entries", { work_date: hoy, activity_id: act.id, worker_name: W, quantity: 10 });
  const sB7 = await saldo();
  const pb = await dos(() => api("POST", "/cuadrilla/pay-worker", { worker_name: W, from: hoy, to: hoy, cash_register_id: caja.id }));
  check(pb.filter((r) => r.ok).length === 1 && r2(sB7 - (await saldo())) === r2(10 * tarifa), "B7. doble clic al pagar: se paga UNA vez", pb.map((r) => r.status));
  // Anticipos: saldar dos veces a la vez
  const adv2 = exigir(await api("POST", "/cuadrilla/advances", { worker_name: W + " 2", amount: 50 }), "B9a. anticipo de $50");
  const st = await dos(() => api("POST", `/cuadrilla/advances/${adv2.id}/settle`, { amount: 40 }));
  const balAdv = Number((await q("SELECT balance FROM cuadrilla_advances WHERE id=$1", [adv2.id]))[0].balance);
  check(balAdv === 10 || balAdv === 50 - 40 - 0 ? balAdv >= 0 : false, "B9. saldar $40 dos veces a la vez sobre $50: el saldo nunca queda negativo", { saldo: balAdv });
  check(balAdv === 0, "B9b. los dos abonos se aplican uno tras otro: $40 y luego los $10 restantes (saldo 0, sin pisarse)", { saldo: balAdv, estados: st.map((r) => r.status) });
  // Anticipo con caja
  const sAdv = await saldo();
  const advC = await api("POST", "/cuadrilla/advances", { worker_name: W + " 3", amount: 25, cash_register_id: caja.id });
  check(advC.ok && r2(sAdv - (await saldo())) === 25, "B10. un anticipo de cuadrilla entregado con caja SACA el dinero de la caja", mostrar(advC));
  const advSob = await api("POST", "/cuadrilla/advances", { worker_name: W + " 4", amount: 99999, cash_register_id: caja.id });
  check(advSob.status === 409 && advSob.data.confirmable === true, "B11. y avisa si deja la caja en negativo", mostrar(advSob));

  // ── C. Reabrir (anular en Caja) un pago de cuadrilla devuelve sus anticipos ──
  const mvC = (await q("SELECT id, amount::float a FROM cash_movements WHERE reference_type='cuadrilla_entries' AND reversal_of IS NULL AND description LIKE $1 ORDER BY created_at LIMIT 1", [`%${W}%`]))[0];
  const antes = Number((await q("SELECT balance FROM cuadrilla_advances WHERE id=$1", [adv.id]))[0].balance);
  const rv = await api("POST", `/cash/movements/${mvC.id}/reverse`, { reason: "Pago a cuadrilla equivocado" });
  const despues = Number((await q("SELECT balance FROM cuadrilla_advances WHERE id=$1", [adv.id]))[0].balance);
  check(rv.ok && antes === 0 && despues === 30, "C1. anular el pago devuelve el anticipo de $30 a pendiente y las entradas a «sin pagar»", { antes, despues, rv: rv.status });
  check((await q("SELECT count(*)::int n FROM cuadrilla_entries WHERE id=$1 AND paid_at IS NULL", [e1.id]))[0].n === 1, "C2. el registro vuelve a estar pendiente");

  // ── D. Cierre semanal ──────────────────────────────────────────────────
  const v = (await api("GET", `/nomina-semanal/vista?hasta=${hoy}`)).data;
  check(v && Array.isArray(v.personas), "D1. la vista previa del cierre semanal responde", v && Object.keys(v));
  const mia = v.personas?.find((p) => /SIM CUADRILLA$/i.test(p.nombre ?? p.name ?? p.persona ?? ""));
  console.log("   (info) personas en la vista:", v.personas?.length, "neto total:", v.totales?.neto);
  const caro = await api("POST", "/nomina-semanal/pagar", { hasta: hoy, cash_register_id: caja.id, confirmar_neto: (v.totales?.neto ?? 0) + 5 });
  check(caro.status === 409 || caro.status === 400, "D2. si el total confirmado no coincide con el calculado, NO se paga nada", mostrar(caro));
  if ((v.totales?.neto ?? 0) > 0) {
    const sD = await saldo();
    const dd = await dos(() => api("POST", "/nomina-semanal/pagar", { hasta: hoy, cash_register_id: caja.id, confirmar_neto: v.totales.neto }, matriz, { "x-confirmar": "SOBREGIRO" }));
    check(dd.filter((r) => r.ok).length === 1 && r2(sD - (await saldo())) === r2(v.totales.neto), "D3. doble clic en el cierre semanal: se paga UNA vez y sale exactamente el neto", { st: dd.map((r) => r.status), salio: r2(sD - (await saldo())), neto: v.totales.neto });
    const v2 = (await api("GET", `/nomina-semanal/vista?hasta=${hoy}`)).data;
    check((v2.totales?.neto ?? 0) === 0, "D4. después de pagar no queda nada pendiente hasta esa fecha", v2.totales);
  }
  const noMatriz = await api("GET", `/nomina-semanal/vista?hasta=${hoy}`, undefined, stalyn);
  check(noMatriz.status === 403, "D5. el cierre semanal es solo de la matriz (el socio recibe 403)", noMatriz.status);

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. las ${TOTAL_REGLAS} reglas de consistencia se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
