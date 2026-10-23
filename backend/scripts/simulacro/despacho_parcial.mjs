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

  // B. El camión carga 3 de 5 Flor y todo el polvillo
  const cargado = [{ item_id: linFlor.id, quantity: 3 }, ...(linPol ? [{ item_id: linPol.id, quantity: 2 }] : [])];
  const c0 = Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s);
  const d = exigir(await api("POST", `/orders/${ped.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh, cargado }, matriz), "B1. despachar solo lo cargado");
  const totalLleva = r2(3 * 46 + (pol ? 2 * 20 : 0));
  check(d.saldo && d.saldo.qq === 2 && d.saldo.total === 92 && /-S1$/.test(d.saldo.order_number), "B2. queda saldo de 2 QQ Flor ($92) como PED-…-S1", d.saldo);
  check(r2(Number(d.sale.total_amount)) === totalLleva, `B3. la venta es solo lo cargado (${totalLleva})`, d.sale.total_amount);
  const c1 = Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s);
  check(r2(c1 - c0) === totalLleva, "B4. a la caja entra solo lo cargado", { entro: r2(c1 - c0) });
  const sal = (await q("SELECT * FROM sales_orders WHERE order_number=$1", [d.saldo.order_number]))[0];
  check(sal.status === "PENDING" && sal.prepared_at && sal.parent_order_id === ped.id, "B5. el saldo está pendiente, YA preparado y ligado al pedido", { status: sal.status, prep: !!sal.prepared_at });
  check(r2(await stock(p011)) === r2(s1), "B6. el inventario no cambia: los 2 QQ del saldo siguen descontados (por despachar)", await stock(p011));
  const outSaldo = Number((await q("SELECT COALESCE(-SUM(quantity),0)::float q FROM inventory_movements WHERE reference_type='sales_order' AND reference_id=$1 AND movement='OUT'", [sal.id]))[0].q);
  check(outSaldo === 2, "B7. la salida de los 2 QQ ahora es del saldo", outSaldo);
  const arOrig = (await q("SELECT amount::float a, balance::float b, status FROM accounts_receivable WHERE id=(SELECT receivable_id FROM sales_orders WHERE id=$1)", [ped.id]))[0];
  const arSaldo = (await q("SELECT amount::float a, balance::float b, status FROM accounts_receivable WHERE id=$1", [sal.receivable_id]))[0];
  check(arOrig.a === totalLleva && arOrig.b === 0 && arSaldo.a === 92 && arSaldo.b === 92, "B8. la cuenta del pedido se reparte: lo llevado cobrado, el saldo por cobrar", { arOrig, arSaldo });
  const cola = exigir(await api("GET", "/orders/cola-global", undefined, matriz), "B9. cola");
  check(cola.some((o) => o.id === sal.id), "B10. el saldo aparece en la Cola de Despachos");

  // C. Validaciones
  const sal2items = exigir(await api("GET", `/orders/${sal.id}`, undefined, matriz), "C0. detalle del saldo").items;
  const nada = await api("POST", `/orders/${sal.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh, cargado: [{ item_id: sal2items[0].id, quantity: 0 }] }, matriz);
  check(nada.status === 400, "C1. si el camión no lleva nada, no se despacha", mostrar(nada));
  const demas = await api("POST", `/orders/${sal.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh, cargado: [{ item_id: sal2items[0].id, quantity: 9 }] }, matriz);
  check(demas.status === 400, "C2. no se puede cargar más de lo pedido", mostrar(demas));

  // D. El próximo camión lleva el saldo completo
  const d2 = exigir(await api("POST", `/orders/${sal.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh }, matriz), "D1. despachar el saldo");
  check(!d2.saldo && r2(Number(d2.sale.total_amount)) === 92, "D2. se vende el saldo ($92) sin nuevo saldo", d2.sale.total_amount);
  check(r2(await stock(p011)) === r2(s1), "D3. el inventario no se mueve otra vez al despachar (ya se descontó al preparar)");

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
