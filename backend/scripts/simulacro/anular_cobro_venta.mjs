// 🧾 Anular el cobro de una venta (pedido del dueño 2026-11-12: «anulé el cobro de una venta y no volvió a Por Cobrar»).
// Pedido despachado y cobrado en efectivo → al anular, su cuenta vuelve a deber. Venta de contado a un cliente con nombre
// → nace su Por Cobrar. Consumidor final → solo la anulación. Luego se cobra otra vez normal. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(n * 100) / 100;
try {
  const p011 = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const flor = (await q("SELECT id FROM products WHERE name='Flor'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',30,'QQ','OWNED',$3,'sim anular cobro')", [p011, wh, matriz]);
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim anular", tipo: "EFECTIVO", opening_balance_cash: 100 }, matriz), "0. caja");
  const saldo = async () => r2(Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s));
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE ANULAR" }, matriz), "0b. cliente");

  // A. Pedido despachado y cobrado en efectivo → se anula el cobro
  const ped = exigir(await api("POST", "/orders", { customer_id: cli.id, payment_method: "CASH", items: [{ product_id: flor, inventory_product_id: p011, presentation_name: "100lb", quantity: 5, unit_price: 46 }] }, matriz), "A1. pedido de $230");
  exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true }, matriz), "A2. preparar");
  const c0 = await saldo();
  exigir(await api("POST", `/orders/${ped.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh }, matriz), "A3. despachar cobrando en efectivo");
  check(r2((await saldo()) - c0) === 230, "A4. entraron $230 a la caja");
  const o = (await q("SELECT receivable_id, sale_id FROM sales_orders WHERE id=$1", [ped.id]))[0];
  const ar0 = (await q("SELECT balance::float b, status FROM accounts_receivable WHERE id=$1", [o.receivable_id]))[0];
  check(ar0.b === 0 && ar0.status === "PAID", "A5. la cuenta del pedido queda pagada", ar0);
  const mov = (await q("SELECT id FROM cash_movements WHERE reference_type='sales' AND reference_id=$1 AND category='VENTA'", [o.sale_id]))[0];
  const rev = exigir(await api("POST", `/cash/movements/${mov.id}/reverse`, { reason: "sim mal cobro" }, matriz), "A6. anular el cobro");
  check(r2((await saldo()) - c0) === 0, "A7. la caja vuelve a como estaba");
  const ar1 = (await q("SELECT balance::float b, status FROM accounts_receivable WHERE id=$1", [o.receivable_id]))[0];
  check(ar1.b === 230 && ar1.status === "CONFIRMED", "A8. el cliente vuelve a deber $230 en Por Cobrar", ar1);
  check(rev.venta_vuelve_a_deber?.monto === 230, "A9. la respuesta lo dice", rev.venta_vuelve_a_deber);
  exigir(await api("POST", `/receivable/${o.receivable_id}/pay`, { amount: 230, cash_register_id: caja.id }, matriz), "A10. se cobra otra vez normal");
  check((await q("SELECT status FROM accounts_receivable WHERE id=$1", [o.receivable_id]))[0].status === "PAID" && r2((await saldo()) - c0) === 230, "A11. queda pagado y la plata en caja");

  // B. Venta de contado a un cliente con nombre → nace su Por Cobrar
  const v = exigir(await api("POST", "/sales", { customer_id: cli.id, cash_register_id: caja.id, payment_method: "CASH", items: [{ product_id: p011, warehouse_id: wh, quantity: 1, unit_price: 45 }] }, matriz), "B1. venta de contado $45");
  const sid = v.id ?? v.sale?.id;
  const mv = (await q("SELECT id FROM cash_movements WHERE reference_type='sales' AND reference_id=$1 AND category='VENTA'", [sid]))[0];
  check(Boolean(mv), "B2. tiene su ingreso de venta");
  if (mv) {
    exigir(await api("POST", `/cash/movements/${mv.id}/reverse`, { reason: "sim no pagó" }, matriz), "B3. anular el cobro");
    const nueva = await q("SELECT amount::float a, balance::float b, reference_type FROM accounts_receivable WHERE sale_id=$1 AND status<>'CANCELLED'", [sid]);
    check(nueva.length === 1 && nueva[0].b === 45 && nueva[0].reference_type === "cobro_anulado", "B4. nace su Por Cobrar de $45", nueva);
  }

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas).slice(0, 250)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
