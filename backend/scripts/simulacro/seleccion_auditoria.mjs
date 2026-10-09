// 🧹 Auditoría de Selección y envejecido: validaciones al mandar, tarifa con permiso, reabrir un lote mal registrado,
// anular un viaje traído (con su flete) y los controles de integridad. SOLO contra la copia (sim_base aborta si no).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q } = S;
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const MIG = (f) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations", f);

try {
  for (const [f, sql] of [["20261081_envejecido_alla.sql", "SELECT 1 FROM information_schema.columns WHERE table_name='selection_batch_outputs' AND column_name='qty_alla'"],
    ["20261082_flete_regreso_envejecido.sql", "SELECT 1 FROM information_schema.columns WHERE table_name='selection_traidas' AND column_name='flete_tipo'"],
    ["20261083_seleccion_anulaciones.sql", "SELECT 1 FROM information_schema.columns WHERE table_name='selection_traidas' AND column_name='anulado_at'"]]) {
    if (!(await q(sql)).length) { await q(fs.readFileSync(MIG(f), "utf8")); console.log(`   (info) migración ${f} aplicada en la COPIA`); }
  }
  const acc = (await q("SELECT id FROM accionistas WHERE COALESCE(modulo_envejecido_habilitado, puede_envejecer) ORDER BY name LIMIT 1"))[0].id;
  const prov = (await q("SELECT id, name FROM external_providers WHERE is_active ORDER BY name LIMIT 1"))[0];
  const P = async (code) => (await q("SELECT id FROM products WHERE code=$1", [code]))[0]?.id;
  const arroz = await P("ARROZ-PILADO-011"), a34 = await P("ARROCILLO-34"), polv = await P("POLVILLO"), cascara = await P("CASCARA-011");
  const empacado = (await q("SELECT id FROM products WHERE product_type='PACKAGED_GOOD' AND is_active LIMIT 1"))[0]?.id;
  const bodPT = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',60,'simulacro','OWNED',$3)", [arroz, bodPT, acc]);
  const stock = async (pid, externo) => r3((await q(
    `SELECT COALESCE(sum(m.quantity),0)::float n FROM inventory_movements m JOIN warehouses w ON w.id=m.warehouse_id
      WHERE m.product_id=$1 AND m.accionista_id=$2 AND m.ownership='OWNED' AND (w.type='EXTERNO') = $3`, [pid, acc, externo]))[0].n);
  const mandar = (inputs, extra = {}, como = api) => como("POST", "/selection/batches", { provider_id: prov.id, service_type: "ENVEJECIMIENTO", warehouse_id: bodPT, inputs, ...extra }, acc);

  // ── A. Validaciones al mandar ──
  const loteA = exigir(await mandar([{ product_id: arroz, quantity: 1 }]), "A0. lote para crear la bodega «Allá»");
  exigir(await api("POST", `/selection/batches/${loteA.id}/finish`, { outputs: [{ product_id: arroz, quantity: 1, qty_alla: 1 }] }, acc), "A0b. recibido allá");
  const bodAlla = (await q("SELECT id FROM warehouses WHERE external_provider_id=$1", [prov.id]))[0].id;
  check((await api("POST", "/selection/batches", { provider_id: prov.id, service_type: "ENVEJECIMIENTO", warehouse_id: bodAlla, inputs: [{ product_id: arroz, quantity: 1 }] }, acc)).status === 400, "A1. no se puede mandar desde la bodega «Allá» → 400");
  check((await mandar([{ product_id: cascara, quantity: 1 }])).status === 400, "A2. no se manda cáscara → 400");
  if (empacado) check((await mandar([{ product_id: empacado, quantity: 1 }])).status === 400, "A3. no se manda arroz empacado por marca → 400");
  check((await mandar([{ product_id: polv, quantity: 1 }])).status === 400, "A4. no se manda polvillo → 400");
  const rol = (await q("SELECT id FROM roles WHERE name='OPERADOR'"))[0].id;
  const u = (await q("INSERT INTO users (name, username, password_hash, role_id, is_active) VALUES ('sim_sel','sim_sel','x',$1,true) RETURNING id", [rol]))[0].id;
  await q("INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules) VALUES ($1,$2,$3)", [u, acc, ["Seleccion", "EDIT:Seleccion"]]);
  const oper = apiComo(u, "sim_sel", "sim_sel", acc);
  const vigente = (await api("GET", "/selection/rates", undefined, acc)).data.envejecimiento_rate;
  check((await mandar([{ product_id: arroz, quantity: 1 }], { rate_per_qq: vigente + 1 }, oper)).status === 403, "A5. un operador sin permiso de precios NO puede cambiar la tarifa del lote → 403");
  const conVigente = await mandar([{ product_id: arroz, quantity: 1 }], { rate_per_qq: vigente }, oper);
  check(conVigente.ok, "A6. con la tarifa vigente sí puede mandar", conVigente.ok ? undefined : mostrar(conVigente));
  if (conVigente.ok) exigir(await api("POST", `/selection/batches/${conVigente.data.id}/cancel`, {}, acc), "A6b. (se cancela)");

  // ── B. Reabrir un lote mal registrado ──
  const pB0 = await stock(arroz, false), aB0 = await stock(arroz, true), s34 = await stock(a34, false);
  const lote = exigir(await mandar([{ product_id: arroz, quantity: 20 }]), "B1. mandar 20 QQ");
  exigir(await api("POST", `/selection/batches/${lote.id}/finish`, { outputs: [{ product_id: arroz, quantity: 15, qty_alla: 10 }, { product_id: a34, quantity: 2 }] }, acc), "B2. informe mal registrado: 15 (10 allá) + 2 de 3/4");
  check((await api("POST", `/selection/batches/${lote.id}/reabrir`, { motivo: "no" }, acc)).status === 400, "B3. sin motivo → 400");
  exigir(await api("POST", `/selection/batches/${lote.id}/reabrir`, { motivo: "se registraron mal las cantidades" }, acc), "B4. reabrir el lote");
  const bB = (await q("SELECT status, output_qq FROM selection_batches WHERE id=$1", [lote.id]))[0];
  check(bB.status === "IN_PROCESS" && Number(bB.output_qq) === 0 && await stock(arroz, false) === r3(pB0 - 20) && await stock(arroz, true) === aB0 && await stock(a34, false) === s34,
    "B5. vuelve a «En proceso» y lo recibido sale de la piladora y de «Allá»", { bB, piladora: await stock(arroz, false), alla: await stock(arroz, true) });
  check((await q("SELECT 1 FROM selection_batch_reaperturas WHERE batch_id=$1", [lote.id])).length === 1, "B6. queda el historial de la reapertura con el informe anterior");
  exigir(await api("POST", `/selection/batches/${lote.id}/finish`, { outputs: [{ product_id: arroz, quantity: 18, qty_alla: 6 }, { product_id: a34, quantity: 1.5 }] }, acc), "B7. se registra bien: 18 (6 allá) + 1.5 de 3/4");
  check(await stock(arroz, false) === r3(pB0 - 20 + 12) && await stock(arroz, true) === r3(aB0 + 6), "B8. inventario con las cifras correctas");

  // ── C. Viaje traído y su anulación ──
  const carro = (await q("SELECT id FROM campo_activos WHERE activo AND tipo <> 'cosechadora' ORDER BY nombre LIMIT 1"))[0].id;
  const v1 = exigir(await api("POST", "/selection/traer", { provider_id: prov.id, items: [{ product_id: arroz, quantity: 4 }], flete: { tipo: "propia", monto: 9, activo_id: carro } }, acc), "C1. traer 4 QQ con carro de Transporte ($9)");
  check((await api("POST", `/selection/batches/${lote.id}/reabrir`, { motivo: "otro error más" }, acc)).status === 409, "C2. con parte de «Allá» ya traída, reabrir el lote no deja (409) hasta anular el viaje");
  const pC = await stock(arroz, false), aC = await stock(arroz, true);
  exigir(await api("POST", `/selection/traidas/${v1.id}/anular`, { motivo: "las cantidades eran otras" }, acc), "C3. anular el viaje");
  check(await stock(arroz, false) === r3(pC - 4) && await stock(arroz, true) === r3(aC + 4), "C4. los 4 QQ salen de la piladora y vuelven a «Allá»");
  check(!(await q("SELECT 1 FROM campo_servicios WHERE origen_tipo='envejecido_regreso' AND origen_id=$1", [v1.id])).length
    && !(await q("SELECT 1 FROM accounts_payable p JOIN campo_servicios s ON s.id=p.reference_id WHERE p.reference_type='campo_servicio' AND s.origen_id=$1", [v1.id])).length,
    "C5. se deshizo el flete de Transporte (servicio y Por Pagar del socio)");
  check((await api("POST", `/selection/traidas/${v1.id}/anular`, { motivo: "otra vez lo mismo" }, acc)).status === 409, "C6. anularlo dos veces → 409");
  const v2 = exigir(await api("POST", "/selection/traer", { provider_id: prov.id, items: [{ product_id: arroz, quantity: 2 }], flete: { tipo: "tercero", monto: 5, prestador: "Camión Luis" } }, acc), "C7. traer 2 QQ con carro externo ($5)");
  exigir(await api("POST", `/selection/traidas/${v2.id}/anular`, { motivo: "viaje registrado dos veces" }, acc), "C8. anular el viaje con carro externo");
  check((await q("SELECT p.status FROM accounts_payable p JOIN selection_traidas t ON t.flete_payable_id=p.id WHERE t.id=$1", [v2.id]))[0]?.status === "CANCELLED", "C9. su Por Pagar al transportista queda anulada");
  const lista = exigir(await api("GET", "/selection/ubicacion", undefined, acc), "C10. viajes");
  check(lista.traidas.filter((t) => [v1.id, v2.id].includes(t.id)).every((t) => t.anulado_at && t.anulado_motivo), "C11. los viajes anulados se ven como anulados con su motivo (no se borran)");
  check((await oper("POST", `/selection/traidas/${v2.id}/anular`, { motivo: "prueba de permiso" })).status === 403, "C12. sin el permiso «Anular» no se anula un viaje → 403");
  exigir(await api("POST", `/selection/batches/${lote.id}/reabrir`, { motivo: "ahora sí se puede reabrir" }, acc), "C13. sin viajes vigentes, el lote ya se puede reabrir");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
