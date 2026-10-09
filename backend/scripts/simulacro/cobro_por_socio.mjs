// 🤝 El cliente de un socio le deposita a la MATRIZ (u otro socio): Por Cobrar › «¿Quién recibió el dinero?».
// El cliente deja de deber, el dinero entra a la caja del que lo recibió (banco por defecto) y nace la deuda entre
// los dos (Por Pagar del que recibió ↔ Por Cobrar del socio). Se salda/anula como cualquier deuda entre socios.
// SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const SOBRE = { "x-confirmar": "SOBREGIRO" };

try {
  const ceyro = matriz;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const rovinson = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const cajaC = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO mixta", tipo: "MIXTO", opening_balance_cash: 500, opening_balance_bank: 500 }, ceyro), "0. caja MIXTA de CEYRO");
  const cajaS = exigir(await api("POST", "/cash/registers/open", { name: "Caja STALYN", tipo: "EFECTIVO", opening_balance_cash: 300 }, stalyn), "0b. caja de STALYN");
  const movsDe = async (cajaId) => (await q("SELECT id, movement, category, medio, amount::float a, reversed_at FROM cash_movements WHERE cash_register_id=$1 ORDER BY created_at, id", [cajaId]));
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE DEPOSITA A MATRIZ" }, stalyn), "0c. cliente de STALYN");
  const ar = (await q("INSERT INTO accounts_receivable (accionista_id, customer_id, reference_type, description, amount, balance, status) VALUES ($1,$2,'sales','venta sim',100,100,'CONFIRMED') RETURNING id", [stalyn, cli.id]))[0].id;
  const antesS = (await movsDe(cajaS.id)).length;

  // ── A. El cliente de STALYN deposita $60 en el banco de CEYRO ──
  const r = exigir(await api("POST", "/receivable/pay-group", { receivable_ids: [ar], amount: 60, recibido_por: ceyro, medio_pago: "BANCO" }, stalyn), "A1. STALYN registra: el cliente le depositó $60 a CEYRO");
  check(r.deuda_entre_socios?.deudor === "CEYRO" && r.deuda_entre_socios?.monto === 60, "A2. la respuesta dice que ahora CEYRO le debe $60", r.deuda_entre_socios);
  const cxcCli = (await q("SELECT balance::float b, status FROM accounts_receivable WHERE id=$1", [ar]))[0];
  check(cxcCli.b === 40 && cxcCli.status === "PARTIAL", "A3. el cliente queda debiendo $40", cxcCli);
  const ingreso = (await movsDe(cajaC.id)).find((m) => m.category === "COBRO_POR_SOCIO");
  check(ingreso && ingreso.movement === "INCOME" && ingreso.a === 60 && ingreso.medio === "BANCO", "A4. los $60 entran al BANCO de CEYRO como «Cobro recibido para otro socio»", ingreso);
  check((await movsDe(cajaS.id)).length === antesS, "A5. la caja de STALYN no se mueve (el dinero no le llegó a él)");
  const par = (await q(`SELECT r.id cxc, r.accionista_id r_acc, r.amount::float ra, p.id cxp, p.accionista_id p_acc, p.amount::float pa
                          FROM accounts_receivable r JOIN accounts_payable p ON p.reference_type=r.reference_type AND p.reference_id=r.reference_id
                         WHERE r.reference_type='cobro_por_socio' AND r.reference_id=$1`, [ingreso.id]))[0];
  check(par && par.r_acc === stalyn && par.p_acc === ceyro && par.ra === 60 && par.pa === 60, "A6. nace la deuda: Por Cobrar de STALYN ↔ Por Pagar de CEYRO por $60", par);
  const notis = (await q("SELECT accionista_id FROM notificaciones WHERE referencia_id IN ($1,$2)", [par.cxc, par.cxp])).map((n) => n.accionista_id);
  check(notis.includes(stalyn) && notis.includes(ceyro), "A7. se avisa a los dos (STALYN y CEYRO)");

  // ── B. Cómo se ve en cada pantalla ──
  const porCobrarS = (await api("GET", "/receivable", undefined, stalyn)).data.find((x) => x.id === par.cxc);
  check(porCobrarS?.customer_name === "CEYRO" && porCobrarS?.entre_socios === true, "B1. en Por Cobrar de STALYN aparece «CEYRO» (entre socios)", porCobrarS && { n: porCobrarS.customer_name, s: porCobrarS.entre_socios });
  const porPagarC = (await api("GET", "/cash/payables", undefined, ceyro)).data.find((x) => x.id === par.cxp);
  check(porPagarC?.farmer_name === "STALYN" && porPagarC?.entre_socios === true, "B2. en Por Pagar de CEYRO aparece «STALYN» (entre socios)", porPagarC && { n: porPagarC.farmer_name, s: porPagarC.entre_socios });

  // ── C. Validaciones ──
  const sinCaja = await api("POST", "/receivable/pay-group", { receivable_ids: [ar], amount: 5, recibido_por: rovinson }, stalyn);
  check(sinCaja.status === 409 && /caja abierta/.test(JSON.stringify(sinCaja.data)), "C1. si el que recibió no tiene caja abierta → aviso claro (409)", mostrar(sinCaja));
  const rol = (await q("SELECT id FROM roles WHERE name='OPERADOR'"))[0].id;
  const u = (await q("INSERT INTO users (name, username, password_hash, role_id, is_active) VALUES ('sim_cobro_socio','sim_cobro_socio','x',$1,true) RETURNING id", [rol]))[0];
  await q("INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules) VALUES ($1,$2,$3)", [u.id, stalyn, ["Por Cobrar", "EDIT:Por Cobrar", "Caja", "EDIT:Caja"]]);
  const operador = apiComo(u.id, "sim_cobro_socio", "sim_cobro_socio", stalyn);
  const sinAcceso = await operador("POST", "/receivable/pay-group", { receivable_ids: [ar], amount: 5, recibido_por: ceyro });
  check(sinAcceso.status === 403 && /acceso a la caja de CEYRO/.test(JSON.stringify(sinAcceso.data)), "C2. un operador que no tiene acceso a la caja de CEYRO no puede registrarlo (403)", mostrar(sinAcceso));
  const deMas = await api("POST", "/receivable/pay-group", { receivable_ids: [ar], amount: 41, recibido_por: ceyro }, stalyn);
  check(deMas.status === 409, "C3. no se puede registrar más de lo que debe el cliente", mostrar(deMas));

  // ── D. Anular: con abonos de por medio primero hay que anular el pago entre socios ──
  exigir(await api("POST", `/cash/payables/${par.cxp}/pay`, { amount: 10, cash_register_id: cajaC.id, medio_pago: "BANCO" }, ceyro, SOBRE), "D1. CEYRO le abona $10 a STALYN");
  const pagoC = (await movsDe(cajaC.id)).filter((m) => m.category === "PAGO_ENTRE_SOCIOS").at(-1);
  const espejoS = (await movsDe(cajaS.id)).filter((m) => m.category === "COBRO_ENTRE_SOCIOS").at(-1);
  check(pagoC?.a === 10 && espejoS?.a === 10, "D2. sale de CEYRO como «pago entre socios» y entra a la caja de STALYN", { pagoC, espejoS });
  const bloqueado = await api("POST", `/cash/movements/${ingreso.id}/reverse`, { reason: "prueba" }, ceyro);
  check(bloqueado.status === 409 && /abonos/.test(JSON.stringify(bloqueado.data)), "D3. anular el depósito con abonos → pide anular primero el pago entre socios", mostrar(bloqueado));
  exigir(await api("POST", `/cash/movements/${pagoC.id}/reverse`, { reason: "abono equivocado" }, ceyro), "D4. se anula el abono de $10");
  exigir(await api("POST", `/cash/movements/${ingreso.id}/reverse`, { reason: "el depósito era de otro cliente" }, ceyro), "D5. ahora sí se anula el depósito");
  const cliTras = (await q("SELECT balance::float b, status FROM accounts_receivable WHERE id=$1", [ar]))[0];
  const parTras = (await q("SELECT (SELECT status FROM accounts_receivable WHERE id=$1) r, (SELECT status FROM accounts_payable WHERE id=$2) p", [par.cxc, par.cxp]))[0];
  check(cliTras.b === 100 && cliTras.status === "CONFIRMED" && parTras.r === "CANCELLED" && parTras.p === "CANCELLED",
    "D6. el cliente vuelve a deber $100 y la deuda entre socios queda anulada", { cliTras, parTras });

  // ── E. Ciclo completo: el cliente paga todo a CEYRO y CEYRO le paga a STALYN ──
  const r2 = exigir(await api("POST", "/receivable/pay-group", { receivable_ids: [ar], amount: 100, recibido_por: ceyro, medio_pago: "EFECTIVO" }, stalyn), "E1. el cliente le paga los $100 a CEYRO en efectivo");
  const ing2 = (await movsDe(cajaC.id)).filter((m) => m.category === "COBRO_POR_SOCIO" && !m.reversed_at).at(-1);
  check(ing2?.medio === "EFECTIVO" && ing2?.a === 100, "E2. entra a la gaveta de CEYRO", ing2);
  check((await q("SELECT status FROM accounts_receivable WHERE id=$1", [ar]))[0].status === "PAID", "E3. el cliente queda al día");
  const cxp2 = (await q("SELECT id FROM accounts_payable WHERE reference_type='cobro_por_socio' AND reference_id=$1", [ing2.id]))[0].id;
  exigir(await api("POST", `/cash/payables/${cxp2}/pay`, { amount: 100, cash_register_id: cajaC.id }, ceyro, SOBRE), "E4. CEYRO le entrega los $100 a STALYN");
  const cxc2 = (await q("SELECT status FROM accounts_receivable WHERE reference_type='cobro_por_socio' AND reference_id=$1", [ing2.id]))[0].status;
  check(cxc2 === "PAID", "E5. la Por Cobrar de STALYN a CEYRO queda pagada (espejo)", { cxc2, r2: r2.deuda_entre_socios });

  // ── F. No es ingreso de CEYRO: el Resultado mensual no lo cuenta como venta ──
  const fin = (await api("GET", "/finance/dashboard?desde=2026-10-01&hasta=2026-10-31", undefined, ceyro));
  check(fin.ok && !/COBRO_POR_SOCIO/.test(JSON.stringify((fin.data ?? {}).ventas_detalle ?? [])), "F1. el depósito no aparece como venta de CEYRO en Estados Financieros", fin.ok ? undefined : mostrar(fin));

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
