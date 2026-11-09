// 🔁 «Pasar a servicio completo» (pedido del dueño 2026-11-09): un lote de SOLO SECADO ya secado (y ya cobrado) que el
// cliente decide pilar. Sin abonos el cobro del secado se anula; con abonos queda en lo abonado y se descuenta del cobro
// de la pilada. Solo el administrador. Usa dos secadoras de servicio finalizadas de la copia. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, operador } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const secs = await q(`SELECT d.id, d.lot_id, d.input_weight_kg::float kg, d.total_quintals::float qq, l.lot_code, l.farmer_id, l.accionista_id
                          FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id
                         WHERE d.status = 'COMPLETED' AND l.is_maquila AND l.status = 'WEIGHED' AND d.rice_type = '0.11'
                           AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.lot_id = l.id)
                           AND NOT EXISTS (SELECT 1 FROM milling_drafts m WHERE m.drying_report_id = d.id)
                         ORDER BY d.created_at LIMIT 2`);
  if (secs.length < 2) throw new Error("la copia no tiene dos secadoras de servicio finalizadas sin pilar");
  const [A, B] = secs;
  // Los dos lotes quedan como «Solo secado» con su cobro de secado de $100 (B con $40 abonados).
  for (const x of [A, B]) {
    await q("UPDATE lots SET operation_type = 'SECADO', is_maquila = true, ownership = 'MAQUILA' WHERE id = $1", [x.lot_id]);
    await q("UPDATE weighing_tickets SET operation_type = 'SECADO', is_maquila = true WHERE lot_id = $1", [x.lot_id]);
    await q(`INSERT INTO accounts_receivable (accionista_id, farmer_id, reference_type, reference_id, description, amount, balance, status)
             VALUES ($1, $2, 'secado_service', $3, 'Servicio de Secado (simulacro) - Lote ' || $4, 100, $5, $6)`,
      [S.matriz, x.farmer_id, x.lot_id, x.lot_code, x === B ? 60 : 100, x === B ? "PARTIAL" : "CONFIRMED"]);
  }

  const lista = exigir(await api("GET", "/process-flow/solo-secado/convertibles"), "1. lista de solo secado ya secos");
  const enLista = (id) => lista.find((l) => l.lot_id === id);
  check(enLista(A.lot_id)?.cobro_secado === 100 && enLista(B.lot_id)?.abonado === 40, "2. aparecen los dos lotes con su cobro y lo abonado", lista.map((l) => [l.lot_code, l.cobro_secado, l.abonado]));

  const opApi = await operador("sim_secado", ["Secadoras", "Produccion"]);
  const ajeno = await opApi("POST", `/process-flow/lots/${A.lot_id}/servicio-completo`, {});
  check(ajeno.status === 403, "3. quien no es administrador no puede", mostrar(ajeno));

  const a = exigir(await api("POST", `/process-flow/lots/${A.lot_id}/servicio-completo`, {}), "4. pasar A (sin abonos) a servicio completo");
  check(a.cobro_anulado === 100 && a.abonado === 0, "5. A: se anula todo el cobro del secado", a);
  const arA = await q("SELECT 1 FROM accounts_receivable WHERE reference_type = 'secado_service' AND reference_id = $1", [A.lot_id]);
  const lotA = (await q("SELECT operation_type, is_maquila FROM lots WHERE id = $1", [A.lot_id]))[0];
  check(arA.length === 0 && lotA.operation_type === "SECADO_PILADO" && lotA.is_maquila, "6. A: sin cobro de secado y ahora es servicio completo", lotA);

  const otra = await api("POST", `/process-flow/lots/${A.lot_id}/servicio-completo`, {});
  check(otra.status === 409, "7. pasarlo otra vez no hace nada (409)", mostrar(otra));

  const b = exigir(await api("POST", `/process-flow/lots/${B.lot_id}/servicio-completo`, {}), "8. pasar B (con $40 abonados)");
  check(b.cobro_anulado === 60 && b.abonado === 40, "9. B: se anula lo que faltaba y quedan los $40 abonados", b);
  const arB = (await q("SELECT amount::float a, balance::float b, status FROM accounts_receivable WHERE reference_type = 'secado_service' AND reference_id = $1", [B.lot_id]))[0];
  check(arB?.a === 40 && arB.b === 0 && arB.status === "PAID", "10. B: el cobro del secado queda en $40, saldado", arB);

  const lista2 = exigir(await api("GET", "/process-flow/solo-secado/convertibles"), "11. lista después");
  check(!lista2.some((l) => [A.lot_id, B.lot_id].includes(l.lot_id)), "12. ya no aparecen en la lista");

  // Pilar B como servicio completo: el cobro de la pilada lleva descontados los $40.
  const prods = await q("SELECT id, code FROM products");
  const P = (c) => prods.find((p) => p.code === c)?.id;
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((x) => x.type === "RAW_MATERIAL").id, bodPT = bod.find((x) => x.type === "FINISHED_GOODS").id;
  const batch = exigir(await api("POST", "/processing-batches", { lot_id: B.lot_id, drying_report_id: B.id, process_type: "PILADO", ownership: "MAQUILA", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: B.kg }), "13. abrir la pilada de B");
  const blanco = r2(B.qq * 0.6);
  exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: B.lot_id, drying_report_id: B.id, is_maquila: true, farmer_id: B.farmer_id ?? undefined, input_paddy_kg: B.kg,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: blanco, unit: "QQ" },
    white_rice_presentations: [{ presentation: "100 LB", sack_weight_lb: 100, quantity: blanco, destino: "SACO" }],
    bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: r2(B.qq * 0.08), unit: "QQ" },
    sacks_used: 0, pilador_name: "PILADOR PRUEBA", estibador_name: "ESTIBADOR PRUEBA"
  }), "14. pilar B");
  const svc = (await q("SELECT total::float t, receivable_id FROM pilado_services WHERE processing_batch_id = $1", [batch.id]))[0];
  const arP = svc ? (await q("SELECT amount::float a, balance::float b, description d FROM accounts_receivable WHERE id = $1", [svc.receivable_id]))[0] : null;
  const mo = (await q("SELECT total_service_amount::float t FROM maquila_orders WHERE lot_id = $1 ORDER BY created_at DESC LIMIT 1", [B.lot_id]))[0];
  check(!!arP && /menos lo abonado al secado: \$40\.00/.test(arP.d), "15. el cobro de la pilada dice que se descontaron los $40", arP?.d);
  check(!!arP && arP.a === svc.t && arP.b === arP.a && mo?.t === svc.t, "16. cobro, servicio y orden quedan en el mismo valor ya descontado", { ar: arP?.a, svc: svc?.t, orden: mo?.t });
  const sinDescuento = r2(svc.t + 40);
  check(sinDescuento > 40, "17. sin el descuento habría sido $40 más", sinDescuento);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
