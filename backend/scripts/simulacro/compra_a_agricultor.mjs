// 🌾 Compra a un AGRICULTOR (pedido del dueño 2026-10-30): producto terminado que vende un agricultor. Entra al
// inventario; a crédito la Por Pagar queda a su nombre (farmer_id); de contado sale de la caja. Se anula bien. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 240)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
try {
  const farmer = (await q("SELECT id, full_name FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const prod = (await q("SELECT id FROM products WHERE code = 'ARROZ-PILADO-011'"))[0].id;
  const bod = (await q("SELECT id FROM warehouses WHERE type = 'FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  const stock = async () => Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id=$1 AND accionista_id=$2", [prod, matriz]))[0].s);
  const s0 = await stock();
  const item = { item_type: "PRODUCT", product_id: prod, warehouse_id: bod, quantity: 10, unit_price: 45 };

  const sin = await api("POST", "/purchases", { payment_type: "CREDIT", items: [item] }, matriz);
  check(sin.status === 400, "1. sin proveedor ni agricultor: 400", mostrar(sin));
  const c = exigir(await api("POST", "/purchases", { farmer_id: farmer.id, payment_type: "CREDIT", items: [item] }, matriz), `2. compra a crédito al agricultor ${farmer.full_name}`);
  check(cerca(await stock(), s0 + 10), "3. entran 10 QQ de 0.11 al inventario", await stock());
  const ap = (await q("SELECT farmer_id, amount::float a, description FROM accounts_payable WHERE reference_type='purchase' AND reference_id=$1", [c.id]))[0];
  check(ap && ap.farmer_id === farmer.id && cerca(ap.a, 450), "4. la Por Pagar de $450 queda a nombre del agricultor", ap);
  check(c.farmer_id === farmer.id, "5. la compra guarda el agricultor", c.farmer_id);

  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim compra", tipo: "EFECTIVO", opening_balance_cash: 1000 }, matriz), "6. caja abierta").id;
  const d = exigir(await api("POST", "/purchases", { farmer_id: farmer.id, payment_type: "CASH", cash_register_id: caja, items: [{ ...item, quantity: 2 }] }, matriz), "7. compra de contado al agricultor");
  const mov = (await q("SELECT amount::float a, description FROM cash_movements WHERE reference_type='purchase' AND reference_id=$1", [d.id]))[0];
  check(mov && cerca(mov.a, 90) && /agricultor/.test(mov.description), "8. sale $90 de la caja y dice que fue al agricultor", mov);

  exigir(await api("POST", `/purchases/${c.id}/cancel`, { reason: "sim" }, matriz), "9. anular la compra a crédito");
  const ap2 = (await q("SELECT status, balance::float b FROM accounts_payable WHERE reference_type='purchase' AND reference_id=$1", [c.id]))[0];
  check(ap2 && (ap2.status === "CANCELLED" || ap2.b === 0) && cerca(await stock(), s0 + 2), "10. se anula su deuda y salen los 10 QQ", { ap2, stock: await stock() });

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
