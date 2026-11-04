// 🧺 Pedido con un saco que no hay: se toma igual, al preparar el saco queda en negativo y sale en «Sacos por comprar».
// Al revertir la preparación vuelve. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, c, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const socio = (await q("SELECT id FROM accionistas WHERE upper(name) = 'STALYN'"))[0].id;
  const oso = (await q("SELECT id FROM products WHERE code = 'ARROZ-OSO'"))[0];
  const pres = (await q("SELECT id, name FROM product_presentations WHERE product_id = $1 AND name ILIKE '10%'", [oso.id]))[0];
  const base = (await q("SELECT id FROM products WHERE code = 'ARROZ-PILADO-011'"))[0];
  await q("UPDATE sack_inventory SET stock = 2 WHERE tipo = 'Oso 10 LB'");
  const stock = async () => Number((await q("SELECT stock FROM sack_inventory WHERE tipo = 'Oso 10 LB'"))[0].stock);
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE SACO" }, socio), "A0. cliente");

  // 1 QQ en bultos de 10 lb = 10 sacos, y solo hay 2.
  const pedido = exigir(await api("POST", "/orders", {
    customer_id: cli.id, payment_method: "CREDIT",
    items: [{ product_id: oso.id, presentation_id: pres.id, presentation_name: pres.name, inventory_product_id: base.id, quantity: 1, unit_price: 40 }]
  }, socio), "A1. el pedido se toma aunque faltan sacos");
  check(await stock() === 2, "A2. tomar el pedido no toca los sacos", await stock());

  const prep = exigir(await api("PATCH", `/orders/${pedido.id ?? pedido.order?.id}/prepare`, { prepared: true }, socio), "B1. se prepara sin sacos suficientes");
  const d = prep.sacos?.descontados?.find((x) => x.tipo === "Oso 10 LB");
  check(d?.sacos === 10, "B2. descuenta los 10 sacos", prep.sacos);
  check(await stock() === -8, "B3. el saco queda en negativo", await stock());
  check(d?.nuevo_stock === -8, "B4. la pantalla recibe el saldo para avisar", d);

  const compra = await api("GET", "/sacks/por-comprar");
  check(compra.ok && JSON.stringify(compra.data).includes("Oso 10 LB"), "C1. sale en Sacos por comprar", mostrar(compra));

  exigir(await api("PATCH", `/orders/${pedido.id ?? pedido.order?.id}/prepare`, { prepared: false }, socio), "D1. se revierte la preparación");
  check(await stock() === 2, "D2. los sacos vuelven", await stock());
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); await c.query("ROLLBACK").catch(() => {}); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
