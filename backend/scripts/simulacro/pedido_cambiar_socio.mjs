// 🔁 Editar un pedido y pasarlo a OTRO socio (pedido del dueño 2026-11-10): el pedido y su cuenta por cobrar quedan del
// nuevo socio y se valida su inventario. Con cobros no se puede. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const socios = await q("SELECT id, name FROM accionistas WHERE tipo <> 'MATRIZ' AND is_active ORDER BY name");
  const [A, B] = socios;
  const P = Object.fromEntries((await q("SELECT code, id FROM products")).map((x) => [x.code, x.id]));
  const W = (await q("SELECT id FROM warehouses WHERE type = 'FINISHED_GOODS' LIMIT 1"))[0].id;
  for (const s of [A, B]) {
    await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',50,'QQ','OWNED',$3,'sim cambiar socio')", [P["ARROCILLO-34"], W, s.id]);
  }
  const item = { product_id: P["ARROCILLO-34"], presentation_name: "100lb", inventory_product_id: P["ARROCILLO-34"], quantity: 2, unit_price: 20 };
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CAMBIAR SOCIO" }, A.id), "1. cliente");
  const o = exigir(await api("POST", "/orders", { customer_id: cli.id, payment_method: "CREDIT", items: [item] }, A.id), `2. pedido de ${A.name}`);
  const r = exigir(await api("PUT", `/orders/${o.id}`, { items: [{ ...item, quantity: 3 }], payment_method: "CREDIT", nuevo_dueno_id: B.id }, A.id), `3. editar y pasar a ${B.name}`);
  const fila = (await q("SELECT accionista_id, total_amount::float t, receivable_id FROM sales_orders WHERE id = $1", [o.id]))[0];
  const ar = fila.receivable_id ? (await q("SELECT accionista_id, amount::float a, balance::float b FROM accounts_receivable WHERE id = $1", [fila.receivable_id]))[0] : null;
  check(fila.accionista_id === B.id && fila.t === 60, `4. el pedido es de ${B.name} con el total nuevo`, { fila, r: r.total_amount });
  check(!ar || (ar.accionista_id === B.id && ar.a === 60 && ar.b === 60), "5. su cuenta por cobrar también pasó", ar);
  const viejo = await api("PUT", `/orders/${o.id}`, { items: [item], payment_method: "CREDIT" }, A.id);
  check(viejo.status === 404, `6. ${A.name} ya no lo puede editar como suyo`, mostrar(viejo));
  exigir(await api("PATCH", `/orders/${o.id}/prepare`, { prepared: true, warehouse_id: W }, B.id), `7. ${B.name} lo prepara (sale de su inventario)`);
  // 📅 Fecha del pedido: uno de un día anterior queda con su fecha; se puede cambiar al editar; no se acepta futura.
  const diaEc = async (id) => (await q("SELECT (created_at AT TIME ZONE 'America/Guayaquil')::date::text d FROM sales_orders WHERE id = $1", [id]))[0].d;
  const hace = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }); };
  const o2 = exigir(await api("POST", "/orders", { customer_id: cli.id, payment_method: "CREDIT", items: [item], fecha: hace(4) }, A.id), "8. pedido con fecha de hace 4 días");
  check(await diaEc(o2.id) === hace(4), "9. queda con esa fecha", await diaEc(o2.id));
  exigir(await api("PUT", `/orders/${o2.id}`, { items: [item], payment_method: "CREDIT", fecha: hace(2) }, A.id), "10. editar la fecha");
  check(await diaEc(o2.id) === hace(2), "11. la fecha cambió", await diaEc(o2.id));
  const futura = await api("POST", "/orders", { customer_id: cli.id, payment_method: "CREDIT", items: [item], fecha: "2099-01-01" }, A.id);
  check(futura.status === 400, "12. fecha futura no", mostrar(futura));
  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
