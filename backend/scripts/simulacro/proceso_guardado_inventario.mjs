// 📦 Proceso guardado cuenta en inventario (pedido del dueño 2026-10-23): lo pilado que queda en «Guardar Proceso» ya suma
// al stock; al volver a guardar se ajusta; al descartar se retira; al finalizar se reemplaza por las salidas reales. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const prods = await q("SELECT id, code FROM products");
  const P = (c) => prods.find((p) => p.code === c)?.id;
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const farmer = (await q("SELECT id FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const pend = await q("SELECT id, farmer_id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 5 AND lower(coalesce(raw_payload->>'modo','principal')) = 'principal' ORDER BY quintals DESC LIMIT 6");
  const libres = (await q("SELECT tunnel_number n FROM tunnel_status WHERE status = 'DISPONIBLE' ORDER BY 1")).map((x) => x.n);
  if (pend.length < 2 || libres.length < 2) throw new Error(`la copia no tiene tickets (${pend.length}) o túneles libres (${libres.length})`);
  let usados = 0;
  const secar = async (etiqueta) => {
    const t = pend[usados], tunel = libres[usados]; usados++;
    if (!t.farmer_id) exigir(await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id }), `${etiqueta}: vincular agricultor`);
    const ing = exigir(await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" }), `${etiqueta}: ingresar (${t.qq} QQ)`);
    const lleno = new Date(Date.now() - 20 * 3600e3).toISOString();
    const rep = exigir(await api("POST", "/process-flow/drying", { entry_ids: [ing.ingreso.id], tunnel_number: tunel, dryer_name: "Secadora " + tunel, rice_type: "0.11", moisture_before: 22, filled_at: lleno, finalize: false }), `${etiqueta}: llenar túnel ${tunel}`);
    exigir(await api("PUT", `/process-flow/drying/${rep.id}`, { rice_type: "0.11", moisture_before: 22, moisture_after: 13, filled_at: lleno, dry_start_at: new Date(Date.now() - 19 * 3600e3).toISOString(), dry_end_at: new Date().toISOString(), finalize: true, dryer_name: "Secadora " + tunel, entry_ids: [ing.ingreso.id] }), `${etiqueta}: finalizar secado`);
    return { t, rep, loteId: rep.lot_id ?? rep.lots?.[0]?.lot_id, kg: Number(rep.input_weight_kg ?? 0) || undefined };
  };
  const stock = async (code) => Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id=$1 AND warehouse_id=$2", [P(code), bodPT]))[0].s);
  const netoBorrador = async (id) => Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE reference_type='milling_draft' AND reference_id=$1", [id]))[0].s);
  const guardar = (rep, blancoQq, polvillo = "") => api("PUT", `/processing-batches/drafts/${rep.id}`, {
    report: { broken34: "", fineBroken: "", polvillo }, warehouse_id: bodPT,
    pilado_entries: [{ id: "a", presentation: "100 LB", quantityQq: blancoQq * 0.6, destino: "SACO" }, { id: "b", presentation: "TULA", quantityQq: blancoQq * 0.4, destino: "TULA", tulas: 2 }]
  });

  // ── A. Guardar suma; volver a guardar ajusta; descartar retira ──
  const A = await secar("A");
  const b0 = await stock("ARROZ-PILADO-011"), p0 = await stock("POLVILLO");
  exigir(await guardar(A.rep, 20, "3"), "A1. guardar el proceso con 20 QQ de blanco y 3 de polvillo");
  check(r2(await stock("ARROZ-PILADO-011") - b0) === 20 && r2(await stock("POLVILLO") - p0) === 3, "A2. lo guardado YA cuenta en inventario (+20 blanco, +3 polvillo)", { blanco: r2(await stock("ARROZ-PILADO-011") - b0) });
  exigir(await guardar(A.rep, 35, "3"), "A3. seguir pilando y guardar otra vez (35 QQ)");
  check(r2(await stock("ARROZ-PILADO-011") - b0) === 35 && r2(await stock("POLVILLO") - p0) === 3, "A4. al volver a guardar no se duplica: queda 35 (solo entra la diferencia)");
  exigir(await guardar(A.rep, 35, "3"), "A5. guardar igual otra vez");
  check((await q("SELECT count(*)::int n FROM inventory_movements WHERE reference_type='milling_draft' AND reference_id=$1", [A.rep.id]))[0].n === 3, "A6. guardar sin cambios no agrega movimientos");
  const kx = exigir(await api("GET", `/inventory/kardex?product_id=${P("ARROZ-PILADO-011")}`), "A7. kardex del blanco");
  const filasK = Array.isArray(kx) ? kx : (kx.movimientos ?? kx.filas ?? []);
  check(JSON.stringify(filasK).includes("Proceso guardado"), "A8. en el Kardex sale como «Proceso guardado»");
  const del = await api("DELETE", `/processing-batches/drafts/${A.rep.id}`);
  check(del.status === 204 && r2(await stock("ARROZ-PILADO-011")) === r2(b0) && r2(await stock("POLVILLO")) === r2(p0) && (await netoBorrador(A.rep.id)) === 0, "A9. descartar el proceso retira lo que había sumado", mostrar(del));

  // ── B. Finalizar: se cambia lo guardado por las salidas reales (sin duplicar) ──
  const B = await secar("B");
  const s0 = await stock("ARROZ-PILADO-011");
  exigir(await guardar(B.rep, 25), "B1. guardar 25 QQ");
  check(r2(await stock("ARROZ-PILADO-011") - s0) === 25, "B2. +25 en inventario mientras está guardado");
  const batch = exigir(await api("POST", "/processing-batches", { lot_id: B.loteId, drying_report_id: B.rep.id, process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: B.kg }), "B3. abrir proceso al finalizar");
  exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: B.loteId, is_maquila: false, input_paddy_kg: B.kg, drying_report_id: B.rep.id,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: 30, unit: "QQ" }, sacks_used: 0
  }), "B4. finalizar el lote con 30 QQ reales");
  check(r2(await stock("ARROZ-PILADO-011") - s0) === 30 && (await netoBorrador(B.rep.id)) === 0, "B5. queda solo lo real (30), lo del borrador se retiró", { dif: r2(await stock("ARROZ-PILADO-011") - s0) });
  await api("DELETE", `/processing-batches/drafts/${B.rep.id}`);
  check(r2(await stock("ARROZ-PILADO-011") - s0) === 30, "B6. borrar el borrador después de finalizar no mueve nada");
  const reGuardar = await guardar(B.rep, 10);
  check(reGuardar.status === 409 && r2(await stock("ARROZ-PILADO-011") - s0) === 30, "B7. un túnel ya cerrado no se puede volver a guardar", mostrar(reGuardar));

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
