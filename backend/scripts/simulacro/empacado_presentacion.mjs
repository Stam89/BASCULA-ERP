// 📦 Empacado por presentación (pedido del dueño 2026-10-29): bultos YA LLENOS de una marca por peso de saco.
// Saldo inicial de Oso en 20 bultos de 25 lb → al preparar un pedido de Oso 25 lb salen primero esos bultos (sin
// gastar sacos vacíos) y solo el resto sale del 0.11 (con sus sacos). Revertir devuelve todo. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
try {
  const acc = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const p011 = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const oso = (await q("SELECT id FROM products WHERE name='Oso'"))[0].id;
  const pres25 = (await q("SELECT id, name FROM product_presentations WHERE product_id=$1 AND weight_lb=25", [oso]))[0];
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  await q("UPDATE sales_orders SET status = 'CANCELLED' WHERE accionista_id = $1 AND status = 'PENDING' AND prepared_at IS NULL", [acc]);
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',10,'QQ','OWNED',$3,'sim empacado')", [p011, wh, acc]);
  const oso25 = async () => Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id=$1 AND accionista_id=$2 AND sack_weight_lb=25", [oso, acc]))[0].s);
  const base0 = oso25();

  exigir(await api("POST", "/saldos-iniciales/inventario", { corte: "2026-10-14", product_id: oso, cantidad: 5, sack_weight_lb: 25, detalle: "20 bultos de 25 lb (@ arroba)" }, acc), "1. saldo inicial: 20 bultos de Oso 25 lb (5 QQ)");
  const b0 = await base0;
  check(cerca(await oso25(), b0 + 5), "2. el inventario de Oso guarda el peso del saco (25 lb)", await oso25());
  const emp = exigir(await api("GET", "/inventory/empacado", undefined, acc), "3. Inventario › empacado por presentación");
  const fila = emp.find((e) => e.product_id === oso && Number(e.sack_weight_lb) === 25);
  check(fila && cerca(fila.qq, b0 + 5), "4. Oso 25 lb aparece con sus QQ (bultos = QQ×100/25)", fila);

  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE EMPACADO" }, acc), "5. cliente");
  const qq = round(b0 + 5 + 2);
  const ped = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: oso, inventory_product_id: p011, presentation_id: pres25.id, presentation_name: pres25.name, quantity: qq, unit_price: 50 }] }, acc), `6. pedido de ${qq} QQ Oso 25 lb`);
  const p011antes = Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id=$1 AND accionista_id=$2", [p011, acc]))[0].s);
  exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true, warehouse_id: wh }, acc), "7. preparar");
  const salidas = await q("SELECT product_id, sack_weight_lb::float w, SUM(quantity)::float s FROM inventory_movements WHERE reference_type='sales_order' AND reference_id=$1 GROUP BY 1,2", [ped.id]);
  const deOso = salidas.find((x) => x.product_id === oso), de011 = salidas.find((x) => x.product_id === p011);
  check(deOso && deOso.w === 25 && cerca(-deOso.s, b0 + 5), "8. primero salen los bultos llenos de Oso 25 lb", salidas);
  check(de011 && cerca(-de011.s, 2), "9. solo los 2 QQ que faltan salen del 0.11", salidas);
  check(cerca(await oso25(), 0), "10. no quedan bultos de Oso 25 lb", await oso25());
  const sacos = await q("SELECT s.peso_lb::float peso, SUM(CASE WHEN m.movement='SALIDA' THEN m.cantidad ELSE -m.cantidad END)::float n FROM sack_movements m JOIN sack_inventory s ON s.id=m.sack_id WHERE m.ref_order=$1 GROUP BY 1", [ped.id]);
  const total = sacos.reduce((t, x) => t + x.n, 0);
  check(total === 8, "11. sacos vacíos solo para los 2 QQ empacados ahora (8 de 25 lb), no para los bultos ya llenos", sacos);

  exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: false }, acc), "12. revertir preparación");
  check(cerca(await oso25(), b0 + 5), "13. los bultos de Oso 25 lb vuelven", await oso25());
  const p011desp = Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id=$1 AND accionista_id=$2", [p011, acc]))[0].s);
  check(cerca(p011desp, p011antes), "14. el 0.11 vuelve", { p011antes, p011desp });

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
function round(n) { return Math.round(n * 100) / 100; }
