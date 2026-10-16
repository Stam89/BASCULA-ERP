// 📲 Pedido pagado por TRANSFERENCIA / CHEQUE: al despachar NO entra a la caja; queda «por confirmar» hasta que el de
// caja vea que llegó (entonces entra al banco). «No llegó» lo deja como deuda del cliente. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
import fs from "fs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const SOBRE = { "X-Confirmar-Sobregiro": "1", "X-Confirmar": "SOBREGIRO" };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261107_transferencia_por_confirmar.sql", import.meta.url), "utf8"));
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const bod = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',20,'QQ','OWNED',$3,'sim transferencia')", [prod, bod, matriz]);
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim", tipo: "MIXTO", opening_balance_cash: 100, opening_balance_bank: 100 }, matriz), "0. caja mixta");
  const saldo = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s);
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE TRANSFERENCIA" }, matriz), "0b. cliente");
  const pedido = async (metodo, qq, precio) => {
    const p = exigir(await api("POST", "/orders", { customer_id: cli.id, payment_method: metodo, items: [{ product_id: prod, inventory_product_id: prod, quantity: qq, unit_price: precio }] }, matriz), `pedido ${metodo}`);
    exigir(await api("PATCH", `/orders/${p.id}/prepare`, { prepared: true, warehouse_id: bod }, matriz), "preparar");
    return p;
  };
  const p1 = await pedido("TRANSFER", 2, 50);
  const s0 = await saldo();
  const d1 = exigir(await api("POST", `/orders/${p1.id}/deliver`, { payment_method: "TRANSFER", warehouse_id: bod }, matriz), "A1. despachar por transferencia SIN caja");
  check(d1.por_confirmar === "TRANSFER", "A2. queda por confirmar", d1.por_confirmar);
  check(Math.abs((await saldo()) - s0) < 0.01, "A3. NO entra nada a la caja todavía");
  const lista = exigir(await api("GET", "/receivable/por-confirmar", undefined, matriz), "A4. lista de por confirmar");
  const t1 = lista.find((x) => x.order_number === p1.order_number);
  check(t1 && t1.monto === 100 && t1.cliente === "SIM CLIENTE TRANSFERENCIA", "A5. aparece el pedido con su cliente y monto", t1);
  exigir(await api("POST", `/receivable/${t1.id}/pay`, { amount: 100, cash_register_id: caja.id, medio_pago: "BANCO", concepto: "Transferencia confirmada" }, matriz, SOBRE), "B1. el de caja confirma que llegó");
  check(Math.abs((await saldo()) - (s0 + 100)) < 0.01, "B2. ahora sí entran $100 a la caja");
  const ult = (await q("SELECT medio FROM cash_movements WHERE cash_register_id=$1 ORDER BY created_at DESC LIMIT 1", [caja.id]))[0];
  check(ult.medio === "BANCO", "B3. por el banco", ult);
  check(!(await api("GET", "/receivable/por-confirmar", undefined, matriz)).data.some((x) => x.id === t1.id), "B4. sale de la lista de por confirmar");
  // Otro que no llega
  const p2 = await pedido("CHECK", 1, 40);
  exigir(await api("POST", `/orders/${p2.id}/deliver`, { payment_method: "CHECK", warehouse_id: bod }, matriz), "C1. despachar con cheque");
  const t2 = (await api("GET", "/receivable/por-confirmar", undefined, matriz)).data.find((x) => x.order_number === p2.order_number);
  check(t2?.por_confirmar === "CHECK", "C2. cheque por confirmar", t2);
  exigir(await api("POST", `/receivable/${t2.id}/no-llego`, {}, matriz), "C3. no llegó");
  const ar = (await q("SELECT balance::float b, status::text s, por_confirmar FROM accounts_receivable WHERE id=$1", [t2.id]))[0];
  check(ar.b === 40 && ar.por_confirmar === null, "C4. queda como deuda del cliente en Por Cobrar ($40)", ar);
  // Efectivo sigue igual
  const p3 = await pedido("CASH", 1, 30);
  const s3 = await saldo();
  exigir(await api("POST", `/orders/${p3.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: bod }, matriz), "D1. despachar en efectivo");
  check(Math.abs((await saldo()) - (s3 + 30)) < 0.01, "D2. el efectivo entra a la caja al despachar (como siempre)");
  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
