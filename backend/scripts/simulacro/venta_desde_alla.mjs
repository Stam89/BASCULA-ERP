// 🚚 Vender lo que quedó ALLÁ (selección/envejecido con informe): el pedido lo acepta, al preparar sale primero de
// la piladora y lo que falta se retira allá (baja «Allá: <proveedor>»), la cuadrilla no carga lo de allá. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const rov = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const p011 = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const flor = (await q("SELECT id FROM products WHERE name='Flor'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  const saldo = async (externo) => Number((await q(
    `SELECT COALESCE(SUM(m.quantity),0)::float s FROM inventory_movements m JOIN warehouses w ON w.id=m.warehouse_id
      WHERE m.accionista_id=$1 AND m.product_id=$2 AND m.ownership='OWNED' AND (w.type='EXTERNO') = $3`, [rov, p011, externo]))[0].s);
  const alla0 = await saldo(true), pil0 = await saldo(false);
  check(alla0 > 40, `0. ROVINSON tiene ${alla0} QQ de 0.11 allá (informe de selección) y ${pil0} en la piladora`);
  // 5 QQ en la piladora para probar la mezcla (primero la piladora, luego allá)
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',5,'QQ','OWNED',$3,'sim venta alla')", [p011, wh, rov]);

  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE VENTA ALLA" }, rov), "A0. cliente");
  const item = { product_id: flor, inventory_product_id: p011, presentation_name: "100lb", quantity: 45, unit_price: 46 };
  const ped = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [item] }, rov), "A1. pedido de 45 QQ Flor (5 en piladora + 40 allá): se ACEPTA");
  const tope = round(alla0 + 5 - 45 + 1);
  const otro = await api("POST", "/orders", { customer_id: cli.id, items: [{ ...item, quantity: tope }] }, rov);
  check(otro.status === 409, `A2. otro pedido de ${tope} QQ ya no cabe (respaldo = piladora + allá − pedidos)`, otro.status);

  const cola = exigir(await api("GET", "/orders/cola-global", undefined, rov), "B0. cola de despachos");
  const enCola = cola.find((o) => o.id === ped.id);
  check(enCola && Number(enCola.stock_dueno[p011]) >= 45 && enCola.alla_dueno.some((x) => /Allá/.test(x.bodega) && x.qq > 40), "B1. la cola ve el stock con lo de allá y de qué proveedor", enCola && { stock: enCola.stock_dueno, alla: enCola.alla_dueno });

  const prep = exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true, warehouse_id: wh }, rov), "B2. preparar el pedido");
  const ret = prep.retiros_alla ?? [];
  check(ret.length === 1 && Math.abs(ret[0].qq - 40) < 0.01 && /Allá/.test(ret[0].bodega), "B3. avisa: retirar 40 QQ allá", ret);
  check(Math.abs((await saldo(true)) - (alla0 - 40)) < 0.01, "B4. lo de allá baja 40 QQ", { antes: alla0, ahora: await saldo(true) });
  check(Math.abs((await saldo(false)) - pil0) < 0.01, "B5. la piladora entrega sus 5 QQ (queda como antes)", { antes: pil0, ahora: await saldo(false) });
  const cola2 = exigir(await api("GET", "/orders/cola-global", undefined, rov), "B6. cola tras preparar");
  const e2 = cola2.find((o) => o.id === ped.id);
  check(e2.retirado_alla.length === 1 && Math.abs(e2.retirado_alla[0].qq - 40) < 0.01, "B7. el pedido preparado muestra lo retirado allá", e2.retirado_alla);

  // Revertir la preparación devuelve todo a su sitio
  exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: false }, rov), "C1. revertir preparación");
  check(Math.abs((await saldo(true)) - alla0) < 0.01 && Math.abs((await saldo(false)) - (pil0 + 5)) < 0.01, "C2. vuelve a allá y a la piladora");
  exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true, warehouse_id: wh }, rov), "C3. preparar otra vez");

  const cq0 = Number((await q("SELECT COUNT(*)::int n FROM cuadrilla_entries"))[0].n);
  const d = exigir(await api("POST", `/orders/${ped.id}/deliver`, { payment_method: "CREDIT", warehouse_id: wh }, rov), "D1. despachar a crédito");
  const cu = await q("SELECT quantity::float q FROM cuadrilla_entries WHERE notes LIKE $1", [`%${ped.order_number}%`]);
  check(cu.length === 1 && Math.abs(cu[0].q - 5) < 0.01, "D2. la cuadrilla cobra solo los 5 QQ que cargó en la piladora", { cu, cq0 });
  check(d.sale && d.sale.total_amount, "D3. la venta queda registrada", d.sale?.sale_number);
  const ub = exigir(await api("GET", "/selection/ubicacion", undefined, rov), "D4. Selección → dónde está");
  console.log("   ubicacion:", JSON.stringify(ub).slice(0, 300));

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió|cambio de la báscula/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
function round(n) { return Math.round(n * 100) / 100; }
