// 💵 La forma de pago se escoge al TOMAR el pedido y la Cola de Despachos la trae puesta. SOLO copia.
import fs from "fs";
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261099_pedido_forma_pago.sql", import.meta.url), "utf8"));
  const p011 = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const flor = (await q("SELECT id FROM products WHERE name='Flor'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',30,'QQ','OWNED',$3,'sim forma pago')", [p011, wh, matriz]);
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE FORMA PAGO" }, matriz), "0. cliente");
  const item = { product_id: flor, inventory_product_id: p011, presentation_name: "100lb", quantity: 5, unit_price: 46 };
  const p1 = exigir(await api("POST", "/orders", { customer_id: cli.id, payment_method: "CREDIT", items: [item] }, matriz), "A1. pedido tomado a CRÉDITO");
  check(p1.payment_method === "CREDIT", "A2. queda guardado a crédito", p1.payment_method);
  const p0 = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [item] }, matriz), "A3. pedido sin forma de pago (como antes) también se acepta");
  check(p0.payment_method === null, "A4. … queda vacío (se despacha como antes)", p0.payment_method);
  const mal = await api("POST", "/orders", { customer_id: cli.id, payment_method: "BITCOIN", items: [item] }, matriz);
  check(mal.status === 400, "A5. una forma de pago inválida se rechaza", mal.status);
  exigir(await api("PUT", `/orders/${p1.id}`, { payment_method: "TRANSFER", items: [item] }, matriz), "B1. editar el pedido a transferencia");
  const cola = exigir(await api("GET", "/orders/cola-global", undefined, matriz), "B2. cola de despachos");
  check(cola.find((o) => o.id === p1.id)?.payment_method === "TRANSFER", "B3. la cola trae la forma de pago escogida", cola.find((o) => o.id === p1.id)?.payment_method);
  const det = exigir(await api("GET", `/orders/${p1.id}`, undefined, matriz), "B4. detalle del pedido");
  check(det.payment_method === "TRANSFER", "B5. el detalle (para editar) también", det.payment_method);
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
