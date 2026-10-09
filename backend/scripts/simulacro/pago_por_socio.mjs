// 🤝 La MATRIZ paga a los cosechadores que debe un socio, con la plata que un cliente de ese socio le depositó.
// Por Pagar › «¿Quién pagó?»: la deuda baja; el dinero sale de la caja del que pagó; primero se descuenta de lo que
// el que pagó le debía al socio por cobros recibidos ('cobro_por_socio') y el resto queda como deuda nueva
// ('pago_por_socio'). Anular el pago lo deshace todo. SOLO contra la copia.
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
  await q(fs.readFileSync(MIG("20261087_pago_por_socio_cruces.sql"), "utf8")); // idempotente
  const ceyro = matriz;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const rovinson = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const cajaC = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO mixta", tipo: "MIXTO", opening_balance_cash: 500, opening_balance_bank: 500 }, ceyro), "0. caja MIXTA de CEYRO");
  const cajaS = exigir(await api("POST", "/cash/registers/open", { name: "Caja STALYN", tipo: "EFECTIVO", opening_balance_cash: 300 }, stalyn), "0b. caja de STALYN");
  const movsDe = async (cajaId) => (await q("SELECT id, movement, category, medio, amount::float a, reversed_at FROM cash_movements WHERE cash_register_id=$1 ORDER BY created_at, id", [cajaId]));
  const saldo = async (t, id) => (await q(`SELECT balance::float b, status FROM ${t} WHERE id=$1`, [id]))[0];

  // Un cliente de STALYN le deposita $100 a CEYRO (CEYRO queda debiéndole $100 a STALYN).
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE DE STALYN" }, stalyn), "0c. cliente de STALYN");
  const ar = (await q("INSERT INTO accounts_receivable (accionista_id, customer_id, reference_type, description, amount, balance, status) VALUES ($1,$2,'sales','venta sim',100,100,'CONFIRMED') RETURNING id", [stalyn, cli.id]))[0].id;
  exigir(await api("POST", "/receivable/pay-group", { receivable_ids: [ar], amount: 100, recibido_por: ceyro, medio_pago: "BANCO" }, stalyn), "0d. el cliente de STALYN le deposita $100 a CEYRO");
  const deposito = (await movsDe(cajaC.id)).find((m) => m.category === "COBRO_POR_SOCIO");
  const debeC = (await q("SELECT id FROM accounts_payable WHERE reference_type='cobro_por_socio' AND reference_id=$1", [deposito.id]))[0].id;
  const debeS = (await q("SELECT id FROM accounts_receivable WHERE reference_type='cobro_por_socio' AND reference_id=$1", [deposito.id]))[0].id;
  // STALYN le debe $150 a un cosechador contratado.
  const cosech = (await q("INSERT INTO accounts_payable (accionista_id, reference_type, description, amount, balance, status) VALUES ($1,'cosechadora_tercero','Cosechadora (tercero) - DON PEDRO - sim',150,150,'CONFIRMED') RETURNING id", [stalyn]))[0].id;
  const antesS = (await movsDe(cajaS.id)).length;

  // ── A. CEYRO le paga los $150 al cosechador por STALYN ──
  const r = exigir(await api("POST", "/cash/payables/pay-group", { payable_ids: [cosech], amount: 150, pagado_por: ceyro, medio_pago: "EFECTIVO" }, stalyn), "A1. STALYN registra: CEYRO le pagó $150 a su cosechador");
  check(r.pago_por_socio?.descontado === 100 && r.pago_por_socio?.deuda_nueva === 50, "A2. se descuentan $100 de lo que CEYRO le debía y quedan $50 de deuda nueva", r.pago_por_socio);
  check((await saldo("accounts_payable", cosech)).status === "PAID", "A3. el cosechador queda pagado");
  const pago = (await movsDe(cajaC.id)).find((m) => m.category === "PAGO_POR_SOCIO");
  check(pago?.movement === "EXPENSE" && pago.a === 150 && pago.medio === "EFECTIVO", "A4. los $150 salen de la gaveta de CEYRO como «Pago hecho por otro socio»", pago);
  check((await movsDe(cajaS.id)).length === antesS, "A5. la caja de STALYN no se mueve");
  const dC = await saldo("accounts_payable", debeC), dS = await saldo("accounts_receivable", debeS);
  check(dC.b === 0 && dC.status === "PAID" && dS.b === 0 && dS.status === "PAID", "A6. lo que CEYRO le debía por el depósito ($100) queda saldado en los dos lados", { dC, dS });
  const nuevo = (await q(`SELECT p.id cxp, p.accionista_id pa, p.amount::float pm, r.id cxc, r.accionista_id ra FROM accounts_payable p JOIN accounts_receivable r ON r.reference_type=p.reference_type AND r.reference_id=p.reference_id
                           WHERE p.reference_type='pago_por_socio' AND p.reference_id=$1`, [pago.id]))[0];
  check(nuevo?.pa === stalyn && nuevo?.ra === ceyro && nuevo?.pm === 50, "A7. STALYN le debe $50 a CEYRO (Por Pagar ↔ Por Cobrar)", nuevo);
  const pp = (await api("GET", "/cash/payables", undefined, stalyn)).data.find((x) => x.id === nuevo.cxp);
  check(pp?.farmer_name === "CEYRO" && pp?.entre_socios === true, "A8. en Por Pagar de STALYN aparece «CEYRO» (entre socios)", pp && { n: pp.farmer_name, s: pp.entre_socios });
  const pc = (await api("GET", "/receivable", undefined, ceyro)).data.find((x) => x.id === nuevo.cxc);
  check(pc?.customer_name === "STALYN" && pc?.entre_socios === true, "A9. en Por Cobrar de CEYRO aparece «STALYN» (entre socios)", pc && { n: pc.customer_name, s: pc.entre_socios });

  // ── B. Validaciones ──
  const ref = (await q("SELECT gen_random_uuid() id"))[0].id;
  await q("INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'saldo_inicial_socio',$2,'sim',20,20,'CONFIRMED')", [rovinson, ref]);
  const entre = (await q("INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'saldo_inicial_socio',$2,'sim',20,20,'CONFIRMED') RETURNING id", [stalyn, ref]))[0].id;
  const r1 = await api("POST", "/cash/payables/pay-group", { payable_ids: [entre], amount: 20, pagado_por: ceyro }, stalyn);
  check(r1.status === 409, "B1. una deuda ENTRE socios no se puede pagar «por otro» (409)", mostrar(r1));
  const otra = (await q("INSERT INTO accounts_payable (accionista_id, reference_type, description, amount, balance, status) VALUES ($1,'cosechadora_tercero','Cosechadora (tercero) - OTRO - sim',30,30,'CONFIRMED') RETURNING id", [stalyn]))[0].id;
  const r2 = await api("POST", "/cash/payables/pay-group", { payable_ids: [otra], amount: 30, pagado_por: rovinson }, stalyn);
  check(r2.status === 409 && /caja abierta/.test(JSON.stringify(r2.data)), "B2. si el que pagó no tiene caja abierta → aviso claro (409)", mostrar(r2));

  // ── C. Anular ──
  const r3 = await api("POST", `/cash/movements/${deposito.id}/reverse`, { reason: "prueba" }, ceyro);
  check(r3.status === 409, "C1. el depósito ya se usó para pagar al cosechador: no se anula sin anular primero ese pago", mostrar(r3));
  exigir(await api("POST", `/cash/movements/${pago.id}/reverse`, { reason: "el cosechador no era de STALYN" }, ceyro), "C2. CEYRO anula el pago al cosechador");
  const c1 = await saldo("accounts_payable", cosech), c2 = await saldo("accounts_payable", debeC), c3 = await saldo("accounts_receivable", debeS);
  const c4 = (await q("SELECT status FROM accounts_payable WHERE id=$1", [nuevo.cxp]))[0].status, c5 = (await q("SELECT status FROM accounts_receivable WHERE id=$1", [nuevo.cxc]))[0].status;
  check(c1.b === 150 && c1.status === "CONFIRMED" && c2.b === 100 && c2.status === "CONFIRMED" && c3.b === 100 && c4 === "CANCELLED" && c5 === "CANCELLED",
    "C3. STALYN vuelve a deberle $150 al cosechador, CEYRO vuelve a deberle $100 a STALYN y la deuda de $50 se anula", { c1, c2, c3, c4, c5 });

  // ── D. Pago menor a lo que CEYRO debe: todo sale de esa misma plata ──
  const r4 = exigir(await api("POST", "/cash/payables/pay-group", { payable_ids: [cosech], amount: 60, pagado_por: ceyro, medio_pago: "BANCO" }, stalyn), "D1. CEYRO abona $60 al cosechador por STALYN (por el banco)");
  check(r4.pago_por_socio?.descontado === 60 && r4.pago_por_socio?.deuda_nueva === 0, "D2. los $60 se descuentan completos; no hay deuda nueva", r4.pago_por_socio);
  check((await saldo("accounts_payable", debeC)).b === 40 && (await saldo("accounts_receivable", debeS)).b === 40, "D3. CEYRO todavía le debe $40 a STALYN (en los dos lados)");
  check((await saldo("accounts_payable", cosech)).b === 90, "D4. al cosechador le faltan $90");

  // ── E. No es gasto de CEYRO (se lee el código fuente: nada de importar dist en un simulacro) ──
  const fuente = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/services/resultado-mensual.ts"), "utf8");
  check(/CATEGORIAS_NO_OPERATIVAS[\s\S]*"PAGO_POR_SOCIO"/.test(fuente), "E1. «Pago hecho por otro socio» no cuenta como gasto de CEYRO en el Resultado mensual");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
