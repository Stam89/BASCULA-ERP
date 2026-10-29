// 🌾 La cáscara de un «Proceso guardado» ya no suma al inventario (pedido del dueño 2026-10-29: «ya se piló pero no
// se pesaron las tulas»). Guardar el proceso (con una secadora juntada) saca de bodega la cáscara de las dos; descartar
// la devuelve; al crear y cerrar la pilada la consume el proceso sin descontarla dos veces. Usa secadoras reales de la
// copia. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const prods = await q("SELECT id, code FROM products");
  const P = (c) => prods.find((p) => p.code === c)?.id;
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const libres = await q(`SELECT d.id, d.lot_id, d.input_weight_kg::float kg, d.total_quintals::float qq, l.accionista_id
                            FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id
                           WHERE d.status = 'COMPLETED' AND d.rice_type = '0.11' AND l.operation_type = 'COMPRA' AND l.status = 'WEIGHED'
                             AND d.tunnel_number IS NOT NULL
                             AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id)
                             AND NOT EXISTS (SELECT 1 FROM milling_drafts m WHERE m.drying_report_id = d.id OR m.report->'juntos' ? d.id::text)
                           ORDER BY d.created_at`);
  const par = libres.find((a) => libres.some((b) => b.id !== a.id && b.accionista_id === a.accionista_id));
  if (!par) throw new Error("la copia no tiene dos secadoras del mismo socio finalizadas y sin pilar");
  const A = par, B = libres.find((b) => b.id !== A.id && b.accionista_id === A.accionista_id), acc = A.accionista_id;
  const cascara = async (lot) => (await q(`SELECT COALESCE(SUM(m.quantity),0)::float s FROM inventory_movements m JOIN products p ON p.id = m.product_id
                                            WHERE m.lot_id = $1 AND p.product_type = 'RAW_MATERIAL'`, [lot]))[0].s;
  const [a0, b0] = [await cascara(A.lot_id), await cascara(B.lot_id)];
  check(a0 > 0 && b0 > 0, "0. las dos secadoras tienen cáscara en bodega", { a0, b0 });
  const guardar = () => api("PUT", `/processing-batches/drafts/${A.id}`, { report: { juntos: [B.id], broken34: "2" }, pilado_entries: [{ id: "x", presentation: "TULA", quantityQq: 10, destino: "TULA", tulas: 5 }] }, acc);

  exigir(await guardar(), "1. guardar el proceso (A con B juntada)");
  check(Math.abs(await cascara(A.lot_id)) < 0.01 && Math.abs(await cascara(B.lot_id)) < 0.01, "2. la cáscara de las dos ya no está en bodega", { a: await cascara(A.lot_id), b: await cascara(B.lot_id) });
  exigir(await guardar(), "3. guardar otra vez (no se descuenta dos veces)");
  check(Math.abs(await cascara(A.lot_id)) < 0.01, "4. sigue en 0 (no −)", await cascara(A.lot_id));

  exigir(await api("DELETE", `/processing-batches/drafts/${A.id}`, undefined, acc), "5. descartar el proceso");
  check(Math.abs((await cascara(A.lot_id)) - a0) < 0.01 && Math.abs((await cascara(B.lot_id)) - b0) < 0.01, "6. la cáscara vuelve a bodega");

  exigir(await guardar(), "7. guardar de nuevo");
  const batch = exigir(await api("POST", "/processing-batches", { lot_id: A.lot_id, drying_report_id: A.id, drying_report_ids_extra: [B.id], process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: A.kg + B.kg }, acc), "8. abrir la pilada real (el freno de stock no la bloquea)");
  check(Math.abs(await cascara(A.lot_id)) < 0.01 && Math.abs(await cascara(B.lot_id)) < 0.01, "9. la cáscara se consume una sola vez", { a: await cascara(A.lot_id), b: await cascara(B.lot_id) });
  const qq = r2(A.qq + B.qq);
  exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: A.lot_id, drying_report_id: A.id, is_maquila: false, input_paddy_kg: A.kg + B.kg,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: r2(qq * 0.64), unit: "QQ" },
    sacks_used: 0
  }, acc), "10. cerrar la pilada");
  check(Math.abs(await cascara(A.lot_id)) < 0.01 && Math.abs(await cascara(B.lot_id)) < 0.01, "11. al cerrar sigue en 0 (no vuelve ni se resta otra vez)", { a: await cascara(A.lot_id), b: await cascara(B.lot_id) });
  const aparte = (await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE reference_type = 'milling_draft_input' AND reference_id = ANY($1::uuid[])", [[A.id, B.id]]))[0].s;
  check(Math.abs(aparte) < 0.01, "12. lo apartado por el proceso guardado quedó en 0", aparte);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
