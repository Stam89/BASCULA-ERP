// 💾 Guardar Proceso con un lote de Desde Stock (pedido del dueño 2026-11-05: quedó a medias porque faltan pesar tulas):
// lo pilado suma, la cáscara sale de bodega y el pago aparece en Nómina, igual que con un túnel. SOLO copia.
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
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const acc = (await q("SELECT id FROM accionistas WHERE name = 'STALYN'"))[0].id;
  const nuevo = exigir(await api("POST", "/saldos-iniciales/inventario", { corte: "2026-11-03", product_id: P("CASCARA-011"), cantidad: 200, detalle: "sim lote a medias" }, acc), "0. cargar lote");
  const lote = (await q("SELECT id, lot_code FROM lots WHERE lot_code = $1", [nuevo.lote]))[0];
  exigir(await api("POST", "/reports/arianos/apartar", { ids: [lote.id], apartar: true }, acc), "0b. dejarlo en Lotes guardados");
  const qqDe = async (code) => Number((await q(
    "SELECT COALESCE(SUM(m.quantity),0)::float s FROM inventory_movements m JOIN products p ON p.id = m.product_id WHERE p.code = $1 AND m.lot_id = $2", [code, lote.id]))[0].s);
  const pagos = async (ref, tipo = "milling_draft") => q(
    "SELECT worker_role r, worker_name n, status s, qq::float qq, tulas::float tulas FROM worker_payments WHERE reference_type = $1 AND reference_id = $2 ORDER BY 1", [tipo, ref]);
  const guardar = (qq) => api("PUT", `/processing-batches/drafts/${lote.id}`, {
    report: { broken34: 16, fineBroken: 2, polvillo: 50, ...NOM },
    pilado_entries: [{ id: "a", presentation: "TULA", quantityQq: qq, destino: "TULA", tulas: 5 }], warehouse_id: bodPT
  }, acc);

  exigir(await guardar(85), "A1. guardar a medias con 85 QQ");
  check(cerca(await qqDe("ARROZ-PILADO-011"), 85), "A2. los 85 QQ ya cuentan en inventario", await qqDe("ARROZ-PILADO-011"));
  check(cerca(await qqDe("CASCARA-011"), 0), "A3. la cáscara salió de bodega", await qqDe("CASCARA-011"));
  let l = await pagos(lote.id);
  check(l.length === 3 && l.every((x) => x.s === "PENDING"), "A4. pilador, estibador y polvillo por pagar en Nómina", l);
  const lista = exigir(await api("GET", "/processing-batches/drafts", undefined, acc), "A5. lista");
  const d = lista.find((x) => x.drying_report_id === lote.id);
  check(d?.es_lote && d.lot_code === lote.lot_code && cerca(d.total_quintals, 200), "A6. sale en Procesos guardados con sus 200 QQ", JSON.stringify(d)?.slice(0, 200));
  const uno = exigir(await api("GET", `/processing-batches/drafts/${lote.id}`, undefined, acc), "A7. retomarlo");
  check(uno?.pilado_entries?.[0]?.quantityQq === 85, "A8. trae lo guardado", JSON.stringify(uno)?.slice(0, 160));
  const stock = exigir(await api("GET", "/lots/dry-in-storage", undefined, acc), "A9. stock").find((x) => x.id === lote.id);
  check(stock?.has_draft === true, "A10. el lote queda marcado con proceso guardado");

  exigir(await guardar(90), "B1. volver a guardar con 90 QQ");
  check(cerca(await qqDe("ARROZ-PILADO-011"), 90), "B2. no duplica: 90 QQ", await qqDe("ARROZ-PILADO-011"));
  check((await pagos(lote.id)).length === 3, "B3. los pagos se actualizan, no se suman");
  check(cerca(await qqDe("CASCARA-011"), 0), "B4. la cáscara sigue fuera");

  exigir(await api("DELETE", `/processing-batches/drafts/${lote.id}`, undefined, acc), "C1. descartar");
  check(cerca(await qqDe("ARROZ-PILADO-011"), 0) && cerca(await qqDe("CASCARA-011"), 200), "C2. todo vuelve a como estaba");
  check((await pagos(lote.id)).length === 0, "C3. sin pagos colgados");

  exigir(await guardar(85), "D1. guardar otra vez");
  const batch = exigir(await api("POST", "/processing-batches", { lot_id: lote.id, process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: 200 * 45.359237 }, acc), "D2. abrir la pilada");
  exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: lote.id, is_maquila: false, input_paddy_kg: 200 * 45.359237,
    pilador_name: NOM.pilador_name, estibador_name: NOM.estibador_name, polvillo_worker_name: NOM.polvillo_worker_name, tulas: 5,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: 110, unit: "QQ" },
    white_rice_presentations: [{ presentation: "TULA", quantity: 110, destino: "TULA", tulas: 5 }],
    bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: 50, unit: "QQ" },
    sacks_used: 0
  }, acc), "D3. finalizar con las tulas pesadas: 110 QQ");
  await api("DELETE", `/processing-batches/drafts/${lote.id}`, undefined, acc);
  check(cerca(await qqDe("ARROZ-PILADO-011"), 110), "D4. queda lo real, sin sumar lo guardado", await qqDe("ARROZ-PILADO-011"));
  check(cerca(await qqDe("CASCARA-011"), 0), "D5. la cáscara queda en cero, no en negativo", await qqDe("CASCARA-011"));
  check((await pagos(lote.id)).length === 0, "D6. nada colgado del proceso guardado");
  l = await pagos(batch.id, "processing_batch");
  check(l.filter((x) => x.r === "PILADOR").length === 1, "D7. un solo pago de pilador por lo real", l);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
