// 🤝 «¿De quién es el arroz?»: la caja de CEYRO vende al detalle arroz de STALYN. El arroz sale del inventario de
// STALYN y la venta es suya; el dinero entra a la caja de CEYRO y CEYRO se lo debe. Anular lo deshace. SOLO copia.
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
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',10,'QQ','OWNED',$3,'sim venta detalle socio')", [corr, wh, stalyn]);
  const stock = async (acc) => Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id=$1 AND warehouse_id=$2 AND accionista_id=$3 AND ownership='OWNED'", [corr, wh, acc]))[0].s);
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 100 }, matriz), "0. caja de CEYRO");
  const saldo = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s);
  const sS0 = await stock(stalyn), sC0 = await stock(matriz), c0 = await saldo();
  const v = exigir(await api("POST", "/sales/retail", {
    cash_register_id: caja.id, product_id: corr, warehouse_id: wh, quantity_qq: 1, total_amount: 45, price_per_pound: 0.45,
    mode: "QQ", input_amount: 1, product_name: "Corriente", buyer: { full_name: "SIM CONSUMIDOR" }, dueno_id: stalyn
  }, matriz), "A1. CEYRO vende 1 QQ de corriente de STALYN por $45");
  check(v.dueno === "STALYN" && v.se_lo_debes === 45, "A2. la venta es de STALYN y CEYRO se lo debe", { d: v.dueno, s: v.se_lo_debes });
  check(Math.abs((await stock(stalyn)) - (sS0 - 1)) < 0.001 && Math.abs((await stock(matriz)) - sC0) < 0.001, "A3. sale 1 QQ del inventario de STALYN (no de CEYRO)");
  check(Math.abs((await saldo()) - (c0 + 45)) < 0.01, "A4. los $45 entran a la caja de CEYRO");
  const venta = (await q("SELECT accionista_id, sale_status FROM sales WHERE id=$1", [v.id]))[0];
  check(venta.accionista_id === stalyn, "A5. la venta queda en las ventas de STALYN", venta);
  const mov = (await q("SELECT id, category FROM cash_movements WHERE cash_register_id=$1 AND reference_type='sales' AND reference_id=$2", [caja.id, v.id]))[0];
  check(mov?.category === "COBRO_POR_SOCIO", "A6. en la caja de CEYRO es un cobro para otro socio (no venta de CEYRO)", mov);
  const par = (await q("SELECT (SELECT balance::float FROM accounts_receivable WHERE reference_type='cobro_por_socio' AND reference_id=$1 AND accionista_id=$2) cxc, (SELECT balance::float FROM accounts_payable WHERE reference_type='cobro_por_socio' AND reference_id=$1 AND accionista_id=$3) cxp", [mov.id, stalyn, matriz]))[0];
  check(par.cxc === 45 && par.cxp === 45, "A7. Por Cobrar de STALYN ↔ Por Pagar de CEYRO por $45", par);
  // Anular en Caja
  exigir(await api("POST", `/cash/movements/${mov.id}/reverse`, { reason: "SIM se registró mal" }, matriz), "B1. anular el cobro en la caja de CEYRO");
  check(Math.abs((await stock(stalyn)) - sS0) < 0.001, "B2. el arroz vuelve al inventario de STALYN");
  check(Math.abs((await saldo()) - c0) < 0.01, "B3. la plata sale de la caja de CEYRO");
  check((await q("SELECT sale_status FROM sales WHERE id=$1", [v.id]))[0].sale_status === "CANCELLED", "B4. la venta queda anulada");
  const est = (await q("SELECT (SELECT status::text FROM accounts_receivable WHERE reference_type='cobro_por_socio' AND reference_id=$1) a, (SELECT status::text FROM accounts_payable WHERE reference_type='cobro_por_socio' AND reference_id=$1) p", [mov.id]))[0];
  check(est.a === "CANCELLED" && est.p === "CANCELLED", "B5. la deuda entre los dos se anula", est);
  // Sin dueño: venta de CEYRO como siempre (sin stock propio → rechaza)
  const propia = await api("POST", "/sales/retail", { cash_register_id: caja.id, product_id: corr, warehouse_id: wh, quantity_qq: 999, total_amount: 45, price_per_pound: 0.45, mode: "QQ", input_amount: 1, product_name: "Corriente", buyer: { full_name: "SIM CONSUMIDOR" } }, matriz);
  check(!propia.ok, "C1. sin elegir dueño, sigue vendiendo del inventario de la caja (y valida su stock)", propia.status);
  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
