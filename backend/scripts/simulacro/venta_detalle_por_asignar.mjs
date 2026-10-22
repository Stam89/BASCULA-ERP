// 🕒 Venta detalle «Decidir después» (pedido del dueño 2026-10-21): se cobra ahora sin dueño (la plata entra a la caja,
// el inventario no se toca) y al cierre se asigna a quien tenga el arroz: sale de SU inventario y, si es de un socio,
// la caja de CEYRO se lo queda debiendo (Por Cobrar del socio). SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(n * 100) / 100;
try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0]?.id ?? (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-CORRIENTE'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  const stock = async (acc) => r2(Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id=$1 AND warehouse_id=$2 AND accionista_id=$3 AND ownership='OWNED'", [prod, wh, acc]))[0].s));
  // En la COPIA: STALYN con 5 QQ más y CEYRO sin nada de este producto
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',5,'QQ','OWNED',$3,'sim por asignar')", [prod, wh, stalyn]);
  const sC = await stock(matriz);
  if (sC !== 0) await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',$3,'QQ','OWNED',$4,'sim por asignar: CEYRO en 0')", [prod, wh, -sC, matriz]);
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "MIXTO", opening_balance_cash: 100, opening_balance_bank: 0 }, matriz), "0. caja de CEYRO");
  const saldo = async () => r2(Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s));
  const vender = (qq, total, nombre, extra = {}) => api("POST", "/sales/retail", { cash_register_id: caja.id, product_id: prod, warehouse_id: wh, quantity_qq: qq, total_amount: total, price_per_pound: r2(total / qq / 100), mode: "DOLARES", input_amount: total, product_name: "0.11", buyer: { full_name: nombre }, por_asignar: true, ...extra }, matriz);

  // A. Tres ventas «decidir después»
  const c0 = await saldo(), sS0 = await stock(stalyn), sC0 = await stock(matriz);
  const v1 = exigir(await vender(0.1, 5, "SIM UNO"), "A1. venta de $5 sin decidir el dueño");
  const v2 = exigir(await vender(0.2, 10, "SIM DOS"), "A2. venta de $10 sin decidir");
  const v3 = exigir(await vender(0.5, 25, "SIM TRES", { medio: "BANCO" }), "A3. venta de $25 por transferencia sin decidir");
  check(v1.por_asignar && v2.por_asignar && v3.por_asignar, "A4. quedan por asignar");
  check(Math.abs((await saldo()) - (c0 + 40)) < 0.01, "A5. los $40 ya están en la caja de CEYRO");
  check((await stock(stalyn)) === sS0 && (await stock(matriz)) === sC0, "A6. ningún inventario se mueve todavía");
  const cat = await q("SELECT DISTINCT category FROM cash_movements WHERE reference_type='venta_detalle_por_asignar' AND cash_register_id=$1", [caja.id]);
  check(cat.length === 1 && cat[0].category === "VENTA_DETALLE_POR_ASIGNAR", "A7. en caja figuran como «venta detalle por asignar»", cat);
  const pend = exigir(await api("GET", "/sales/retail/por-asignar", undefined, matriz), "A8. lista de por asignar");
  check(pend.ventas.length === 3 && pend.stock.some((s) => s.accionista_id === stalyn && s.qq >= 5), "A9. 3 ventas y cuánto arroz tiene cada uno", { n: pend.ventas.length, stock: pend.stock.map((s) => s.qq) });
  const hoy = (await api("GET", "/dashboard/hoy", undefined, matriz)).data;
  const tareas = Array.isArray(hoy) ? hoy : (hoy?.tareas ?? []);
  check(tareas.some((t) => t.key === "ventas-por-asignar"), "A10. «Hoy» avisa que hay ventas por asignar", tareas.map((t) => t.key));

  // B. Asignar las dos primeras a STALYN
  exigir(await api("POST", "/sales/retail/por-asignar/asignar", { ids: [v1.id, v2.id], dueno_id: stalyn }, matriz), "B1. asignar $5 + $10 a STALYN");
  check(r2(await stock(stalyn)) === r2(sS0 - 0.3), "B2. salen 0.3 QQ del inventario de STALYN");
  const movsB = await q("SELECT category, reference_type FROM cash_movements WHERE id IN (SELECT cash_movement_id FROM ventas_detalle_por_asignar WHERE id = ANY($1::uuid[]))", [[v1.id, v2.id]]);
  check(movsB.every((m) => m.category === "COBRO_POR_SOCIO" && m.reference_type === "sales"), "B3. en caja pasan a cobro para STALYN", movsB);
  const debe = (await q("SELECT COALESCE(SUM(p.balance),0)::float b FROM accounts_payable p WHERE p.accionista_id=$1 AND p.reference_type='cobro_por_socio' AND p.reference_id IN (SELECT cash_movement_id FROM ventas_detalle_por_asignar WHERE id = ANY($2::uuid[]))", [matriz, [v1.id, v2.id]]))[0].b;
  check(debe === 15, "B4. CEYRO le debe $15 a STALYN (Por Pagar ↔ Por Cobrar)", debe);
  const ventasS = await q("SELECT count(*)::int n FROM sales WHERE id IN (SELECT sale_id FROM ventas_detalle_por_asignar WHERE id = ANY($1::uuid[])) AND accionista_id=$2", [[v1.id, v2.id], stalyn]);
  check(ventasS[0].n === 2, "B5. las ventas quedan en las ventas de STALYN");
  check(Math.abs((await saldo()) - (c0 + 40)) < 0.01, "B6. la caja no cambia al asignar");

  // C. Asignar la tercera a CEYRO sin arroz: no deja; con arroz sí (como venta suya)
  const sinArroz = await api("POST", "/sales/retail/por-asignar/asignar", { ids: [v3.id], dueno_id: matriz }, matriz);
  check(sinArroz.status === 409 && /no tiene suficiente/.test(sinArroz.data?.error ?? ""), "C1. CEYRO no tiene ese arroz: no se asigna", sinArroz.data?.error);
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',1,'QQ','OWNED',$3,'sim por asignar')", [prod, wh, matriz]);
  exigir(await api("POST", "/sales/retail/por-asignar/asignar", { ids: [v3.id], dueno_id: matriz }, matriz), "C2. con arroz, se asigna a CEYRO");
  const m3 = (await q("SELECT category FROM cash_movements WHERE id=(SELECT cash_movement_id FROM ventas_detalle_por_asignar WHERE id=$1)", [v3.id]))[0];
  check(m3.category === "VENTA" && (await stock(matriz)) === r2(1 - 0.5), "C3. queda como venta de CEYRO y sale de su inventario", { m3, s: await stock(matriz) });
  const otraVez = await api("POST", "/sales/retail/por-asignar/asignar", { ids: [v3.id], dueno_id: stalyn }, matriz);
  check(otraVez.status === 409, "C4. no se asigna dos veces", otraVez.status);

  // D. Reglas y anulación
  const fiado = await vender(0.1, 5, "SIM FIADO", { pagado: 0 });
  check(fiado.status === 400, "D1. «Decidir después» no se puede fiar", mostrar(fiado));
  const v4 = exigir(await vender(0.1, 5, "SIM ANULAR"), "D2. otra venta por asignar");
  const mov4 = (await q("SELECT cash_movement_id id FROM ventas_detalle_por_asignar WHERE id=$1", [v4.id]))[0].id;
  exigir(await api("POST", `/cash/movements/${mov4}/reverse`, { reason: "SIM se cobró mal" }, matriz), "D3. anular en Caja la venta por asignar");
  const p2 = exigir(await api("GET", "/sales/retail/por-asignar", undefined, matriz), "D4. lista");
  check(p2.ventas.length === 0, "D5. ya no queda nada por asignar", p2.ventas.length);

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
