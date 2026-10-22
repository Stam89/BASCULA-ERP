// 📝 Venta detalle «Decidir después» FIADA (pedido del dueño 2026-10-22): a un conocido se le fía sin saber todavía de
// quién es el arroz. Lo que paga entra a la caja; al asignar nace la venta A CRÉDITO del dueño a nombre del cliente y lo
// pagado se le abona. Si el dueño es un socio, CEYRO le debe lo cobrado. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(n * 100) / 100;
try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-CORRIENTE'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  for (const acc of [stalyn, matriz]) {
    await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',5,'QQ','OWNED',$3,'sim por asignar fiada')", [prod, wh, acc]);
  }
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 100 }, matriz), "0. caja de CEYRO");
  const saldo = async () => r2(Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s));
  const vender = (total, nombre, extra = {}) => api("POST", "/sales/retail", {
    cash_register_id: caja.id, product_id: prod, warehouse_id: wh, quantity_qq: r2(total / 50), total_amount: total, price_per_pound: 0.5,
    mode: "DOLARES", input_amount: total, product_name: "Corriente", buyer: { full_name: nombre }, por_asignar: true, ...extra
  }, matriz);
  const cxcDe = async (saleId) => (await q("SELECT accionista_id, amount::float a, balance::float b, status FROM accounts_receivable WHERE sale_id=$1 AND status <> 'CANCELLED'", [saleId]))[0];

  // A. Fiado total y pago parcial, sin dueño todavía
  const c0 = await saldo();
  const cf = await vender(10, "Consumidor final", { pagado: 0 });
  check(cf.status === 400, "A0. no se fía a «Consumidor final»", mostrar(cf));
  const f1 = exigir(await vender(10, "SIM FIADO TOTAL", { pagado: 0 }), "A1. $10 fiado, decidir después");
  check(f1.credito?.debe === 10 && f1.credito?.pagado === 0, "A2. responde que queda debiendo $10", f1.credito);
  const p1 = exigir(await vender(20, "SIM PAGA PARTE", { pagado: 8 }), "A3. $20 pagando $8, decidir después");
  check(Math.abs((await saldo()) - (c0 + 8)) < 0.01, "A4. a la caja entran solo los $8 pagados");
  const pend = exigir(await api("GET", "/sales/retail/por-asignar", undefined, matriz), "A5. lista");
  const vf = pend.ventas.find((v) => v.id === f1.id), vp = pend.ventas.find((v) => v.id === p1.id);
  check(vf && vf.pagado === 0 && !vf.en_caja && vp && vp.pagado === 8 && vp.en_caja, "A6. la lista muestra lo pagado de cada una", { vf, vp });

  // B. Asignar la de pago parcial a STALYN: venta a crédito de STALYN, abono $8, CEYRO le debe $8
  const b = exigir(await api("POST", "/sales/retail/por-asignar/asignar", { ids: [p1.id], dueno_id: stalyn }, matriz), "B1. asignar a STALYN");
  check(b.se_lo_debes === 8 && b.fiado === 12, "B2. CEYRO le debe $8 y quedaron fiados $12", b);
  const saleP = (await q("SELECT sale_id FROM ventas_detalle_por_asignar WHERE id=$1", [p1.id]))[0].sale_id;
  const cxcP = await cxcDe(saleP);
  check(cxcP?.accionista_id === stalyn && cxcP.a === 20 && cxcP.b === 12, "B3. Por Cobrar de STALYN al cliente: $20, saldo $12", cxcP);
  const movP = (await q("SELECT category, reference_type FROM cash_movements WHERE id=(SELECT cash_movement_id FROM ventas_detalle_por_asignar WHERE id=$1)", [p1.id]))[0];
  check(movP.category === "COBRO_POR_SOCIO" && movP.reference_type === "accounts_receivable", "B4. en caja: cobro para STALYN aplicado a esa cuenta", movP);
  const deuda = (await q("SELECT COALESCE(SUM(balance),0)::float b FROM accounts_payable WHERE accionista_id=$1 AND reference_type='cobro_por_socio' AND reference_id=(SELECT cash_movement_id FROM ventas_detalle_por_asignar WHERE id=$2)", [matriz, p1.id]))[0].b;
  check(deuda === 8, "B5. Por Pagar de CEYRO a STALYN: $8", deuda);

  // C. Asignar el fiado total a CEYRO: venta a crédito de CEYRO por $10, sin caja
  exigir(await api("POST", "/sales/retail/por-asignar/asignar", { ids: [f1.id], dueno_id: matriz }, matriz), "C1. asignar el fiado a CEYRO");
  const cxcF = await cxcDe((await q("SELECT sale_id FROM ventas_detalle_por_asignar WHERE id=$1", [f1.id]))[0].sale_id);
  check(cxcF?.accionista_id === matriz && cxcF.b === 10, "C2. Por Cobrar de CEYRO al cliente: $10", cxcF);
  check(Math.abs((await saldo()) - (c0 + 8)) < 0.01, "C3. la caja no cambia al asignar");

  // D. Anular: una fiada sin abono se anula en la lista; una con abono, en Caja
  const f2 = exigir(await vender(6, "SIM ANULAR", { pagado: 0 }), "D1. otra fiada sin abono");
  exigir(await api("POST", `/sales/retail/por-asignar/${f2.id}/anular`, {}, matriz), "D2. se anula desde la lista");
  const p2 = exigir(await vender(6, "SIM ANULAR 2", { pagado: 2 }), "D3. una con abono de $2");
  const noDeja = await api("POST", `/sales/retail/por-asignar/${p2.id}/anular`, {}, matriz);
  check(noDeja.status === 409, "D4. si cobró algo, se anula en Caja", mostrar(noDeja));
  const movP2 = (await q("SELECT cash_movement_id FROM ventas_detalle_por_asignar WHERE id=$1", [p2.id]))[0].cash_movement_id;
  exigir(await api("POST", `/cash/movements/${movP2}/reverse`, { reason: "SIM anular" }, matriz), "D5. anular el abono en Caja");
  const quedan = exigir(await api("GET", "/sales/retail/por-asignar", undefined, matriz), "D6. lista").ventas.filter((v) => [f2.id, p2.id].includes(v.id));
  check(quedan.length === 0, "D7. ya no están por asignar");

  // E. Anular el cobro de STALYN en Caja: la cuenta del cliente vuelve a $20 y CEYRO ya no le debe
  const movB = (await q("SELECT cash_movement_id FROM ventas_detalle_por_asignar WHERE id=$1", [p1.id]))[0].cash_movement_id;
  exigir(await api("POST", `/cash/movements/${movB}/reverse`, { reason: "SIM anular abono" }, matriz), "E1. anular el abono asignado a STALYN");
  const cxcP2 = await cxcDe(saleP);
  check(cxcP2?.b === 20, "E2. el cliente vuelve a deber $20 a STALYN", cxcP2);

  const h = await revisar(q);
  check(h.length === 0, "F. integridad sin hallazgos", h.map((y) => y.regla + " " + JSON.stringify(y.filas ?? y.error).slice(0, 250)));
} catch (err) { console.log("ERROR", err?.stack ?? err); check(false, "excepción"); } finally {
  const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0);
}
