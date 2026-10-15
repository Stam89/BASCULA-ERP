// 🔔 Pedido nuevo → aviso en la campanita de la MATRIZ (encargado de bodega / Cola de Despachos), venga de la
// Matriz o de un socio. SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const p011 = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const flor = (await q("SELECT id FROM products WHERE name='Flor'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  for (const acc of [matriz, stalyn]) {
    await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',50,'QQ','OWNED',$3,'sim aviso')", [p011, wh, acc]);
  }
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE PEDIDO AVISO" }, matriz), "0. cliente");
  const item = { product_id: flor, inventory_product_id: p011, presentation_name: "100lb", quantity: 10, unit_price: 46 };
  const avisos = async () => q("SELECT titulo, mensaje, tipo, referencia_tipo, referencia_id FROM notificaciones WHERE accionista_id = $1 AND referencia_tipo = 'sales_orders' ORDER BY created_at", [matriz]);
  const n0 = (await avisos()).length;

  const p1 = exigir(await api("POST", "/orders", { customer_id: cli.id, delivery_date: "2026-10-20", items: [item] }, matriz), "A1. la Matriz toma un pedido de 10 QQ Flor");
  const a1 = (await avisos()).slice(n0);
  check(a1.length === 1 && a1[0].referencia_id === p1.id && a1[0].tipo === "PEDIDO" && /Pedido nuevo/.test(a1[0].titulo) && /10\.00 QQ/.test(a1[0].titulo),
    "A2. a la campanita de la Matriz le llega «Pedido nuevo … 10.00 QQ»", a1);
  check(/SIM CLIENTE PEDIDO AVISO/.test(a1[0].mensaje) && /Flor/.test(a1[0].mensaje) && /20\/10\/2026/.test(a1[0].mensaje), "A3. … con el cliente, la marca y la fecha de entrega", a1[0].mensaje);

  const p2 = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ ...item, quantity: 5 }] }, stalyn), "B1. STALYN toma un pedido de 5 QQ");
  const a2 = (await avisos()).slice(n0 + 1);
  check(a2.length === 1 && a2[0].referencia_id === p2.id && /STALYN vendió a/.test(a2[0].mensaje), "B2. a la Matriz le llega «STALYN vendió a …» (bodega lo despacha)", a2);
  const deStalyn = await q("SELECT count(*)::int n FROM notificaciones WHERE accionista_id = $1 AND referencia_id = $2", [stalyn, p2.id]);
  check(deStalyn[0].n === 0, "B3. el socio que vendió no recibe aviso de su propio pedido", deStalyn[0]);

  const r = exigir(await api("GET", "/notificaciones", undefined, matriz), "C1. la campanita de la Matriz");
  check(r.items.some((n) => n.referencia_id === p2.id && n.referencia_tipo === "sales_orders" && !n.leida_at) && r.no_leidas >= 2, "C2. … muestra el pedido sin leer (para abrir la Cola)", r.no_leidas);
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
