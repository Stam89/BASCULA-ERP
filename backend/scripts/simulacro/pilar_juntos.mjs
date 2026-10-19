// 🔗 Pilar juntos: dos túneles secos del mismo socio cuyo arroz se mezcló antes de la piladora entran a UNA pilada.
// SOLO contra la copia (sim_base aborta si no).
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const prods = await q("SELECT id, code FROM products");
  const P = (c) => prods.find((p) => p.code === c)?.id;
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const farmer = (await q("SELECT id FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const pend = await q("SELECT id, farmer_id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 5 AND lower(coalesce(raw_payload->>'modo','principal')) = 'principal' ORDER BY quintals DESC LIMIT 6");
  const libres = (await q("SELECT tunnel_number n FROM tunnel_status WHERE status = 'DISPONIBLE' ORDER BY 1")).map((x) => x.n);
  if (pend.length < 3 || libres.length < 3) throw new Error(`la copia no tiene suficientes tickets (${pend.length}) o túneles libres (${libres.length})`);
  let usados = 0;
  const secar = async (etiqueta, tipo = "0.11") => {
    const t = pend[usados], tunel = libres[usados]; usados++;
    if (!t.farmer_id) exigir(await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id }), `${etiqueta}: vincular agricultor`);
    const ing = exigir(await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: tipo, operation_type: "COMPRA", ownership: "OWNED" }), `${etiqueta}: ingresar ${t.qq} QQ`);
    const lleno = new Date(Date.now() - 20 * 3600e3).toISOString();
    const rep = exigir(await api("POST", "/process-flow/drying", { entry_ids: [ing.ingreso.id], tunnel_number: tunel, dryer_name: "Secadora " + tunel, rice_type: tipo, moisture_before: 22, filled_at: lleno, finalize: false }), `${etiqueta}: llenar túnel ${tunel}`);
    exigir(await api("PUT", `/process-flow/drying/${rep.id}`, { rice_type: tipo, moisture_before: 22, moisture_after: 13, filled_at: lleno, dry_start_at: new Date(Date.now() - 19 * 3600e3).toISOString(), dry_end_at: new Date().toISOString(), finalize: true, dryer_name: "Secadora " + tunel, entry_ids: [ing.ingreso.id] }), `${etiqueta}: finalizar secado`);
    return { rep, loteId: rep.lot_id ?? rep.lots?.[0]?.lot_id, qq: t.qq, kg: Number(rep.input_weight_kg ?? 0) };
  };
  const A = await secar("A"), B = await secar("B"), C = await secar("C", "CORRIENTE");

  // Otro tipo de arroz no se mezcla
  const malo = await api("POST", "/processing-batches", { lot_id: A.loteId, drying_report_id: A.rep.id, drying_report_ids_extra: [C.rep.id], process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: 1 });
  check(malo.status === 409, "1. no deja pilar junto un túnel de otro tipo de arroz (corriente con 0.11)", mostrar(malo));

  const batch = exigir(await api("POST", "/processing-batches", { lot_id: A.loteId, drying_report_id: A.rep.id, drying_report_ids_extra: [B.rep.id], process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: A.kg + B.kg }), "2. abrir UNA pilada con los túneles A y B juntos");
  const filas = await q("SELECT drying_report_id, lot_id FROM processing_batch_drying_lots WHERE processing_batch_id = $1", [batch.id]);
  check(filas.some((f) => f.drying_report_id === A.rep.id) && filas.some((f) => f.drying_report_id === B.rep.id), "3. la pilada guarda los lotes de los dos túneles", filas.length);
  check(Math.abs(Number(batch.input_quantity) - (A.kg + B.kg)) < 0.01, "4. la entrada es la suma de los dos túneles (kg)", { entrada: batch.input_quantity, esperado: A.kg + B.kg });
  const cascara = async (lot) => (await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_movements WHERE lot_id=$1 AND product_id=$2", [lot, P("CASCARA-011")]))[0].n;
  check(Math.abs(await cascara(A.loteId)) < 0.01 && Math.abs(await cascara(B.loteId)) < 0.01, "5. se descuenta la cáscara de los DOS lotes", { A: await cascara(A.loteId), B: await cascara(B.loteId) });
  const otra = await api("POST", "/processing-batches", { lot_id: B.loteId, drying_report_id: B.rep.id, process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: B.kg });
  check(otra.status === 409 && /junto con la secadora/.test(JSON.stringify(otra.data)), "6. el túnel B ya no se puede pilar aparte (mensaje claro)", mostrar(otra));
  const lista = exigir(await api("GET", "/process-flow/drying/reports"), "7. lista de secados");
  check(lista.find((r) => r.id === B.rep.id)?.has_draft === true, "8. el túnel B sale de «listos para pilar» (va en la pilada abierta)", lista.find((r) => r.id === B.rep.id)?.has_draft);

  const qq = A.qq + B.qq;
  exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: A.loteId, is_maquila: false, input_paddy_kg: A.kg + B.kg,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: r2(qq * 0.64), unit: "QQ" },
    broken_rice: { product_id: P("ARROCILLO-34"), warehouse_id: bodPT, quantity: r2(qq * 0.04), unit: "QQ" },
    fine_broken_rice: { product_id: P("ARROCILLO-FINO"), warehouse_id: bodPT, quantity: r2(qq * 0.03), unit: "QQ" },
    bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: r2(qq * 0.08), unit: "QQ" },
    sacks_used: 0
  }), "9. cerrar la pilada (salidas escritas una sola vez)");
  const est = await q("SELECT id, status::text s FROM lots WHERE id = ANY($1::uuid[])", [[A.loteId, B.loteId]]);
  check(est.every((x) => x.s === "PROCESSED"), "10. los dos lotes quedan PILADOS", est);
  const lista2 = exigir(await api("GET", "/process-flow/drying/reports"), "11. lista de secados");
  check(lista2.find((r) => r.id === A.rep.id)?.is_processed && lista2.find((r) => r.id === B.rep.id)?.is_processed, "12. los dos túneles quedan como procesados");
  const sal = (await q("SELECT COALESCE(sum(quantity),0)::float qq FROM inventory_movements WHERE reference_type='processing_batches' AND reference_id=$1 AND movement='PROCESS_OUTPUT'", [batch.id]))[0].qq;
  check(Math.abs(sal - r2(qq * 0.64) - r2(qq * 0.04) - r2(qq * 0.03) - r2(qq * 0.08)) < 0.05, "13. lo producido entra una sola vez al inventario", sal);

  // Anular devuelve los dos túneles
  const an = await api("POST", `/processing-batches/${batch.id}/anular`, { motivo: "prueba pilar juntos" });
  check(an.ok, "14. anular la pilada", an.ok ? undefined : mostrar(an));
  if (an.ok) {
    const l3 = exigir(await api("GET", "/process-flow/drying/reports"), "15. lista");
    check(!l3.find((r) => r.id === A.rep.id)?.is_processed && !l3.find((r) => r.id === B.rep.id)?.is_processed, "16. al anular, los dos túneles vuelven a estar listos para pilar");
  }
  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
