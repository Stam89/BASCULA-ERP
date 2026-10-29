// 📅 Fecha de pilado (pedido del dueño 2026-10-29): una producción de un día anterior que se registra hoy queda con la
// fecha en que se piló: el proceso, la cáscara que salió, el producto que entró, el pago del pilador/estibador y el
// rendimiento. Usa una secadora real finalizada de la copia. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const diaEc = (col) => `(${col} AT TIME ZONE 'America/Guayaquil')::date::text`;
try {
  const prods = await q("SELECT id, code FROM products");
  const P = (c) => prods.find((p) => p.code === c)?.id;
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const sec = (await q(`SELECT d.id, d.lot_id, d.input_weight_kg::float kg, d.total_quintals::float qq, l.accionista_id
                          FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id
                         WHERE d.status = 'COMPLETED' AND d.rice_type = '0.11' AND l.operation_type = 'COMPRA' AND l.status = 'WEIGHED'
                           AND d.tunnel_number IS NOT NULL
                           AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id)
                           AND NOT EXISTS (SELECT 1 FROM milling_drafts m WHERE m.drying_report_id = d.id)
                         ORDER BY d.total_quintals LIMIT 1`))[0];
  if (!sec) throw new Error("la copia no tiene una secadora propia finalizada sin pilar");
  const acc = sec.accionista_id, qq = sec.qq, FECHA = "2026-10-27";
  const batch = exigir(await api("POST", "/processing-batches", { lot_id: sec.lot_id, drying_report_id: sec.id, process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: sec.kg }, acc), "1. abrir la pilada");
  const cierre = (fecha) => api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: sec.lot_id, drying_report_id: sec.id, is_maquila: false, input_paddy_kg: sec.kg,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: r2(qq * 0.64), unit: "QQ" },
    broken_rice: { product_id: P("ARROCILLO-34"), warehouse_id: bodPT, quantity: r2(qq * 0.04), unit: "QQ" },
    bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: r2(qq * 0.08), unit: "QQ" },
    sacks_used: 0, pilador_name: "PILADOR PRUEBA", estibador_name: "ESTIBADOR PRUEBA", tulas: 10, qq_de_tulas: r2(qq * 0.64),
    white_rice_presentations: [{ presentation: "TULA", quantity: r2(qq * 0.64), destino: "TULA", tulas: 10 }],
    fecha_pilado: fecha
  }, acc);

  const futura = await cierre("2099-01-01");
  check(futura.status === 400, "2. una fecha futura no se acepta", mostrar(futura));
  const vieja = await cierre("2026-10-10");
  check(vieja.status === 400, "3. una fecha antes del arranque (15/10) no se acepta", mostrar(vieja));
  const abierta = (await q("SELECT finished_at FROM processing_batches WHERE id = $1", [batch.id]))[0];
  check(!abierta.finished_at, "4. tras los rechazos la pilada sigue abierta (no se cerró a medias)");

  exigir(await cierre(FECHA), `5. cerrar la pilada con fecha ${FECHA}`);
  const b = (await q(`SELECT ${diaEc("finished_at")} fin, ${diaEc("started_at")} ini FROM processing_batches WHERE id = $1`, [batch.id]))[0];
  check(b.fin === FECHA && b.ini <= FECHA, "6. el proceso queda terminado ese día", b);
  const movs = await q(`SELECT movement, ${diaEc("created_at")} dia FROM inventory_movements WHERE reference_type = 'processing_batches' AND reference_id = $1`, [batch.id]);
  check(movs.length >= 3 && movs.every((m) => m.dia === FECHA) && movs.some((m) => m.movement === "PROCESS_INPUT") && movs.some((m) => m.movement === "PROCESS_OUTPUT"),
    "7. la cáscara que salió y el producto que entró quedan con esa fecha", movs);
  const pagos = await q("SELECT worker_role, work_date::text d FROM worker_payments WHERE reference_type = 'processing_batch' AND reference_id = $1", [batch.id]);
  check(pagos.length >= 1 && pagos.every((p) => p.d === FECHA), "8. el pago del pilador/estibador queda en ese día", pagos);
  const y = (await q(`SELECT ${diaEc("created_at")} d FROM production_yields WHERE processing_batch_id = $1`, [batch.id]))[0];
  check(y?.d === FECHA, "9. el rendimiento queda con esa fecha", y);
  const informe = await q(`SELECT ${diaEc("created_at")} d FROM lot_process_reports WHERE lot_id = $1 AND stage = 'PILADO'`, [sec.lot_id]);
  check(informe.length > 0 && informe.every((x) => x.d === FECHA), "10. el informe de pilado del lote queda con esa fecha", informe);
  const hist = exigir(await api("GET", "/processing-batches/history", undefined, acc), "11. historial de producción");
  const enHist = (hist.batches ?? hist).find?.((x) => x.id === batch.id);
  check(!enHist || String(enHist.finished_at).slice(0, 10) <= FECHA, "12. el historial muestra el día del pilado", enHist?.finished_at);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
