// 📦 Producción › Desde Stock con VARIOS lotes (pedido del dueño 2026-10-29): la lista son solo los LOTES GUARDADOS
// (secados apartados + cáscara seca del saldo inicial apartada) y se pueden pilar juntos: un secado guardado con lotes
// del saldo inicial, o solo lotes del saldo inicial. La cáscara se consume una vez, los lotes quedan pilados y anular
// devuelve todo. Usa datos reales de la copia. SOLO copia.
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
  const si = await q("SELECT id, lot_code, accionista_id FROM lots WHERE saldo_inicial AND status = 'WEIGHED' AND rice_type = '0.11' ORDER BY lot_code");
  if (si.length < 3) throw new Error("la copia no tiene 3 lotes del saldo inicial");
  const acc = si[0].accionista_id;
  const sec = (await q(`SELECT d.id, d.lot_id, d.input_weight_kg::float kg, d.total_quintals::float qq FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id
                         WHERE d.status = 'COMPLETED' AND d.rice_type = '0.11' AND l.accionista_id = $1 AND l.operation_type = 'COMPRA' AND l.status = 'WEIGHED'
                           AND d.tunnel_number IS NOT NULL AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id)
                           AND NOT EXISTS (SELECT 1 FROM milling_drafts m WHERE m.drying_report_id = d.id OR m.report->'juntos' ? d.id::text)
                         ORDER BY d.created_at LIMIT 1`, [acc]))[0];
  if (!sec) throw new Error("la copia no tiene un secado libre del mismo socio");
  const cascara = async (lot) => (await q(`SELECT COALESCE(SUM(m.quantity),0)::float s FROM inventory_movements m JOIN products p ON p.id = m.product_id
                                            WHERE m.lot_id = $1 AND p.product_type = 'RAW_MATERIAL'`, [lot]))[0].s;
  const stock = async () => exigir(await api("GET", "/lots/dry-in-storage", undefined, acc), "stock");

  const s0 = await stock();
  check(!s0.some((l) => l.drying_report_id === sec.id), "1. un secado sin guardar no está en Desde Stock (se pila desde Secadoras)");
  exigir(await api("POST", "/reports/arianos/apartar", { ids: [si[0].id, si[1].id, si[2].id, sec.id], apartar: true, ubicacion: "Bodega" }, acc), "2. guardar 3 lotes del saldo inicial y 1 secado");
  const s1 = await stock();
  const itSec = s1.find((l) => l.drying_report_id === sec.id), itA = s1.find((l) => l.id === si[0].id), itB = s1.find((l) => l.id === si[1].id), itC = s1.find((l) => l.id === si[2].id);
  check(itSec?.stock_kind === "secado" && itA?.stock_kind === "lote" && itB && itC, "3. ahora aparecen en Desde Stock (secado y lotes)", s1.map((l) => [l.lot_code, l.stock_kind]));
  check(s1.every((l) => l.stock_kind === "secado" ? true : (l.saldo_inicial ? true : l.operation_type === "PILADO")), "4. en Desde Stock solo hay lotes guardados (o servicios solo pilada)");

  // ── A. Un secado guardado + dos lotes del saldo inicial en UNA pilada ──
  const [qA, qB] = [await cascara(si[0].id), await cascara(si[1].id)];
  const totalKg = sec.kg + (qA + qB) * 45.359237;
  const batch = exigir(await api("POST", "/processing-batches", { lot_id: sec.lot_id, drying_report_id: sec.id, lot_ids_extra: [si[0].id, si[1].id], process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: sec.kg }, acc), "5. abrir la pilada: secado + 2 lotes del saldo inicial");
  check(Math.abs(Number(batch.input_quantity) - totalKg) < 1, "6. la entrada suma los tres", { entrada: batch.input_quantity, esperado: r2(totalKg) });
  check(Math.abs(await cascara(si[0].id)) < 0.01 && Math.abs(await cascara(si[1].id)) < 0.01 && Math.abs(await cascara(sec.lot_id)) < 0.01, "7. la cáscara de los tres sale de bodega una vez");
  const qq = r2(sec.qq + qA + qB);
  exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: sec.lot_id, drying_report_id: sec.id, is_maquila: false, input_paddy_kg: totalKg,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: r2(qq * 0.64), unit: "QQ" }, sacks_used: 0
  }, acc), "8. cerrar la pilada");
  const est = await q("SELECT lot_code, status::text s FROM lots WHERE id = ANY($1::uuid[])", [[sec.lot_id, si[0].id, si[1].id]]);
  check(est.every((x) => x.s === "PROCESSED"), "9. los tres lotes quedan PILADOS", est);
  const s2 = await stock();
  check(!s2.some((l) => [si[0].id, si[1].id].includes(l.id) || l.drying_report_id === sec.id) && s2.some((l) => l.id === si[2].id), "10. salen de Desde Stock; el tercer lote sigue ahí");
  const otra = await api("POST", "/processing-batches", { lot_id: si[2].id, lot_ids_extra: [si[0].id], process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: 100 }, acc);
  check(otra.status === 409, "11. un lote ya pilado no entra a otra pilada", mostrar(otra));

  // ── B. Anular devuelve todo ──
  exigir(await api("POST", `/processing-batches/${batch.id}/anular`, { motivo: "simulacro stock varios" }), "12. anular la pilada");
  const est2 = await q("SELECT status::text s FROM lots WHERE id = ANY($1::uuid[])", [[si[0].id, si[1].id]]);
  check(est2.every((x) => x.s === "WEIGHED") && Math.abs((await cascara(si[0].id)) - qA) < 0.01, "13. los lotes vuelven y su cáscara regresa a bodega", est2);

  // ── C. Solo lotes del saldo inicial (sin secado) ──
  const [qC] = [await cascara(si[2].id)];
  const b2 = exigir(await api("POST", "/processing-batches", { lot_id: si[2].id, lot_ids_extra: [si[0].id], process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: qC * 45.359237 }, acc), "14. pilar juntos dos lotes del saldo inicial");
  check(Math.abs(await cascara(si[2].id)) < 0.01 && Math.abs(await cascara(si[0].id)) < 0.01, "15. la cáscara de los dos sale una vez");
  exigir(await api("POST", `/processing-batches/${b2.id}/finish-production`, {
    lot_id: si[2].id, is_maquila: false, input_paddy_kg: (qC + qA) * 45.359237,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: r2((qC + qA) * 0.64), unit: "QQ" }, sacks_used: 0
  }, acc), "16. cerrar la pilada");
  const est3 = await q("SELECT status::text s FROM lots WHERE id = ANY($1::uuid[])", [[si[2].id, si[0].id]]);
  check(est3.every((x) => x.s === "PROCESSED"), "17. los dos quedan PILADOS", est3);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
