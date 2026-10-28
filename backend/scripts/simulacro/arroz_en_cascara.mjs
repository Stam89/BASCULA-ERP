// 🌾 Caja › Arroz en cáscara (mejora 3, 2026-10-28): anticipo o pago al agricultor desde la caja, también a uno nuevo
// o sin liquidación pendiente. Lo que se le debe se paga primero; el resto queda de anticipo. Anular lo deshace. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 1000 }, matriz), "0. caja de CEYRO");
  const saldo = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s);

  // ── A. Agricultor nuevo, sin liquidación: todo queda de anticipo ──
  const nuevo = exigir(await api("POST", "/farmers", { full_name: "SIM HECTOR PEÑA" }, matriz), "A1. crear el agricultor desde la caja");
  const s0 = await saldo();
  const a = exigir(await api("POST", "/advances", { farmer_id: nuevo.id, amount: 175, concept: "Anticipo por arroz en cáscara", cash_register_id: caja.id, apply_to_payables: true }, matriz), "A2. anticipo de $175");
  check(Number(a.balance) === 175, "A3. queda de anticipo completo (no se le debía nada)", a.balance);
  check(Math.abs((await saldo()) - (s0 - 175)) < 0.01, "A4. salen $175 de la caja");
  const f1 = exigir(await api("GET", "/farmers", undefined, matriz), "A5. lista de agricultores").find((f) => f.id === nuevo.id);
  check(Number(f1?.pending_advance_balance) === 175, "A6. el agricultor muestra $175 de anticipos sin descontar", f1?.pending_advance_balance);

  // ── B. Con deuda: se paga primero lo que se le debe y el resto queda de anticipo ──
  const otro = exigir(await api("POST", "/farmers", { full_name: "SIM GABINO DEUDA" }, matriz), "B1. agricultor con deuda");
  const ap = (await q("INSERT INTO accounts_payable (farmer_id, accionista_id, amount, balance, status, description) VALUES ($1,$2,60,60,'CONFIRMED','SIM deuda de cáscara') RETURNING id", [otro.id, matriz]))[0].id;
  const s1 = await saldo();
  const b = exigir(await api("POST", "/advances", { farmer_id: otro.id, amount: 100, concept: "Pago de cáscara", cash_register_id: caja.id, apply_to_payables: true }, matriz), "B2. entregar $100");
  const apB = (await q("SELECT balance::float b, status FROM accounts_payable WHERE id=$1", [ap]))[0];
  check(apB.b === 0 && apB.status === "PAID", "B3. la deuda de $60 queda pagada", apB);
  const bDb = (await q("SELECT balance::float b FROM farmer_advances WHERE id=$1", [b.id]))[0].b;
  check(bDb === 40, "B4. los $40 que sobran quedan de anticipo", bDb);
  check(Math.abs((await saldo()) - (s1 - 100)) < 0.01, "B5. salen $100 de la caja");

  // ── C. Anular la entrega ──
  const mov = (await q("SELECT id FROM cash_movements WHERE reference_type='farmer_advances' AND reference_id=$1", [a.id]))[0];
  const rev = await api("POST", `/cash/movements/${mov.id}/reverse`, { reason: "SIM anular anticipo" }, matriz);
  check(rev.ok, "C1. anular el anticipo de $175", rev.ok ? undefined : mostrar(rev));
  const adv = (await q("SELECT balance::float b, status FROM farmer_advances WHERE id=$1", [a.id]))[0];
  check(Math.abs((await saldo()) - (s0 - 100)) < 0.01, "C2. vuelven los $175 a la caja", await saldo());
  check(adv.status === "CANCELLED" && adv.b === 0, "C3. el anticipo queda cancelado (ya no se le descuenta)", adv);
  // Anular la entrega que pagó deuda: la deuda vuelve a deberse.
  const movB = (await q("SELECT id FROM cash_movements WHERE reference_type='farmer_advances' AND reference_id=$1", [b.id]))[0];
  exigir(await api("POST", `/cash/movements/${movB.id}/reverse`, { reason: "SIM anular pago de cáscara" }, matriz), "C4. anular la entrega de $100");
  const apC = (await q("SELECT balance::float b, status FROM accounts_payable WHERE id=$1", [ap]))[0];
  const advB = (await q("SELECT balance::float b, status FROM farmer_advances WHERE id=$1", [b.id]))[0];
  check(apC.b === 60 && apC.status === "CONFIRMED" && advB.status === "CANCELLED", "C5. la deuda de $60 vuelve y el anticipo queda cancelado", { apC, advB });
  check(Math.abs((await saldo()) - s0) < 0.01, "C6. la caja vuelve a como estaba");

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
