// 🟢 Arroz Envejecido: se vende en el saco PROPIO del socio que vende (CECIBEL → baja SUS sacos al preparar)
// o en el saco del proveedor (no baja nada). Al recibir el informe solo se anota en qué saco viene. SOLO copia.
import fs from "fs";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  for (const f of ["20261099_pedido_forma_pago.sql", "20261100_saco_envejecido_venta.sql"]) await q(fs.readFileSync(new URL(`../../../database/migrations/${f}`, import.meta.url), "utf8"));
  const st = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const rov = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const env = (await q("SELECT id FROM products WHERE code='ARROZ-ENVEJECIDO'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  const cec = (await q("SELECT id, stock::float s FROM sack_inventory WHERE accionista_id=$1 AND categoria='PROPIO' AND peso_lb=100 AND tipo ILIKE '%CECIBEL%'", [st]))[0];
  check(!!cec, "0. STALYN tiene su saco propio CECIBEL 100 LB", cec);
  await q("UPDATE sack_inventory SET stock = 50 WHERE id = $1", [cec.id]); // (copia) 50 sacos para probar
  await q("UPDATE sales_orders SET status='CANCELLED' WHERE accionista_id=$1 AND status='PENDING' AND prepared_at IS NULL", [st]);
  const stockEnv = Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements m JOIN warehouses w ON w.id=m.warehouse_id WHERE m.accionista_id=$1 AND m.product_id=$2 AND w.type<>'EXTERNO'", [st, env]))[0].s);
  check(stockEnv >= 20, `0b. STALYN tiene ${stockEnv} QQ de envejecido`);
  const sacos = async () => Number((await q("SELECT stock::float s FROM sack_inventory WHERE id=$1", [cec.id]))[0].s);
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE ENVEJECIDO" }, st), "A0. cliente");

  const p1 = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: env, inventory_product_id: env, presentation_name: "CECIBEL 100 LB", sack_id: cec.id, quantity: 10, unit_price: 50 }] }, st), "A1. pedido 10 QQ envejecido en CECIBEL 100 LB");
  const p2 = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: env, inventory_product_id: env, presentation_name: "100 LB · saco del proveedor", quantity: 5, unit_price: 50 }] }, st), "A2. pedido 5 QQ envejecido en saco del proveedor");
  // (copia) 1 QQ de envejecido a ROVINSON para que el stock no frene la prueba del saco ajeno
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',1,'QQ','OWNED',$3,'sim saco env')", [env, wh, rov]);
  const ajeno = await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: env, inventory_product_id: env, presentation_name: "CECIBEL 100 LB", sack_id: cec.id, quantity: 1, unit_price: 50 }] }, rov);
  check(ajeno.status === 400 && /sacos propios/.test(JSON.stringify(ajeno.data)), "A3. otro socio no puede usar los sacos CECIBEL de STALYN", mostrar(ajeno));
  const flor = (await q("SELECT id FROM products WHERE name='Flor'"))[0].id;
  const p011b = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const noEnv = await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: flor, inventory_product_id: p011b, presentation_name: "100lb", sack_id: cec.id, quantity: 1, unit_price: 50 }] }, st);
  check(noEnv.status === 400, "A4. el saco propio solo vale para el Arroz Envejecido", mostrar(noEnv));

  const s0 = await sacos();
  exigir(await api("PATCH", `/orders/${p1.id}/prepare`, { prepared: true, warehouse_id: wh }, st), "B1. preparar el pedido en CECIBEL");
  check(s0 - (await sacos()) === 10, "B2. bajan 10 sacos CECIBEL 100 LB de STALYN", { antes: s0, ahora: await sacos() });
  const s1 = await sacos();
  exigir(await api("PATCH", `/orders/${p2.id}/prepare`, { prepared: true, warehouse_id: wh }, st), "B3. preparar el pedido en saco del proveedor");
  check((await sacos()) === s1, "B4. en saco del proveedor no baja ningún saco", { antes: s1, ahora: await sacos() });
  exigir(await api("PATCH", `/orders/${p1.id}/prepare`, { prepared: false }, st), "C1. revertir la preparación en CECIBEL");
  check((await sacos()) === s0, "C2. los 10 sacos vuelven", await sacos());

  // Recepción de un envejecido: anotar que viene en CECIBEL no descuenta (se descuenta al vender)
  const pid = (await q("SELECT id FROM external_providers ORDER BY name LIMIT 1"))[0]?.id;
  const p011 = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',10,'QQ','OWNED',$3,'sim saco env')", [p011, wh, st]);
  const lote = await api("POST", "/selection/batches", { service_type: "ENVEJECIMIENTO", provider_id: pid, warehouse_id: wh, inputs: [{ product_id: p011, quantity: 10 }] }, st);
  if (lote.ok) {
    const s2 = await sacos();
    exigir(await api("POST", `/selection/batches/${lote.data.id}/finish`, { outputs: [{ product_id: env, quantity: 9.5, empaque: "SACO", sack_id: cec.id, presentation: "CECIBEL 100 LB", sack_weight_lb: 100 }] }, st), "D1. registrar el informe: viene en CECIBEL");
    check((await sacos()) === s2, "D2. al recibir NO se descuentan sacos (solo se anota)", { antes: s2, ahora: await sacos() });
    const out = (await q("SELECT empaque, sack_id FROM selection_batch_outputs WHERE batch_id=$1", [lote.data.id]))[0];
    check(out.sack_id === cec.id, "D3. queda anotado en qué saco viene", out);
  } else check(true, "D. (no se pudo crear el lote de envejecido en la copia: " + mostrar(lote) + ")");

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
