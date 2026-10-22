// 📝 Venta detalle FIADA (pedido del dueño 2026-10-21): «¿Cómo paga?» todo / fiado / una parte. Lo que falta queda Por
// Cobrar del DUEÑO del arroz a nombre de la persona; lo pagado entra a la caja (si el arroz es de otro socio, como
// cobro recibido por él: la caja se lo debe). SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const corr = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-CORRIENTE'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  for (const acc of [stalyn, matriz]) {
    await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',10,'QQ','OWNED',$3,'sim venta fiada')", [corr, wh, acc]);
  }
  const stock = async (acc) => Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id=$1 AND warehouse_id=$2 AND accionista_id=$3 AND ownership='OWNED'", [corr, wh, acc]))[0].s);
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "MIXTO", opening_balance_cash: 100, opening_balance_bank: 0 }, matriz), "0. caja de CEYRO");
  const saldo = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s);
  const cxcDeVenta = async (saleId) => (await q("SELECT accionista_id, balance::float b, amount::float a, status::text st FROM accounts_receivable WHERE sale_id=$1", [saleId]))[0];
  const base = { cash_register_id: caja.id, product_id: corr, warehouse_id: wh, quantity_qq: 1, total_amount: 45, price_per_pound: 0.45, mode: "QQ", input_amount: 1, product_name: "Corriente" };

  // A. Arroz de CEYRO fiado del todo
  const c0 = await saldo(), sC0 = await stock(matriz);
  const a = exigir(await api("POST", "/sales/retail", { ...base, buyer: { full_name: "SIM PEDRO FIADO" }, pagado: 0 }, matriz), "A1. CEYRO vende $45 fiado a SIM PEDRO FIADO");
  check(a.credito?.debe === 45 && a.credito?.pagado === 0, "A2. queda debiendo $45", a.credito);
  const ca = await cxcDeVenta(a.id);
  check(ca?.accionista_id === matriz && ca.b === 45, "A3. Por Cobrar de CEYRO a SIM PEDRO FIADO por $45", ca);
  check(Math.abs((await saldo()) - c0) < 0.01, "A4. la caja no cambia (no pagó nada)");
  check(Math.abs((await stock(matriz)) - (sC0 - 1)) < 0.001, "A5. sale 1 QQ del inventario de CEYRO");

  // B. Arroz de CEYRO: pagó $20 por transferencia y debe $25
  const c1 = await saldo();
  const b = exigir(await api("POST", "/sales/retail", { ...base, buyer: { full_name: "SIM ANA PARTE" }, pagado: 20, medio: "BANCO" }, matriz), "B1. CEYRO vende $45: paga $20 por transferencia");
  check(b.credito?.debe === 25 && b.credito?.pagado === 20, "B2. queda debiendo $25", b.credito);
  const cb = await cxcDeVenta(b.id);
  check(cb?.accionista_id === matriz && cb.a === 45 && cb.b === 25 && cb.st === "PARTIAL", "B3. su Por Cobrar: $45 con abono de $20 (saldo $25)", cb);
  check(Math.abs((await saldo()) - (c1 + 20)) < 0.01, "B4. entran $20 a la caja de CEYRO");
  const movB = (await q("SELECT category, medio FROM cash_movements WHERE cash_register_id=$1 ORDER BY created_at DESC LIMIT 1", [caja.id]))[0];
  check(movB.category === "COBRO_CREDITO" && movB.medio === "BANCO", "B5. entra como abono del crédito, por el banco", movB);

  // C. Arroz de STALYN, la caja de CEYRO cobra $10 y el resto queda Por Cobrar de STALYN
  const c2 = await saldo(), sS0 = await stock(stalyn);
  const c = exigir(await api("POST", "/sales/retail", { ...base, buyer: { full_name: "SIM LUIS SOCIO" }, pagado: 10, dueno_id: stalyn, medio: "EFECTIVO" }, matriz), "C1. CEYRO vende $45 de arroz de STALYN: paga $10");
  check(c.dueno === "STALYN" && c.credito?.debe === 35 && c.se_lo_debes === 10, "C2. el cliente le debe $35 a STALYN y CEYRO le debe $10", c);
  const cc = await cxcDeVenta(c.id);
  check(cc?.accionista_id === stalyn && cc.b === 35, "C3. Por Cobrar de STALYN al cliente por $35", cc);
  check(Math.abs((await stock(stalyn)) - (sS0 - 1)) < 0.001, "C4. sale 1 QQ del inventario de STALYN");
  check(Math.abs((await saldo()) - (c2 + 10)) < 0.01, "C5. entran $10 a la caja de CEYRO");
  const movC = (await q("SELECT id, category FROM cash_movements WHERE cash_register_id=$1 ORDER BY created_at DESC LIMIT 1", [caja.id]))[0];
  const parC = (await q("SELECT (SELECT balance::float FROM accounts_receivable WHERE reference_type='cobro_por_socio' AND reference_id=$1 AND accionista_id=$2) cxc, (SELECT balance::float FROM accounts_payable WHERE reference_type='cobro_por_socio' AND reference_id=$1 AND accionista_id=$3) cxp", [movC.id, stalyn, matriz]))[0];
  check(movC.category === "COBRO_POR_SOCIO" && parC.cxc === 10 && parC.cxp === 10, "C6. los $10 son cobro para STALYN: CEYRO se los debe", { movC, parC });

  // D. Fiado sin nombre de persona: no
  const d = await api("POST", "/sales/retail", { ...base, buyer: { full_name: "Consumidor final" }, pagado: 0 }, matriz);
  check(d.status === 400, "D1. no se fía a «Consumidor final»", mostrar(d));
  // E. Pagó todo: igual que antes
  const e = exigir(await api("POST", "/sales/retail", { ...base, buyer: { full_name: "SIM CONTADO" } }, matriz), "E1. venta de contado como siempre");
  check(!e.credito && !(await cxcDeVenta(e.id)), "E2. sin Por Cobrar");

  // F. Después la persona paga lo que debe (Por Cobrar): queda en $0
  const arA = (await q("SELECT id FROM accounts_receivable WHERE sale_id=$1", [a.id]))[0].id;
  exigir(await api("POST", "/receivable/pay-group", { receivable_ids: [arA], amount: 45, cash_register_id: caja.id }, matriz), "F1. SIM PEDRO FIADO paga sus $45 en Por Cobrar");
  check((await cxcDeVenta(a.id)).b === 0, "F2. ya no debe nada");

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
