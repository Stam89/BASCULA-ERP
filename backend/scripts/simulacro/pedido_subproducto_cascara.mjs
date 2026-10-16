// 🌾 Pedido de ARROCILLO/POLVILLO sin stock pero con cáscara: se acepta por lo que saldrá al pilar (rendimiento),
// y se rechaza lo que pase de eso. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 220) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const socio = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const prod = Object.fromEntries((await q("SELECT code, id FROM products")).map((p) => [p.code, p.id]));
  const raw = (await q("SELECT id FROM warehouses WHERE type='RAW_MATERIAL' ORDER BY name LIMIT 1"))[0].id;
  // ROVINSON: sin arrocillo fino ni cáscara pendiente; se le pone 200 QQ de cáscara 0.11 y 100 de corriente
  await q(`INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes)
           SELECT p.id, $1, 'ADJUSTMENT', -SUM(m.quantity), 'QQ', 'OWNED', $2, 'sim: limpiar' FROM inventory_movements m JOIN products p ON p.id=m.product_id
            WHERE m.accionista_id=$2 AND m.ownership='OWNED' AND p.code IN ('ARROCILLO-FINO','CASCARA-011','CASCARA-CORRIENTE') GROUP BY p.id HAVING SUM(m.quantity) <> 0`, [raw, socio]);
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$3,'IN',200,'QQ','OWNED',$4,'sim'),($2,$3,'IN',100,'QQ','OWNED',$4,'sim')", [prod["CASCARA-011"], prod["CASCARA-CORRIENTE"], raw, socio]);
  await q("UPDATE sales_orders SET status='CANCELLED' WHERE accionista_id=$1 AND status='PENDING'", [socio]);
  const rend = exigir(await api("GET", "/orders/rendimiento-subproductos", undefined, socio), "0. rendimiento de subproductos");
  const r = rend.rendimientos["ARROCILLO-FINO"];
  const esperado = Math.round(300 * r * 100) / 100;
  check(r > 0, "0b. arrocillo fino tiene rendimiento", rend);
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE ARROCILLO" }, socio), "0c. cliente");
  const item = (qq) => ({ product_id: prod["ARROCILLO-FINO"], inventory_product_id: prod["ARROCILLO-FINO"], quantity: qq, unit_price: 20 });
  const p1 = await api("POST", "/orders", { customer_id: cli.id, payment_method: "CREDIT", items: [item(Math.floor(esperado * 0.6))] }, socio);
  check(p1.ok, `A1. sin arrocillo pero con 300 QQ de cáscara: se acepta un pedido de ${Math.floor(esperado * 0.6)} QQ (saldrán ~${esperado})`, p1.ok ? undefined : mostrar(p1));
  const p2 = await api("POST", "/orders", { customer_id: cli.id, payment_method: "CREDIT", items: [item(Math.ceil(esperado * 0.6))] }, socio);
  check(p2.status === 409 && /cáscara/.test(JSON.stringify(p2.data)), "A2. lo que pase de lo que saldrá (contando el pedido anterior) se rechaza y explica por qué", mostrar(p2));
  // Arroz pilado sigue igual (1 a 1 con su cáscara)
  const p3 = await api("POST", "/orders", { customer_id: cli.id, payment_method: "CREDIT", items: [{ product_id: prod["ARROZ-PILADO-011"], inventory_product_id: prod["ARROZ-PILADO-011"], quantity: 50, unit_price: 46 }] }, socio);
  check(p3.ok, "B1. el arroz 0.11 sigue respaldado por su cáscara como antes", p3.ok ? undefined : mostrar(p3));
  // Sin cáscara: no hay respaldo
  const otro = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  await q(`INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes)
           SELECT p.id, $1, 'ADJUSTMENT', -SUM(m.quantity), 'QQ', 'OWNED', $2, 'sim: sin cascara' FROM inventory_movements m JOIN products p ON p.id=m.product_id
            WHERE m.accionista_id=$2 AND m.ownership='OWNED' AND p.code IN ('ARROCILLO-FINO','CASCARA-011','CASCARA-CORRIENTE') GROUP BY p.id HAVING SUM(m.quantity) <> 0`, [raw, otro]);
  await q("UPDATE sales_orders SET status='CANCELLED' WHERE accionista_id=$1 AND status='PENDING'", [otro]);
  const cli2 = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE ARROCILLO 2" }, otro), "C0. cliente");
  const p4 = await api("POST", "/orders", { customer_id: cli2.id, payment_method: "CASH", items: [item(1)] }, otro);
  check(p4.status === 409, "C1. sin arrocillo ni cáscara no se acepta", mostrar(p4));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
