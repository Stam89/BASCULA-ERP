// ♻️ Rechazo de la selectora en el pilado (pedido del dueño 2026-11-12): al guardar el proceso ya cuenta en inventario y al
// finalizar queda lo real, como el polvillo. Es del dueño del lote (producto RECHAZO). SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const NOM = { pilador_name: "SIM PILADOR", estibador_name: "SIM ESTIBADOR", polvillo_worker_name: "SIM POLVILLO" };
try {
  const prods = await q("SELECT id, code FROM products");
  const P = (c) => prods.find((p) => p.code === c)?.id;
  check(Boolean(P("RECHAZO")), "0. existe el producto RECHAZO");
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const acc = (await q("SELECT id FROM accionistas WHERE name = 'STALYN'"))[0].id;
  const nuevo = exigir(await api("POST", "/saldos-iniciales/inventario", { corte: "2026-11-03", product_id: P("CASCARA-011"), cantidad: 200, detalle: "sim rechazo" }, acc), "0b. cargar lote");
  const lote = (await q("SELECT id FROM lots WHERE lot_code = $1", [nuevo.lote]))[0];
  exigir(await api("POST", "/reports/arianos/apartar", { ids: [lote.id], apartar: true }, acc), "0c. dejarlo en Lotes guardados");
  const qqDe = async (code) => Number((await q(
    "SELECT COALESCE(SUM(m.quantity),0)::float s FROM inventory_movements m JOIN products p ON p.id = m.product_id WHERE p.code = $1 AND m.lot_id = $2 AND m.accionista_id = $3", [code, lote.id, acc]))[0].s);

  exigir(await api("PUT", `/processing-batches/drafts/${lote.id}`, {
    report: { broken34: 10, fineBroken: 2, polvillo: 40, rechazo: 3, ...NOM },
    pilado_entries: [{ id: "a", presentation: "TULA", quantityQq: 100, destino: "TULA", tulas: 5 }], warehouse_id: bodPT
  }, acc), "A1. guardar el proceso con 3 QQ de rechazo");
  check(cerca(await qqDe("RECHAZO"), 3), "A2. los 3 QQ de rechazo ya están en inventario de STALYN", await qqDe("RECHAZO"));
  check(cerca(await qqDe("POLVILLO"), 40), "A3. el polvillo igual que siempre");

  const batch = exigir(await api("POST", "/processing-batches", { lot_id: lote.id, process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: 200 * 45.359237 }, acc), "B1. abrir la pilada");
  const fin = exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: lote.id, is_maquila: false, input_paddy_kg: 200 * 45.359237, ...NOM, tulas: 5,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: 110, unit: "QQ" },
    white_rice_presentations: [{ presentation: "TULA", quantity: 110, destino: "TULA", tulas: 5 }],
    bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: 40, unit: "QQ" },
    rechazo: { product_id: P("RECHAZO"), warehouse_id: bodPT, quantity: 4.5, unit: "QQ" },
    sacks_used: 0
  }, acc), "B2. finalizar con 4.5 QQ de rechazo real");
  await api("DELETE", `/processing-batches/drafts/${lote.id}`, undefined, acc);
  check(cerca(await qqDe("RECHAZO"), 4.5), "B3. queda lo real (4.5), sin sumar lo guardado", await qqDe("RECHAZO"));
  const sal = await q("SELECT p.code, po.quantity::float q, po.is_byproduct FROM processing_outputs po JOIN products p ON p.id = po.product_id WHERE po.processing_batch_id = $1", [batch.id]);
  check(sal.some((x) => x.code === "RECHAZO" && cerca(x.q, 4.5) && x.is_byproduct), "B4. el rechazo queda como subproducto del proceso", sal);
  const y = (await q("SELECT total_output_kg::float t FROM production_yields WHERE processing_batch_id = $1", [batch.id]))[0];
  check(y && cerca(y.t, (110 + 40 + 4.5) * 45.359237), "B5. el rechazo suma en la salida total (rendimiento)", { y, fin: Boolean(fin) });

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
