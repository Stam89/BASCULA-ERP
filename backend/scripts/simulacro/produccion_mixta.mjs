// 🔗 Producción con arroz de Secadoras Y de Stock en la misma pilada (pedido del dueño 2026-11-24): guardar a medias con
// los dos, retomarlo, que la cáscara de ambos salga de bodega una sola vez, que nadie más pueda usarlos, descartar, y
// finalizar (también cuando el proceso guardado empezó por el lote de Stock y después se le sumó una secadora). SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const KG = 45.359237;
try {
  const prods = await q("SELECT id, code FROM products");
  const P = (c) => prods.find((p) => p.code === c)?.id;
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const secs = await q(`SELECT d.id, d.lot_id, l.accionista_id acc, d.input_weight_kg::float kg, d.total_quintals::float qq FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id
                         WHERE d.status = 'COMPLETED' AND d.rice_type = '0.11' AND l.operation_type = 'COMPRA' AND l.status = 'WEIGHED' AND d.tunnel_number IS NOT NULL
                           AND NOT d.apartado_arianos AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id)
                           AND NOT EXISTS (SELECT 1 FROM milling_drafts m WHERE m.drying_report_id = d.id OR m.report->'juntos' ? d.id::text) ORDER BY d.created_at`);
  const [A, B] = secs.filter((s) => s.acc === secs[0]?.acc);
  if (!A || !B) throw new Error("la copia no tiene dos secados libres del mismo socio");
  const acc = A.acc;
  const cargar = async (qq) => {
    const r = exigir(await api("POST", "/saldos-iniciales/inventario", { corte: "2026-11-03", product_id: P("CASCARA-011"), cantidad: qq, detalle: "mixta" }, acc), `0. cargar ${qq} QQ de cáscara`);
    return (await q("SELECT id FROM lots WHERE lot_code = $1", [r.lote]))[0].id;
  };
  const L1 = await cargar(45), L2 = await cargar(30);
  const cascara = async (lot) => r2((await q(`SELECT COALESCE(SUM(m.quantity),0)::float s FROM inventory_movements m JOIN products p ON p.id = m.product_id
                                            WHERE m.lot_id = $1 AND p.product_type = 'RAW_MATERIAL'`, [lot]))[0].s);
  const stock = async () => exigir(await api("GET", "/lots/dry-in-storage", undefined, acc), "stock");
  const borradores = async () => exigir(await api("GET", "/processing-batches/drafts", undefined, acc), "borradores");
  const pagos = async () => q("SELECT worker_role, net_amount::float n, reference_type t, reference_id r FROM worker_payments WHERE worker_name LIKE 'MIXTA %' ORDER BY worker_role");
  const [cA, cB] = [await cascara(A.lot_id), await cascara(B.lot_id)];
  const guardar = (clave, juntos, juntos_lotes, qq) => api("PUT", `/processing-batches/drafts/${clave}`, {
    report: { juntos, juntos_lotes, broken34: "3", polvillo: "2", pilador_name: "MIXTA PILADOR", estibador_name: "MIXTA ESTIBADOR" },
    pilado_entries: [{ id: "1", presentation: "100 LB", quantityQq: qq, destino: "SACO" }]
  }, acc);

  // ── A. Secadora + lote de Stock guardados a medias ──
  exigir(await guardar(A.id, [], [L1], 60), "A1. guardar el proceso con la secadora A y el lote de Stock L1");
  check(await cascara(A.lot_id) === 0 && await cascara(L1) === 0, "A2. la cáscara de los dos ya salió de bodega", [await cascara(A.lot_id), await cascara(L1)]);
  exigir(await guardar(A.id, [], [L1], 80), "A3. volver a guardar");
  check(await cascara(A.lot_id) === 0 && await cascara(L1) === 0, "A4. no se descuenta otra vez");
  const d = (await borradores()).find((x) => x.drying_report_id === A.id);
  check(r2(d?.total_quintals) === r2(A.qq + 45) && d.lotes_stock_juntos === 1, "A5. el proceso guardado suma la cáscara de los dos", d && { qq: d.total_quintals, lotes: d.lotes_juntos });
  check((await stock()).find((l) => l.id === L1)?.has_draft === true && (await stock()).find((l) => l.id === L2)?.has_draft === false, "A6. L1 queda marcado «guardado»; L2 libre");
  const doble = await guardar(B.id, [], [L1], 10);
  check(doble.status === 409, "A7. L1 no puede entrar a otro proceso guardado", mostrar(doble));
  check(await cascara(B.lot_id) === cB && !(await borradores()).some((x) => x.drying_report_id === B.id), "A8. el rechazado no dejó nada");
  exigir(await guardar(A.id, [], [], 80), "A9. quitar L1 del proceso");
  check(await cascara(L1) === 45 && await cascara(A.lot_id) === 0, "A10. su cáscara vuelve a bodega; la de A sigue adentro");
  exigir(await guardar(A.id, [], [L1, L2], 80), "A11. sumar L1 y L2");
  check(await cascara(L1) === 0 && await cascara(L2) === 0, "A12. salen los dos");
  exigir(await api("DELETE", `/processing-batches/drafts/${A.id}`, undefined, acc), "A13. descartar");
  check(await cascara(A.lot_id) === cA && await cascara(L1) === 45 && await cascara(L2) === 30, "A14. todo vuelve a bodega");
  check((await pagos()).length === 0, "A15. la nómina pendiente se quitó");

  // ── B. Guardado y finalizado con los dos ──
  exigir(await guardar(A.id, [], [L1], 100), "B1. guardar otra vez A + L1");
  check((await pagos()).length === 2, "B2. pilador y estibador aparecen una vez", await pagos());
  const b = exigir(await api("POST", "/processing-batches", { lot_id: A.lot_id, drying_report_id: A.id, lot_ids_extra: [L1], process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: A.kg }, acc), "B3. abrir la pilada con los dos");
  check(Math.abs(Number(b.input_quantity) - (A.kg + 45 * KG)) < 1, "B4. la entrada suma los dos", b.input_quantity);
  check(await cascara(A.lot_id) === 0 && await cascara(L1) === 0, "B5. la cáscara salió una sola vez", [await cascara(A.lot_id), await cascara(L1)]);
  check((await stock()).find((l) => l.id === L1)?.has_draft === true, "B6. con la pilada abierta, L1 sigue recuperable y marcado");
  exigir(await api("POST", `/processing-batches/${b.id}/finish-production`, {
    lot_id: A.lot_id, drying_report_id: A.id, is_maquila: false, input_paddy_kg: A.kg + 45 * KG,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: 100, unit: "QQ" }, sacks_used: 0, pilador_name: "MIXTA PILADOR", estibador_name: "MIXTA ESTIBADOR"
  }, acc), "B7. finalizar");
  const est = await q("SELECT status::text s FROM lots WHERE id = ANY($1::uuid[])", [[A.lot_id, L1]]);
  check(est.every((x) => x.s === "PROCESSED"), "B8. los dos quedan PILADOS", est);
  check(!(await borradores()).some((x) => x.drying_report_id === A.id) && (await q("SELECT 1 FROM milling_drafts WHERE drying_report_id = $1", [A.id])).length === 0, "B9. el proceso guardado se cerró");
  const pg = await pagos();
  check(pg.length === 2 && pg.every((x) => x.t === "processing_batch"), "B10. nómina: un pago por persona, ya de la pilada", pg);
  const neto = (await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE reference_type IN ('milling_draft','milling_draft_input') AND reference_id = ANY($1::uuid[])", [[A.id, L1]]))[0].s;
  check(Math.abs(neto) < 0.001, "B11. no queda nada del proceso guardado en inventario", neto);

  // ── C. Empezó por el lote de Stock y después se le sumó una secadora ──
  exigir(await guardar(L2, [], [], 10), "C1. guardar el proceso del lote L2 solo");
  exigir(await guardar(L2, [B.id], [], 70), "C2. retomarlo y sumarle la secadora B");
  check(await cascara(L2) === 0 && await cascara(B.lot_id) === 0, "C3. sale la cáscara de los dos");
  const d2 = (await borradores()).find((x) => x.drying_report_id === L2);
  check(r2(d2?.total_quintals) === r2(B.qq + 30), "C4. el proceso suma los dos", d2?.total_quintals);
  const b2 = exigir(await api("POST", "/processing-batches", { lot_id: B.lot_id, drying_report_id: B.id, lot_ids_extra: [L2], process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: B.kg }, acc), "C5. abrir la pilada (la secadora es la principal)");
  exigir(await api("POST", `/processing-batches/${b2.id}/finish-production`, {
    lot_id: B.lot_id, drying_report_id: B.id, is_maquila: false, input_paddy_kg: B.kg + 30 * KG,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: 70, unit: "QQ" }, sacks_used: 0, pilador_name: "MIXTA PILADOR", estibador_name: "MIXTA ESTIBADOR"
  }, acc), "C6. finalizar");
  check((await q("SELECT 1 FROM milling_drafts WHERE lot_id = $1", [L2])).length === 0, "C7. el proceso guardado del lote se cerró");
  check((await pagos()).length === 4 && (await pagos()).every((x) => x.t === "processing_batch"), "C8. nómina sin duplicar", await pagos());
  const neto2 = (await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE reference_type IN ('milling_draft','milling_draft_input') AND reference_id = ANY($1::uuid[])", [[B.id, L2]]))[0].s;
  check(Math.abs(neto2) < 0.001 && await cascara(L2) === 0 && await cascara(B.lot_id) === 0, "C9. inventario limpio y cáscara en 0", neto2);

  // ── D. Anular devuelve los dos ──
  await q("DELETE FROM worker_payments WHERE reference_id = $1 AND status = 'PAID'", [b2.id]);
  exigir(await api("POST", `/processing-batches/${b2.id}/anular`, { motivo: "simulacro mixta" }), "D1. anular la pilada");
  check(await cascara(L2) === 30 && await cascara(B.lot_id) === cB, "D2. vuelve la cáscara de la secadora y del lote", [await cascara(L2), await cascara(B.lot_id)]);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
