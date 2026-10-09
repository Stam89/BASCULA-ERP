// 📍 Envejecido: lo procesado que QUEDÓ ALLÁ donde el proveedor vs lo que llegó a la piladora, y los viajes para traerlo.
// SOLO contra la copia (sim_base aborta si no). Aplica la migración en la copia si falta.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  if (!(await q("SELECT 1 FROM information_schema.columns WHERE table_name='selection_batch_outputs' AND column_name='qty_alla'")).length) {
    await q(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261081_envejecido_alla.sql"), "utf8"));
    console.log("   (info) migración 20261081 aplicada en la COPIA");
  }
  if (!(await q("SELECT 1 FROM information_schema.columns WHERE table_name='selection_traidas' AND column_name='flete_tipo'")).length) {
    await q(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261082_flete_regreso_envejecido.sql"), "utf8"));
    console.log("   (info) migración 20261082 aplicada en la COPIA");
  }
  const acc = (await q("SELECT id FROM accionistas WHERE COALESCE(modulo_envejecido_habilitado, puede_envejecer) ORDER BY name LIMIT 1"))[0].id;
  const prov = (await q("SELECT id, name FROM external_providers WHERE is_active ORDER BY name LIMIT 1"))[0];
  const P = async (code) => (await q("SELECT id FROM products WHERE code=$1", [code]))[0].id;
  const arroz = await P("ARROZ-PILADO-011"), a34 = await P("ARROCILLO-34"), polv = await P("POLVILLO");
  const bodPT = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',20,'simulacro','OWNED',$3)", [arroz, bodPT, acc]);
  const stock = async (pid, externo) => r3((await q(
    `SELECT COALESCE(sum(m.quantity),0)::float n FROM inventory_movements m JOIN warehouses w ON w.id=m.warehouse_id
      WHERE m.product_id=$1 AND m.accionista_id=$2 AND m.ownership='OWNED' AND (w.type='EXTERNO') = $3`, [pid, acc, externo]))[0].n);
  const piladora = (pid) => stock(pid, false), alla = (pid) => stock(pid, true);

  // ── A. Mandar a envejecer y registrar el informe: parte llegó, parte quedó allá ──
  const p0 = await piladora(arroz), a0 = await alla(arroz), p34 = await piladora(a34);
  const lote = exigir(await api("POST", "/selection/batches", { provider_id: prov.id, service_type: "ENVEJECIMIENTO", warehouse_id: bodPT, inputs: [{ product_id: arroz, quantity: 10 }] }, acc), "A1. mandar 10 QQ de 0.11 a envejecer");
  check(r3(p0 - await piladora(arroz)) === 10, "A2. salen 10 QQ de la piladora");
  check((await api("POST", `/selection/batches/${lote.id}/finish`, { outputs: [{ product_id: arroz, quantity: 8, qty_alla: 9 }] }, acc)).status === 400, "A3. «quedó allá» mayor que lo que salió → 400");
  exigir(await api("POST", `/selection/batches/${lote.id}/finish`, { outputs: [
    { product_id: arroz, quantity: 8, qty_alla: 5 },
    { product_id: a34, quantity: 1, qty_alla: 1 },
    { product_id: polv, quantity: 0.5 }
  ] }, acc), "A4. el informe: 8 QQ de envejecido (5 quedaron allá), 1 de 3/4 (todo allá) y 0.5 de polvillo (llegó)");
  check(r3(await piladora(arroz) - (p0 - 10)) === 3 && r3(await alla(arroz) - a0) === 5, "A5. 0.11 envejecido: 3 QQ llegan a la piladora y 5 quedan allá", { piladora: await piladora(arroz), alla: await alla(arroz) });
  check(await piladora(a34) === p34 && await alla(a34) === 1, "A6. arrocillo 3/4: nada llegó, 1 QQ allá");
  const bod = (await q("SELECT name, type FROM warehouses WHERE external_provider_id=$1", [prov.id]))[0];
  check(bod?.type === "EXTERNO" && bod.name === `Allá: ${prov.name}`, "A7. se creó la bodega «Allá: <proveedor>»", bod);
  const ub = exigir(await api("GET", "/selection/ubicacion", undefined, acc), "A8. consulta «¿dónde está?»");
  const fila = ub.productos.find((p) => p.product_id === arroz);
  check(fila && r3(fila.alla_total) === r3(await alla(arroz)) && r3(fila.piladora) === r3(await piladora(arroz)) && fila.alla[0]?.proveedor === prov.name,
    "A9. muestra por producto cuánto hay allá (con el proveedor) y cuánto en la piladora", fila);
  const lista = (await api("GET", "/selection/batches", undefined, acc)).data.rows.find((b) => b.id === lote.id);
  check(lista.outputs.find((o) => o.product_id === arroz)?.qty_alla == 5, "A10. el historial del lote guarda cuánto quedó allá");

  // ── B. Ventas no ofrece lo que está allá ──
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE SIM ALLA" }, acc), "B0. cliente");
  const ped = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: arroz, inventory_product_id: arroz, quantity: 1, unit_price: 30 }] }, acc), "B1. pedido pendiente");
  const cola = (await api("GET", "/orders/cola-global", undefined, acc)).data;
  const enCola = (Array.isArray(cola) ? cola : cola.rows ?? []).find((o) => o.id === ped.id);
  check(enCola && r3(enCola.stock_dueno?.[arroz] ?? 0) === await piladora(arroz), "B2. el stock que ve Ventas es solo el de la piladora (sin lo de allá)", { ventas: enCola?.stock_dueno?.[arroz], piladora: await piladora(arroz), alla: await alla(arroz) });

  // ── C. Traer a la piladora ──
  const pA = await piladora(arroz), aA = await alla(arroz);
  const inv0 = (await api("GET", "/finance/balance", undefined, acc)).data.activo.corriente.inventario_detalle;
  exigir(await api("POST", "/selection/traer", { provider_id: prov.id, items: [{ product_id: arroz, quantity: 3 }], notes: "viaje 1" }, acc), "C1. traer 3 QQ de envejecido");
  check(r3(await piladora(arroz) - pA) === 3 && r3(aA - await alla(arroz)) === 3, "C2. +3 en la piladora y −3 allá");
  const antes34 = [await piladora(a34), await alla(a34)];
  check((await api("POST", "/selection/traer", { provider_id: prov.id, items: [{ product_id: a34, quantity: 5 }] }, acc)).status === 409
    && (await piladora(a34)) === antes34[0] && (await alla(a34)) === antes34[1], "C3. traer más de lo que hay allá → 409 y no cambia nada");
  const ub2 = exigir(await api("GET", "/selection/ubicacion", undefined, acc), "C4. consulta después del viaje");
  check(ub2.traidas[0]?.notes === "viaje 1" && Number(ub2.traidas[0]?.total_qq) === 3, "C5. queda el registro del viaje", ub2.traidas[0]);

  // ── D. Lo de allá sigue siendo del socio (inventario del balance) ──
  const inv1 = (await api("GET", "/finance/balance", undefined, acc)).data.activo.corriente.inventario_detalle;
  check(Math.abs(inv1.total - inv0.total) < 0.01, "D1. el balance cuenta lo que está allá: traerlo a la piladora no cambia el inventario total", { antes: inv0.total, ahora: inv1.total });
  const stockApi = (await api("GET", "/inventory/stock", undefined, acc)).data;
  check(stockApi.some((r) => r.warehouse_type === "EXTERNO" && r.product_id === arroz), "D2. Inventario recibe la parte de allá marcada (para mostrarla aparte)");

  // ── E. Flete de REGRESO ──
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
  const er = async () => (await api("GET", `/finance/income-statement?desde=${hoy}&hasta=${hoy}`, undefined, acc)).data.costo_ventas.servicios_recibidos;
  const carro = (await q("SELECT id FROM campo_activos WHERE activo AND tipo <> 'cosechadora' ORDER BY nombre LIMIT 1"))[0].id;
  const er0 = await er(), aE = await alla(arroz);
  check((await api("POST", "/selection/traer", { provider_id: prov.id, items: [{ product_id: arroz, quantity: 1 }], flete: { tipo: "propia", monto: 10 } }, acc)).status === 400
    && await alla(arroz) === aE, "E1. flete con carro propio pero sin elegir el carro → 400 y no se mueve nada");
  const v1 = exigir(await api("POST", "/selection/traer", { provider_id: prov.id, items: [{ product_id: arroz, quantity: 1 }], flete: { tipo: "propia", monto: 12, activo_id: carro } }, acc), "E2. traer 1 QQ con el carro de Transporte (flete $12)");
  const sv = (await q("SELECT s.id, s.valor::float v FROM campo_servicios s WHERE s.origen_tipo='envejecido_regreso' AND s.origen_id=$1", [v1.id]))[0];
  const cxp = sv && (await q("SELECT amount::float a, accionista_id FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [sv.id]))[0];
  check(sv?.v === 12 && cxp?.a === 12 && cxp.accionista_id === acc, "E3. Transporte cobra $12 al socio (servicio de Campo + Por Pagar espejo del socio)", { sv, cxp });
  const v2 = exigir(await api("POST", "/selection/traer", { provider_id: prov.id, items: [{ product_id: arroz, quantity: 1 }], flete: { tipo: "tercero", monto: 8, prestador: "Camión de Pedro" } }, acc), "E4. traer 1 QQ con un carro externo (flete $8)");
  const cxpT = (await q("SELECT amount::float a, description FROM accounts_payable WHERE reference_type='flete_envejecido_tercero' AND reference_id=$1", [v2.id]))[0];
  check(cxpT?.a === 8 && /regreso/i.test(cxpT.description), "E5. queda en Por Pagar al transportista externo", cxpT);
  check(Math.round((await er() - er0) * 100) / 100 === 20, "E6. el Estado de Resultados del socio suma los $20 de fletes de regreso como servicio recibido", { antes: er0, ahora: await er() });
  const ub3 = exigir(await api("GET", "/selection/ubicacion", undefined, acc), "E7. consulta de viajes");
  check(ub3.traidas.some((t) => t.id === v1.id && t.flete_monto === 12 && t.flete_tipo === "propia"), "E8. el viaje muestra su flete");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
