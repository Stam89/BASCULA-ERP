// 🏦 Efectivo o banco en cada operación (ventas, cobros, pagos, anticipos, fomentos): el medio elegido llega al
// movimiento de caja (y al espejo del otro socio); una caja de un solo medio no cambia. SOLO contra la copia.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const SOBRE = { "x-confirmar": "SOBREGIRO" };
const MIG = (f) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations", f);

try {
  if (!(await q("SELECT 1 FROM information_schema.columns WHERE table_name='cash_movements' AND column_name='medio'")).length) {
    await q(fs.readFileSync(MIG("20261085_caja_medio_arqueo.sql"), "utf8"));
  }
  await q(fs.readFileSync(MIG("20261086_medio_pago_operacion.sql"), "utf8")); // idempotente (reemplaza la función)
  const ceyro = matriz;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const cajaC = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO mixta", tipo: "MIXTO", opening_balance_cash: 1000, opening_balance_bank: 1000 }, ceyro), "0. caja MIXTA de CEYRO");
  const cajaS = exigir(await api("POST", "/cash/registers/open", { name: "Caja STALYN mixta", tipo: "MIXTO", opening_balance_cash: 1000, opening_balance_bank: 1000 }, stalyn), "0b. caja MIXTA de STALYN");
  const ultimo = async (cajaId) => (await q("SELECT medio, category, amount::float a FROM cash_movements WHERE cash_register_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1", [cajaId]))[0];

  // ── A. Pago entre socios por el banco: los dos lados quedan en banco ──
  const ref = (await q("SELECT gen_random_uuid() id"))[0].id;
  await q("INSERT INTO accounts_receivable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'saldo_inicial_socio',$2,'sim medio',80,80,'CONFIRMED')", [ceyro, ref]);
  const ap = (await q("INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'saldo_inicial_socio',$2,'sim medio',80,80,'CONFIRMED') RETURNING id", [stalyn, ref]))[0].id;
  exigir(await api("POST", `/cash/payables/${ap}/pay`, { amount: 80, cash_register_id: cajaS.id, medio_pago: "BANCO" }, stalyn, SOBRE), "A1. STALYN le paga $80 a CEYRO por transferencia");
  const pS = await ultimo(cajaS.id), pC = await ultimo(cajaC.id);
  check(pS.medio === "BANCO" && pS.a === 80 && pC.medio === "BANCO" && pC.a === 80, "A2. sale del banco de STALYN y entra al banco de CEYRO (el espejo también)", { stalyn: pS, ceyro: pC });

  // ── B. Venta despachada: transferencia → banco; efectivo → efectivo ──
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-OSO'"))[0].id;
  const bod = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',20,'simulacro','OWNED',$3)", [prod, bod, ceyro]);
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE MEDIO PAGO" }, ceyro), "B0. cliente");
  const vender = async (metodo) => {
    const p = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: prod, inventory_product_id: prod, quantity: 1, unit_price: 30 }] }, ceyro), `pedido (${metodo})`);
    exigir(await api("PATCH", `/orders/${p.id}/prepare`, { prepared: true, warehouse_id: bod }, ceyro), "preparar");
    exigir(await api("POST", `/orders/${p.id}/deliver`, { payment_method: metodo, cash_register_id: cajaC.id, warehouse_id: bod }, ceyro, SOBRE), `B. despachar con ${metodo}`);
    return ultimo(cajaC.id);
  };
  const vT = await vender("TRANSFER");
  check(vT.medio === "BANCO" && vT.a === 30, "B1. venta por transferencia → entra al BANCO (antes entraba como efectivo)", vT);
  const vE = await vender("CASH");
  check(vE.medio === "EFECTIVO", "B2. venta en efectivo → efectivo", vE);

  // ── C. Cobro de un cliente por el banco ──
  const ar = (await q("INSERT INTO accounts_receivable (accionista_id, customer_id, reference_type, description, amount, balance, status) VALUES ($1,$2,'sales','sim cobro',50,50,'CONFIRMED') RETURNING id", [ceyro, cli.id]))[0].id;
  exigir(await api("POST", "/receivable/pay-group", { receivable_ids: [ar], amount: 50, cash_register_id: cajaC.id, medio_pago: "BANCO" }, ceyro), "C1. el cliente paga $50 por transferencia");
  check((await ultimo(cajaC.id)).medio === "BANCO", "C2. el cobro entra al banco");

  // ── D. Anticipo en efectivo (sin elegir = efectivo) ──
  const farmer = (await q("SELECT id FROM farmers LIMIT 1"))[0].id;
  const ant = await api("POST", "/advances", { farmer_id: farmer, amount: 10, concept: "sim", cash_register_id: cajaC.id }, ceyro, SOBRE);
  if (ant.ok) check((await ultimo(cajaC.id)).medio === "EFECTIVO", "D1. sin elegir, el anticipo sale en efectivo");

  // ── E. Una caja de EFECTIVO no cambia aunque se pida banco ──
  exigir(await api("POST", `/cash/registers/${cajaS.id}/close`, {}, stalyn), "E0. cerrar la caja mixta de STALYN");
  const cajaE = exigir(await api("POST", "/cash/registers/open", { name: "Caja STALYN efectivo", tipo: "EFECTIVO", opening_balance_cash: 500 }, stalyn), "E1. caja de solo efectivo");
  const ap2 = (await q("INSERT INTO accounts_payable (accionista_id, reference_type, description, amount, balance, status) VALUES ($1,'gasto_credito','sim',5,5,'CONFIRMED') RETURNING id", [stalyn]))[0].id;
  exigir(await api("POST", `/cash/payables/${ap2}/pay`, { amount: 5, cash_register_id: cajaE.id, medio_pago: "BANCO" }, stalyn, SOBRE), "E2. pagar pidiendo «banco» desde una caja de solo efectivo");
  check((await ultimo(cajaE.id)).medio === "EFECTIVO", "E3. queda en efectivo (esa caja no tiene banco)");

  const sC = (await api("GET", `/cash/registers/${cajaC.id}/summary`, undefined, ceyro)).data;
  check(sC.saldo_banco === 1000 + 80 + 30 + 50 && sC.saldo_efectivo === 1000 + 30 - (ant.ok ? 10 : 0), "F1. la caja de CEYRO cuadra por medio: banco +$160, efectivo +$30 (−$10 del anticipo)", { banco: sC.saldo_banco, efectivo: sC.saldo_efectivo });

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
