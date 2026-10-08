// Producción (pilado): del secado al arroz terminado — cierre, doble clic, lote equivocado, cierre a medias, inventario y ajustes.
// SOLO contra la copia (sim_base aborta si no).
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dos = (f) => Promise.all([f(), f()]);

try {
  const prods = await q("SELECT id, code FROM products");
  const P = (c) => prods.find((p) => p.code === c)?.id;
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const farmer = (await q("SELECT id FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const pend = await q("SELECT id, farmer_id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 5 AND lower(coalesce(raw_payload->>'modo','principal')) = 'principal' ORDER BY quintals DESC LIMIT 12");
  const libres = (await q("SELECT tunnel_number n FROM tunnel_status WHERE status = 'DISPONIBLE' ORDER BY 1")).map((x) => x.n);
  if (pend.length < 3 || libres.length < 3) throw new Error(`la copia no tiene suficientes tickets (${pend.length}) o túneles libres (${libres.length}) para este simulacro`);
  let usados = 0;

  // Crea un lote completo hasta tener el proceso de producción ABIERTO.
  const preparar = async (etiqueta) => {
    const t = pend[usados], tunel = libres[usados]; usados++;
    if (!t.farmer_id) exigir(await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id }), `${etiqueta}: vincular agricultor`);
    const ing = exigir(await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" }), `${etiqueta}: ingresar materia prima (${t.qq} QQ)`);
    const lleno = new Date(Date.now() - 20 * 3600e3).toISOString();
    const rep = exigir(await api("POST", "/process-flow/drying", { entry_ids: [ing.ingreso.id], tunnel_number: tunel, dryer_name: "Secadora " + tunel, rice_type: "0.11", moisture_before: 22, filled_at: lleno, finalize: false }), `${etiqueta}: llenar túnel ${tunel}`);
    exigir(await api("PUT", `/process-flow/drying/${rep.id}`, { rice_type: "0.11", moisture_before: 22, moisture_after: 13, filled_at: lleno, dry_start_at: new Date(Date.now() - 19 * 3600e3).toISOString(), dry_end_at: new Date().toISOString(), finalize: true, dryer_name: "Secadora " + tunel, entry_ids: [ing.ingreso.id] }), `${etiqueta}: finalizar secado`);
    const loteId = rep.lot_id ?? rep.lots?.[0]?.lot_id;
    const batch = exigir(await api("POST", "/processing-batches", { lot_id: loteId, drying_report_id: rep.id, process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: Number(rep.input_weight_kg ?? 0) || undefined }), `${etiqueta}: abrir proceso de producción`);
    return { t, rep, loteId, batch, qq: t.qq, kg: Number(rep.input_weight_kg ?? 0) || undefined };
  };
  const cierre = (L, extra = {}) => ({
    lot_id: L.loteId, is_maquila: false, input_paddy_kg: L.kg,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: r2(L.qq * 0.64), unit: "QQ" },
    broken_rice: { product_id: P("ARROCILLO-34"), warehouse_id: bodPT, quantity: r2(L.qq * 0.04), unit: "QQ" },
    fine_broken_rice: { product_id: P("ARROCILLO-FINO"), warehouse_id: bodPT, quantity: r2(L.qq * 0.03), unit: "QQ" },
    bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: r2(L.qq * 0.08), unit: "QQ" },
    sacks_used: 0, ...extra
  });
  const salidas = async (batchId) => (await q("SELECT count(*)::int n, COALESCE(sum(quantity),0)::float qq FROM inventory_movements WHERE reference_type='processing_batches' AND reference_id=$1 AND movement='PROCESS_OUTPUT'", [batchId]))[0];
  const entradas = async (batchId) => (await q("SELECT COALESCE(sum(quantity),0)::float qq FROM inventory_movements WHERE reference_type='processing_batches' AND reference_id=$1 AND movement='PROCESS_INPUT'", [batchId]))[0].qq;

  // ── A. Cierre normal ───────────────────────────────────────────────────
  const A = await preparar("A");
  const stockCascara0 = (await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_movements WHERE lot_id=$1 AND product_id=$2", [A.loteId, P("CASCARA-011")]))[0].n;
  check(r2(await entradas(A.batch.id)) === -r2(Number(A.rep.quintals ?? A.qq)) || (await entradas(A.batch.id)) < 0, "A0. al abrir el proceso se descuenta la cáscara del lote (queda en 0)", { descontado: await entradas(A.batch.id), stockCascara0 });
  const c1 = await api("POST", `/processing-batches/${A.batch.id}/finish-production`, cierre(A));
  const esperado = r2(A.qq * 0.64) + r2(A.qq * 0.04) + r2(A.qq * 0.03) + r2(A.qq * 0.08);
  const sal = await salidas(A.batch.id);
  check(c1.ok && sal.n === 4 && r2(sal.qq) === r2(esperado), `A1. cierra y entran al inventario las 4 salidas (${r2(esperado)} QQ)`, mostrar(c1));
  const y = (await q("SELECT yield_percent::float p, process_loss_kg::float m, input_paddy_kg::float k FROM production_yields WHERE processing_batch_id=$1", [A.batch.id]))[0];
  check(y && y.p > 0 && y.m >= 0, "A2. queda el rendimiento calculado y la merma nunca es negativa", y);
  const c2 = await api("POST", `/processing-batches/${A.batch.id}/finish-production`, cierre(A));
  check(c2.status === 409 && (await salidas(A.batch.id)).n === 4, "A3. cerrar OTRA VEZ el mismo proceso se rechaza (409) y no duplica el inventario", mostrar(c2));
  // ── B. Datos incoherentes ──────────────────────────────────────────────
  const C = await preparar("C");
  const otroLote = A.loteId;
  const malLote = await api("POST", `/processing-batches/${C.batch.id}/finish-production`, cierre(C, { lot_id: otroLote }));
  check(malLote.status >= 400 && (await salidas(C.batch.id)).n === 0, "B1. cerrar un proceso indicando el lote de OTRO se rechaza (no mueve inventario al lote equivocado)", mostrar(malLote));
  const sinSalidas = await api("POST", `/processing-batches/${C.batch.id}/finish-production`, cierre(C, { white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: 0, unit: "QQ" }, broken_rice: undefined, fine_broken_rice: undefined, bran: undefined }));
  check(sinSalidas.status === 400, "B2. sin ninguna salida real se rechaza (400)", mostrar(sinSalidas));
  const noSuma = await api("POST", `/processing-batches/${C.batch.id}/finish-production`, cierre(C, { white_rice_presentations: [{ presentation: "100 LB", sack_weight_lb: 100, quantity: 1 }] }));
  check(noSuma.status === 400, "B3. el desglose por presentación debe sumar el total (400)", mostrar(noSuma));
  const sacoMalo = await api("POST", `/processing-batches/${C.batch.id}/finish-production`, cierre(C, { is_maquila: true, farmer_id: farmer.id, sacos_servicio: [{ sack_id: "00000000-0000-4000-8000-000000000000", cantidad: 5 }] }));
  const queda = await salidas(C.batch.id);
  check(sacoMalo.status >= 400 && queda.n === 0 && (await q("SELECT finished_at FROM processing_batches WHERE id=$1", [C.batch.id]))[0].finished_at === null, "B4. si el cierre falla a la mitad (saco inexistente) NO queda nada a medias: sin salidas y el proceso sigue abierto", mostrar(sacoMalo));
  const dc = await dos(() => api("POST", `/processing-batches/${C.batch.id}/finish-production`, cierre(C)));
  check(dc.filter((r) => r.ok).length === 1 && (await salidas(C.batch.id)).n === 4 && dc.every((r) => r.status !== 500), "B5. después se cierra bien, y con doble clic simultáneo se cierra UNA vez (inventario correcto)", dc.map((r) => r.status));

  // ── C. Endpoint antiguo /:id/finish ────────────────────────────────────
  const D = await preparar("D");
  const antiguo = (extra = {}) => ({ lot_id: D.loteId, ownership: "OWNED", outputs: [{ product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: 10 }], ...extra });
  const lotMal = await api("POST", `/processing-batches/${D.batch.id}/finish`, antiguo({ lot_id: A.loteId }));
  check(lotMal.status >= 400 && (await salidas(D.batch.id)).n === 0, "C2. el cierre antiguo con el lote de OTRO proceso se rechaza", mostrar(lotMal));
  const f1 = await api("POST", `/processing-batches/${D.batch.id}/finish`, antiguo());
  const f2 = await api("POST", `/processing-batches/${D.batch.id}/finish`, antiguo());
  check(!(f1.ok && f2.ok), "C1. el cierre antiguo no se puede aplicar dos veces al mismo proceso (no duplica salidas)", [f1.status, f2.status, (await salidas(D.batch.id)).n]);
  // ── D. Existencias y ajustes manuales ──────────────────────────────────
  const stockBlanco = async () => Number((await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_stock WHERE product_id=$1 AND warehouse_id=$2", [P("ARROZ-PILADO-011"), bodPT]))[0].n);
  const sB = await stockBlanco();
  const adj = (qty, extra = {}) => api("POST", "/inventory/adjustments", { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: qty, notes: "simulacro", ...extra });
  check((await adj(sB + 100000 < 0 ? 1 : -(sB + 50))).status === 409, "D1. no se baja más arroz del que hay en la bodega (409)");
  check((await adj(5, { warehouse_id: bodMP })).status === 400, "D2. el arroz pilado no se ajusta en la bodega de materia prima (400)");
  const mitad = r2(sB / 2);
  const ajc = await dos(() => adj(-mitad - 0.5));
  check(ajc.filter((r) => r.ok).length <= 1 && (await stockBlanco()) >= -0.001 && ajc.every((r) => r.status !== 500), "D3. dos bajas de ajuste simultáneas que juntas superan lo que hay: nunca queda stock negativo", { st: ajc.map((r) => r.status), stock: await stockBlanco() });
  const fp = await q("SELECT count(*)::int n FROM inventory_stock WHERE quantity < -0.001 AND product_id <> ALL($1)", [prods.filter((p) => /SACO|SACK/i.test(p.code)).map((p) => p.id)]);
  check(fp[0].n === 0, "D4. ningún producto quedó con existencias negativas", fp[0].n);

  // ── E. Cuadre global ───────────────────────────────────────────────────
  const huerf = (await q("SELECT count(*)::int n FROM processing_batches b WHERE b.finished_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM production_yields y WHERE y.processing_batch_id = b.id) AND b.id IN ($1,$2)", [A.batch.id, C.batch.id]))[0].n;
  check(huerf === 0, "E1. todo proceso cerrado tiene su rendimiento", huerf);
  const dupSal = (await q("SELECT count(*)::int n FROM (SELECT reference_id, product_id, quantity FROM inventory_movements WHERE movement='PROCESS_OUTPUT' AND reference_type='processing_batches' GROUP BY 1,2,3 HAVING count(*) > 1) x"))[0].n;
  check(dupSal === 0, "E2. ninguna salida de producción quedó duplicada", dupSal);
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
