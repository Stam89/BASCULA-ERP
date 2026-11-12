// ✏️ Corregir una venta «Decidir después» (pedido del dueño 2026-11-11: «0,50 lb de 0,11» era 50 lb de polvillo): cambia
// producto y libras sin tocar el dinero ni el inventario; luego se asigna normal. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(n * 100) / 100;
try {
  const p011 = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const polv = (await q("SELECT id FROM products WHERE code='POLVILLO'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "MIXTO", opening_balance_cash: 100, opening_balance_bank: 0 }, matriz), "0. caja de CEYRO");
  const saldo = async () => r2(Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [caja.id]))[0].s));
  const inv = async () => Number((await q("SELECT count(*)::int n FROM inventory_movements"))[0].n);
  const v = exigir(await api("POST", "/sales/retail", { cash_register_id: caja.id, product_id: p011, warehouse_id: wh, quantity_qq: 0.14, total_amount: 7, price_per_pound: 0.5, mode: "QQ", input_amount: 0.14, product_name: "0.11", buyer: { full_name: "CONSUMIDOR FINAL" }, por_asignar: true }, matriz), "A1. venta de $7 de 0.11 por asignar");
  const c0 = await saldo(), i0 = await inv();

  const r = exigir(await api("POST", `/sales/retail/por-asignar/${v.id}/corregir`, { product_id: polv, product_name: "POLVILLO", libras: 50 }, matriz), "B1. corregir a 50 lb de polvillo");
  check(r.ahora === "POLVILLO" && r.qq === 0.5, "B2. responde el producto y los QQ nuevos", r);
  const fila = (await q("SELECT product_id, product_name, quantity_qq::float qq, libras::float lb, unit_price_qq::float pu, total::float t, cash_movement_id FROM ventas_detalle_por_asignar WHERE id=$1", [v.id]))[0];
  check(fila.product_id === polv && fila.product_name === "POLVILLO" && fila.qq === 0.5 && fila.lb === 50 && fila.pu === 14 && fila.t === 7, "B3. la venta queda en polvillo, 0.5 QQ a $14 y sigue en $7", fila);
  const mov = (await q("SELECT description, amount::float a FROM cash_movements WHERE id=$1", [fila.cash_movement_id]))[0];
  check(/: POLVILLO ·/.test(mov.description) && mov.a === 7, "B4. la línea de caja dice POLVILLO y sigue en $7", mov);
  check((await saldo()) === c0, "B5. la caja no cambia");
  check((await inv()) === i0, "B6. el inventario no se toca");

  const malo = await api("POST", `/sales/retail/por-asignar/${v.id}/corregir`, { product_id: polv, product_name: "POLVILLO", libras: 0 }, matriz);
  check(malo.status === 400, "C1. sin libras no se corrige", malo.status);
  exigir(await api("POST", "/sales/retail/por-asignar/asignar", { ids: [v.id], dueno_id: matriz }, matriz), "C2. se asigna normal a CEYRO");
  const sal = (await q("SELECT product_id, quantity::float qq FROM inventory_movements WHERE reference_type='sales' AND reference_id=(SELECT sale_id FROM ventas_detalle_por_asignar WHERE id=$1)", [v.id]));
  check(sal.length === 1 && sal[0].product_id === polv && sal[0].qq === -0.5, "C3. al asignar sale 0.5 QQ de POLVILLO (no de 0.11)", sal);
  const tarde = await api("POST", `/sales/retail/por-asignar/${v.id}/corregir`, { product_id: p011, product_name: "0.11", libras: 10 }, matriz);
  check(tarde.status === 409, "C4. ya asignada no se corrige", tarde.status);

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
