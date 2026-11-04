// 💼 Proceso guardado en nómina (pedido del dueño 2026-11-03): al guardar, el pago de pilador, estibador y polvillo ya
// aparece; al retomar y guardar se actualiza sin duplicar; lo ya pagado no se vuelve a pagar al finalizar. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
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
  const secar = async (et) => {
    const t = pend[usados], tunel = libres[usados]; usados++;
    if (!t.farmer_id) exigir(await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id }), `${et}: vincular agricultor`);
    const ing = exigir(await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" }), `${et}: ingresar (${t.qq} QQ)`);
    const lleno = new Date(Date.now() - 20 * 3600e3).toISOString();
    const rep = exigir(await api("POST", "/process-flow/drying", { entry_ids: [ing.ingreso.id], tunnel_number: tunel, dryer_name: "Secadora " + tunel, rice_type: "0.11", moisture_before: 22, filled_at: lleno, finalize: false }), `${et}: llenar túnel ${tunel}`);
    exigir(await api("PUT", `/process-flow/drying/${rep.id}`, { rice_type: "0.11", moisture_before: 22, moisture_after: 13, filled_at: lleno, dry_start_at: new Date(Date.now() - 19 * 3600e3).toISOString(), dry_end_at: new Date().toISOString(), finalize: true, dryer_name: "Secadora " + tunel, entry_ids: [ing.ingreso.id] }), `${et}: finalizar secado`);
    return { rep, loteId: rep.lot_id ?? rep.lots?.[0]?.lot_id, kg: Number(rep.input_weight_kg ?? 0) || undefined };
  };
  const NOM = { pilador_name: "SIM PILADOR", estibador_name: "SIM ESTIBADOR", polvillo_worker_name: "SIM POLVILLO" };
  const guardar = (rep, qq, nombres = NOM) => api("PUT", `/processing-batches/drafts/${rep.id}`, {
    report: { broken34: "2", fineBroken: "", polvillo: "4", ...nombres }, warehouse_id: bodPT,
    pilado_entries: [{ id: "a", presentation: "100 LB", quantityQq: qq, destino: "SACO" }]
  });
  const pagos = (id, tipo = "milling_draft") => q("SELECT id, worker_role r, worker_name n, status s, qq::float qq, sacas::float sacas, arrocillo::float arr, base_amount::float base FROM worker_payments WHERE reference_type=$1 AND reference_id=$2 ORDER BY worker_role, created_at", [tipo, id]);
  const rol = (l, r) => l.filter((x) => x.r === r);

  // ── A. Guardar aparece; volver a guardar actualiza; descartar quita ──
  const A = await secar("A");
  exigir(await guardar(A.rep, 20), "A1. guardar 20 QQ con el personal de turno");
  let l = await pagos(A.rep.id);
  check(l.length === 3 && l.every((x) => x.s === "PENDING"), "A2. ya aparecen pilador, estibador y polvillo por pagar", l);
  check(rol(l, "PILADOR")[0].qq === 20 && rol(l, "PILADOR")[0].sacas === 20, "A3. el pilador con 20 QQ y 20 sacas", rol(l, "PILADOR"));
  check(rol(l, "ESTIBADOR")[0].arr === 2 && rol(l, "POLVILLO")[0].qq === 4, "A4. estibador con arrocillo y polvillo con 4 QQ", l);
  const base20 = rol(l, "PILADOR")[0].base;
  exigir(await guardar(A.rep, 35), "A5. retomar y guardar 35 QQ");
  l = await pagos(A.rep.id);
  check(l.length === 3 && rol(l, "PILADOR")[0].qq === 35 && r2(rol(l, "PILADOR")[0].base) === r2(base20 * 35 / 20), "A6. NO se duplica: una fila por rol, ahora con 35 QQ", l);
  exigir(await guardar(A.rep, 35, { ...NOM, estibador_name: "SIM OTRO" }), "A7. cambiar el estibador");
  l = await pagos(A.rep.id);
  check(l.length === 3 && rol(l, "ESTIBADOR")[0].n === "SIM OTRO", "A8. el pago pasa al nuevo estibador", rol(l, "ESTIBADOR"));
  const rec = exigir(await api("GET", "/labor/worker-receipt?role=PILADOR&name=SIM%20PILADOR&from=2020-01-01&to=2030-01-01", undefined, matriz), "A9. recibo del pilador");
  check(JSON.stringify(rec).includes("proceso guardado") && JSON.stringify(rec).includes("Lote"), "A10. el recibo dice el lote y «proceso guardado»", JSON.stringify(rec).slice(0, 220));
  const del = await api("DELETE", `/processing-batches/drafts/${A.rep.id}`);
  check(del.status === 204 && (await pagos(A.rep.id)).length === 0, "A11. descartar quita los pagos pendientes", mostrar(del));

  // ── B. Se paga una parte, se sigue pilando y se finaliza: nada se paga dos veces ──
  const B = await secar("B");
  exigir(await guardar(B.rep, 20), "B1. guardar 20 QQ");
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim nómina", tipo: "EFECTIVO", opening_balance_cash: 500 }, matriz), "B2. caja").id;
  const pilId = rol(await pagos(B.rep.id), "PILADOR")[0].id;
  exigir(await api("POST", `/labor/payments/${pilId}/pay`, { cash_register_id: caja }, matriz), "B3. pagar al pilador lo de 20 QQ");
  check(rol(await pagos(B.rep.id), "PILADOR")[0].s === "PAID", "B4. queda pagado");
  const noDescarta = await api("DELETE", `/processing-batches/drafts/${B.rep.id}`);
  check(noDescarta.status === 409 && (await pagos(B.rep.id)).length === 3, "B5. con algo pagado no se deja descartar", mostrar(noDescarta));
  exigir(await guardar(B.rep, 30), "B6. retomar y guardar 30 QQ");
  l = rol(await pagos(B.rep.id), "PILADOR");
  check(l.length === 2 && l.find((x) => x.s === "PENDING")?.qq === 10, "B7. al pilador solo le aparece la diferencia: 10 QQ", l);
  exigir(await guardar(B.rep, 30), "B8. guardar igual");
  check(rol(await pagos(B.rep.id), "PILADOR").length === 2, "B9. guardar sin cambios no agrega nada");

  const batch = exigir(await api("POST", "/processing-batches", { lot_id: B.loteId, drying_report_id: B.rep.id, process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: B.kg }), "B10. abrir el proceso");
  exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: B.loteId, is_maquila: false, input_paddy_kg: B.kg, drying_report_id: B.rep.id, ...NOM,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: 32, unit: "QQ" },
    white_rice_presentations: [{ presentation: "100 LB", sack_weight_lb: 100, quantity: 32, destino: "SACO" }],
    sacks_used: 0
  }), "B11. finalizar con 32 QQ reales");
  check((await pagos(B.rep.id)).length === 0, "B12. no queda nada colgado del proceso guardado");
  l = await pagos(batch.id, "processing_batch");
  const lp = rol(l, "PILADOR");
  check(lp.length === 2 && lp.find((x) => x.s === "PAID")?.qq === 20 && lp.find((x) => x.s === "PENDING")?.qq === 12, "B13. pilador: 20 QQ pagados + 12 por pagar = 32, sin duplicar", lp);
  check(rol(l, "ESTIBADOR").length === 1 && rol(l, "ESTIBADOR")[0].qq === 32, "B14. estibador: una sola fila por lo real", rol(l, "ESTIBADOR"));
  await api("DELETE", `/processing-batches/drafts/${B.rep.id}`);
  check((await pagos(batch.id, "processing_batch")).length === l.length, "B15. borrar el borrador después de finalizar no toca los pagos");
  const anular = await api("POST", `/processing-batches/${batch.id}/anular`, { motivo: "prueba de simulacro" }, matriz);
  check(anular.status === 409 && /ya se pagó/.test(JSON.stringify(anular.data)), "B16. con el pago hecho no se anula la producción", mostrar(anular));

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
