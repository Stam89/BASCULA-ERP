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
  // En la COPIA se apartan los pedidos pendientes reales de ROVINSON (sin preparar) para partir limpio.
  await q("UPDATE sales_orders SET status = 'CANCELLED' WHERE accionista_id = $1 AND status = 'PENDING' AND prepared_at IS NULL", [rov]);
  const alla0 = await saldo(true), pil0 = await saldo(false);
  check(alla0 > 4, `0. ROVINSON tiene ${alla0} QQ de 0.11 allá (informe de selección) y ${pil0} en la piladora`);
  const retiro = Math.floor(alla0 - 3), q1 = 5 + retiro; // lo que sale de allá en el 1er pedido
  // 5 QQ en la piladora para probar la mezcla (primero la piladora, luego allá)
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',5,'QQ','OWNED',$3,'sim venta alla')", [p011, wh, rov]);

  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE VENTA ALLA" }, rov), "A0. cliente");
  const item = { product_id: flor, inventory_product_id: p011, presentation_name: "100lb", quantity: q1, unit_price: 46 };
  const ped = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [item] }, rov), `A1. pedido de ${q1} QQ Flor (5 en piladora + ${retiro} allá): se ACEPTA`);
  const tope = round(alla0 + 5 - q1 + 1);
  const otro = await api("POST", "/orders", { customer_id: cli.id, items: [{ ...item, quantity: tope }] }, rov);
  check(otro.status === 409, `A2. otro pedido de ${tope} QQ ya no cabe (respaldo = piladora + allá − pedidos)`, otro.status);

  const cola = exigir(await api("GET", "/orders/cola-global", undefined, rov), "B0. cola de despachos");
  const enCola = cola.find((o) => o.id === ped.id);
  check(enCola && Number(enCola.stock_dueno[p011]) >= q1 && enCola.alla_dueno.some((x) => /Allá/.test(x.bodega) && x.qq >= retiro), "B1. la cola ve el stock con lo de allá y de qué proveedor", enCola && { stock: enCola.stock_dueno, alla: enCola.alla_dueno });

  const prep = exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true, warehouse_id: wh }, rov), "B2. preparar el pedido");
  const ret = prep.retiros_alla ?? [];
  check(ret.length === 1 && Math.abs(ret[0].qq - retiro) < 0.01 && /Allá/.test(ret[0].bodega), `B3. avisa: retirar ${retiro} QQ allá`, ret);
  check(Math.abs((await saldo(true)) - (alla0 - retiro)) < 0.01, `B4. lo de allá baja ${retiro} QQ`, { antes: alla0, ahora: await saldo(true) });
  check(Math.abs((await saldo(false)) - pil0) < 0.01, "B5. la piladora entrega sus 5 QQ (queda como antes)", { antes: pil0, ahora: await saldo(false) });
  const cola2 = exigir(await api("GET", "/orders/cola-global", undefined, rov), "B6. cola tras preparar");
  const e2 = cola2.find((o) => o.id === ped.id);
  check(e2.retirado_alla.length === 1 && Math.abs(e2.retirado_alla[0].qq - retiro) < 0.01, "B7. el pedido preparado muestra lo retirado allá", e2.retirado_alla);

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

  // ── E. «🏭 Ya está en la piladora»: lo trajeron y nadie registró el viaje ──
  const resto = await saldo(true);
  const carro = (await q("SELECT id, nombre FROM campo_activos WHERE activo AND lower(coalesce(tipo,'')) <> 'cosechadora' ORDER BY nombre LIMIT 1"))[0];
  const ped2 = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ ...item, quantity: resto }] }, rov), `E1. pedido de ${resto} QQ (todo lo que queda allá)`);
  const pil1 = await saldo(false);
  const body = { prepared: true, warehouse_id: wh, alla_ya_llego: carro ? { flete: { tipo: "propia", monto: 12, activo_id: carro.id } } : {} };
  const p2 = exigir(await api("PATCH", `/orders/${ped2.id}/prepare`, body, rov), "E2. preparar marcando «Ya está en la piladora»" + (carro ? ` con flete de ${carro.nombre}` : ""));
  check((p2.retiros_alla ?? []).length === 0 && (p2.traidos_alla ?? []).length === 1 && Math.abs(p2.traidos_alla[0].qq - resto) < 0.01, "E3. no se retira allá: se registró el viaje de regreso", p2);
  check(Math.abs(await saldo(true)) < 0.01 && Math.abs((await saldo(false)) - pil1) < 0.01, "E4. allá queda en 0 y la piladora entra y sale lo mismo");
  const tr = await q("SELECT id, total_qq::float t, flete_tipo, flete_monto::float m, notes FROM selection_traidas WHERE accionista_id=$1 ORDER BY created_at DESC LIMIT 1", [rov]);
  check(tr[0] && Math.abs(tr[0].t - resto) < 0.01 && /pedido/.test(tr[0].notes), "E5. el viaje queda en Selección (se puede anular si fue error)", tr[0]);
  if (carro) {
    const sv = await q("SELECT s.valor::float v, (SELECT balance::float FROM accounts_payable p WHERE p.reference_type='campo_servicio' AND p.reference_id=s.id) cxp FROM campo_servicios s WHERE s.origen_tipo='envejecido_regreso' AND s.origen_id=$1", [tr[0].id]);
    check(sv.length === 1 && sv[0].v === 12 && sv[0].cxp === 12, "E6. el flete de regreso va a Transporte (CxC) y a la Por Pagar de ROVINSON", sv);
  }
  exigir(await api("POST", `/orders/${ped2.id}/deliver`, { payment_method: "CREDIT", warehouse_id: wh }, rov), "E7. despachar");
  const cu2 = await q("SELECT quantity::float q FROM cuadrilla_entries WHERE notes LIKE $1", [`%${ped2.order_number}%`]);
  check(cu2.length === 1 && Math.abs(cu2[0].q - resto) < 0.01, "E8. la cuadrilla cobra todo el embarque (salió de la piladora)", cu2);

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió|cambio de la báscula/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
function round(n) { return Math.round(n * 100) / 100; }
