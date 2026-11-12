// 💸 Préstamo a una persona (pedido del dueño 2026-11-11): sin interés, queda en Por Cobrar del que presta; el dinero
// sale de su caja (efectivo o banco) o de la de otro socio que lo puso (deuda entre socios). Anular en Caja lo deshace.
// SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(n * 100) / 100;
try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const cajaDe = async (acc) => (await q("SELECT id FROM cash_registers WHERE accionista_id=$1 AND status='OPEN' ORDER BY opened_at DESC LIMIT 1", [acc]))[0]?.id
    ?? exigir(await api("POST", "/cash/registers/open", { name: "Caja sim", tipo: "MIXTO", opening_balance_cash: 1000, opening_balance_bank: 1000 }, acc), "0. caja").id;
  const cS = await cajaDe(stalyn), cC = await cajaDe(matriz);
  const saldo = async (caja, medio) => r2(Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1 AND COALESCE(medio,'EFECTIVO')=$2", [caja, medio]))[0].s));
  const conf = { "x-confirmar": "SOBREGIRO" };

  // A. STALYN presta $225 desde su banco
  const b0 = await saldo(cS, "BANCO"), e0 = await saldo(cS, "EFECTIVO");
  const a = exigir(await api("POST", "/receivable/prestamo-persona", { persona: "Sim Persona Prestamo", monto: 225, medio: "BANCO", nota: "prueba" }, stalyn, conf), "A1. préstamo de $225 desde el banco de STALYN");
  check((await saldo(cS, "BANCO")) === r2(b0 - 225) && (await saldo(cS, "EFECTIVO")) === e0, "A2. baja el banco de STALYN, no la gaveta");
  const ar = (await q("SELECT accionista_id, amount::float a, balance::float b, status, reference_type, customer_id FROM accounts_receivable WHERE id=$1", [a.id]))[0];
  check(ar.accionista_id === stalyn && ar.a === 225 && ar.b === 225 && ar.reference_type === "prestamo_persona" && ar.customer_id, "A3. queda en Por Cobrar de STALYN a nombre de la persona", ar);
  const m = (await q("SELECT category FROM cash_movements WHERE id=$1", [a.movimiento_id]))[0];
  check(m.category === "PRESTAMO_TERCERO", "A4. en caja es «Préstamo a terceros» (no es gasto)", m);
  const otra = exigir(await api("POST", "/receivable/prestamo-persona", { persona: "sim persona prestamo", monto: 10, medio: "EFECTIVO" }, stalyn, conf), "A5. otro préstamo a la misma persona (escrita distinto)");
  const cli = await q("SELECT count(DISTINCT customer_id)::int n FROM accounts_receivable WHERE id = ANY($1::uuid[])", [[a.id, otra.id]]);
  check(cli[0].n === 1, "A6. es la misma persona (no la duplica)");

  // B. Abono de la persona en Por Cobrar
  exigir(await api("POST", `/receivable/${a.id}/pay`, { amount: 25, cash_register_id: cS }, stalyn), "B1. devuelve $25");
  check((await q("SELECT balance::float b FROM accounts_receivable WHERE id=$1", [a.id]))[0].b === 200, "B2. queda debiendo $200");
  const rev1 = await api("POST", `/cash/movements/${a.movimiento_id}/reverse`, { reason: "sim con abono" }, stalyn);
  check(rev1.status === 409, "B3. con abonos no se anula el préstamo", mostrar(rev1));

  // C. Lo pone otro socio: CEYRO presta y el dinero sale del banco de STALYN
  const bS = await saldo(cS, "BANCO"), bC = await saldo(cC, "BANCO");
  const c = exigir(await api("POST", "/receivable/prestamo-persona", { persona: "Sim Persona Dos", monto: 50, medio: "BANCO", pagado_por: stalyn }, matriz, conf), "C1. CEYRO presta $50 que pone STALYN");
  check((await saldo(cS, "BANCO")) === r2(bS - 50) && (await saldo(cC, "BANCO")) === bC, "C2. sale del banco de STALYN; la caja de CEYRO no cambia");
  const arC = (await q("SELECT accionista_id FROM accounts_receivable WHERE id=$1", [c.id]))[0];
  check(arC.accionista_id === matriz, "C3. la Por Cobrar es de CEYRO");
  check(r2(c.descontado + c.deuda_entre_socios) === 50, "C4. lo descontado + la deuda entre socios = $50", c);

  // D. Anular en la caja de STALYN deshace todo
  exigir(await api("POST", `/cash/movements/${c.movimiento_id}/reverse`, { reason: "sim anular" }, stalyn), "D1. anular el egreso en la caja de STALYN");
  check((await saldo(cS, "BANCO")) === bS, "D2. vuelve el banco de STALYN");
  check((await q("SELECT status FROM accounts_receivable WHERE id=$1", [c.id]))[0].status === "CANCELLED", "D3. la Por Cobrar de CEYRO queda anulada");
  const vivas = await q("SELECT count(*)::int n FROM accounts_payable WHERE reference_type='pago_por_socio' AND reference_id=$1 AND status <> 'CANCELLED'", [c.movimiento_id]);
  check(vivas[0].n === 0, "D4. la deuda entre socios queda anulada");

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
