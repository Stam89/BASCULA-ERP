// 🚚 Despacho parcial (pedido del dueño 2026-10-23): el camión no se lleva todo. Se vende lo cargado y lo que queda pasa a
// un pedido SALDO (PED-…-S1) ya preparado en la Cola; inventario, sacos y cuenta del pedido se reparten. SOLO copia.
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
  const pol = (await q("SELECT id FROM products WHERE code='POLVILLO'"))[0]?.id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',30,'QQ','OWNED',$3,'sim parcial')", [p011, wh, matriz]);
  if (pol) await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',10,'QQ','OWNED',$3,'sim parcial')", [pol, wh, matriz]);
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim parcial", tipo: "EFECTIVO", opening_balance_cash: 100 }, matriz), "0. caja");
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE PARCIAL" }, matriz), "0. cliente");
  const items = [{ product_id: flor, inventory_product_id: p011, presentation_name: "100lb", quantity: 5, unit_price: 46 }];
  if (pol) items.push({ product_id: pol, inventory_product_id: pol, quantity: 2, unit_price: 20 });
  const ped = exigir(await api("POST", "/orders", { customer_id: cli.id, payment_method: "CASH", items }, matriz), "A1. pedido de 5 QQ Flor" + (pol ? " + 2 QQ polvillo" : ""));
  const stock = async (pid) => Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id=$1 AND warehouse_id=$2 AND accionista_id=$3 AND ownership='OWNED'", [pid, wh, matriz]))[0].s);
  const s0 = await stock(p011);
  exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true }, matriz), "A2. preparar el pedido (baja el inventario)");
  const s1 = await stock(p011);
  check(r2(s0 - s1) === 5, "A3. salen 5 QQ al preparar", { s0, s1 });
  const det = exigir(await api("GET", `/orders/${ped.id}`, undefined, matriz), "A4. detalle");
  const linFlor = det.items.find((i) => i.product_id === flor);
  const linPol = pol ? det.items.find((i) => i.product_id === pol) : null;

  // B. El camión carga 3 de 5 Flor y todo el polvillo: el cobro NO cambia (se cobra el pedido completo)
  const cargado = [{ item_id: linFlor.id, quantity: 3 }, ...(linPol ? [{ item_id: linPol.id, quantity: 2 }] : [])];
  const saldoCaja = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s);
  const c0 = await saldoCaja();
  const d = exigir(await api("POST", `/orders/${ped.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh, cargado }, matriz), "B1. despachar solo lo cargado");
  const totalPedido = r2(5 * 46 + (pol ? 2 * 20 : 0));
  check(d.saldo && d.saldo.qq === 2 && /-S1$/.test(d.saldo.order_number), "B2. queda la entrega pendiente de 2 QQ Flor como PED-…-S1", d.saldo);
  check(r2(Number(d.sale.total_amount)) === totalPedido, `B3. la venta es el pedido COMPLETO (${totalPedido}), como siempre`, d.sale.total_amount);
  check(r2((await saldoCaja()) - c0) === totalPedido, "B4. a la caja entra el pedido completo", { entro: r2((await saldoCaja()) - c0) });
  const sal = (await q("SELECT * FROM sales_orders WHERE order_number=$1", [d.saldo.order_number]))[0];
  check(sal.status === "PENDING" && sal.prepared_at && sal.parent_order_id === ped.id && sal.ya_cobrado === true && !sal.receivable_id,
    "B5. el saldo está pendiente, YA preparado, ya cobrado y sin cuenta por cobrar", { status: sal.status, ya: sal.ya_cobrado, ar: sal.receivable_id });
  check(r2(await stock(p011)) === r2(s1), "B6. el inventario no cambia: los 2 QQ del saldo siguen descontados (por despachar)", await stock(p011));
  const outSaldo = Number((await q("SELECT COALESCE(-SUM(quantity),0)::float q FROM inventory_movements WHERE reference_type='sales_order' AND reference_id=$1 AND movement='OUT'", [sal.id]))[0].q);
  check(outSaldo === 2, "B7. la salida de los 2 QQ ahora es del saldo", outSaldo);
  const arOrig = (await q("SELECT amount::float a, balance::float b, status FROM accounts_receivable WHERE id=(SELECT receivable_id FROM sales_orders WHERE id=$1)", [ped.id]))[0];
  check(arOrig.a === totalPedido && arOrig.b === 0, "B8. la cuenta del pedido queda completa y cobrada", arOrig);
  const cola = exigir(await api("GET", "/orders/cola-global", undefined, matriz), "B9. cola");
  check(cola.some((o) => o.id === sal.id), "B10. el saldo aparece en la Cola de Despachos");

  // C. Validaciones
  const sal2items = exigir(await api("GET", `/orders/${sal.id}`, undefined, matriz), "C0. detalle del saldo").items;
  const nada = await api("POST", `/orders/${sal.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh, cargado: [{ item_id: sal2items[0].id, quantity: 0 }] }, matriz);
  check(nada.status === 400, "C1. si el camión no lleva nada, no se despacha", mostrar(nada));
  const demas = await api("POST", `/orders/${sal.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh, cargado: [{ item_id: sal2items[0].id, quantity: 9 }] }, matriz);
  check(demas.status === 400, "C2. no se puede cargar más de lo pedido", mostrar(demas));
  const cancelar = await api("POST", `/orders/${sal.id}/cancel`, {}, matriz);
  check(cancelar.status === 409, "C3. el saldo ya cobrado no se cancela solo", mostrar(cancelar));

  // D. El próximo camión lleva el saldo: sin caja ni cobro, sin venta nueva
  const c2 = await saldoCaja();
  const d2 = exigir(await api("POST", `/orders/${sal.id}/deliver`, { payment_method: "CASH", warehouse_id: wh }, matriz), "D1. entregar el saldo (sin caja)");
  check(d2.entrega_ya_cobrada && d2.sale.id === d.sale.id, "D2. no hay venta nueva: la entrega queda ligada a la venta original", { ent: d2.entrega_ya_cobrada });
  check(r2((await saldoCaja()) - c2) === 0, "D3. la caja no cambia (ya se cobró)");
  check(r2(await stock(p011)) === r2(s1), "D4. el inventario no se mueve otra vez");
  const nVentas = (await q("SELECT count(*)::int n FROM sales WHERE customer_id=$1", [cli.id]))[0].n;
  check(nVentas === 1, "D5. el cliente tiene una sola venta", nVentas);

  // E. Anular el despacho de un pedido con saldo pendiente: se anula todo junto
  const ped2 = exigir(await api("POST", "/orders", { customer_id: cli.id, payment_method: "CASH", items: [items[0]] }, matriz), "E1. otro pedido de 5 QQ");
  exigir(await api("PATCH", `/orders/${ped2.id}/prepare`, { prepared: true }, matriz), "E2. preparar");
  const sE = await stock(p011);
  const lin2 = exigir(await api("GET", `/orders/${ped2.id}`, undefined, matriz), "E3. detalle").items[0];
  const dE = exigir(await api("POST", `/orders/${ped2.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh, cargado: [{ item_id: lin2.id, quantity: 4 }] }, matriz), "E4. despachar 4 de 5");
  const salE = (await q("SELECT id FROM sales_orders WHERE order_number=$1", [dE.saldo.order_number]))[0];
  const anularSaldo = await api("POST", `/orders/${salE.id}/anular-despacho`, { motivo: "prueba anular saldo" }, matriz);
  check(anularSaldo.status === 409, "E5. el saldo no se anula por su cuenta (es parte del pedido)", mostrar(anularSaldo));
  exigir(await api("POST", `/orders/${ped2.id}/anular-despacho`, { motivo: "SIM se anula el pedido", cash_register_id: caja.id }, matriz), "E6. anular el despacho del pedido");
  const estE = (await q("SELECT status FROM sales_orders WHERE id=$1", [salE.id]))[0].status;
  check(estE === "CANCELLED", "E7. su saldo pendiente se anula con él", estE);
  check(r2(await stock(p011)) === r2(sE + 5), "E8. vuelven al inventario los 5 QQ (lo cargado y el saldo)", { antes: sE, ahora: await stock(p011) });

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
