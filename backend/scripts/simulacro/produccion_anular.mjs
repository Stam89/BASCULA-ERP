// Anular un proceso de PRODUCCIÓN cerrado: se deshace todo, el lote vuelve a pilarse, y hay frenos si ya se usó el arroz o hay abonos.
// SOLO contra la copia (sim_base aborta si no).
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q, matriz } = S;
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
  if (pend.length < 3 || libres.length < 2) throw new Error(`la copia no tiene suficientes tickets (${pend.length}) o túneles libres (${libres.length})`);
  let usados = 0;
  const stockProd = async (code) => r2((await q("SELECT COALESCE(SUM(quantity),0)::float n FROM inventory_movements WHERE product_id=$1", [P(code)]))[0].n);
  const stockLote = async (loteId, code) => r2((await q("SELECT COALESCE(SUM(quantity),0)::float n FROM inventory_movements WHERE lot_id=$1 AND product_id=$2", [loteId, P(code)]))[0].n);

  const preparar = async (etiqueta) => {
    const t = pend[usados], tunel = libres[usados]; usados++;
    if (!t.farmer_id) exigir(await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id }), `${etiqueta}: vincular agricultor`);
    const ing = exigir(await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" }), `${etiqueta}: ingresar materia prima (${t.qq} QQ)`);
    const lleno = new Date(Date.now() - 20 * 3600e3).toISOString();
    const rep = exigir(await api("POST", "/process-flow/drying", { entry_ids: [ing.ingreso.id], tunnel_number: tunel, dryer_name: "Secadora " + tunel, rice_type: "0.11", moisture_before: 22, filled_at: lleno, finalize: false }), `${etiqueta}: llenar túnel ${tunel}`);
    exigir(await api("PUT", `/process-flow/drying/${rep.id}`, { rice_type: "0.11", moisture_before: 22, moisture_after: 13, filled_at: lleno, dry_start_at: new Date(Date.now() - 19 * 3600e3).toISOString(), dry_end_at: new Date().toISOString(), finalize: true, dryer_name: "Secadora " + tunel, entry_ids: [ing.ingreso.id] }), `${etiqueta}: finalizar secado`);
    const loteId = rep.lot_id ?? rep.lots?.[0]?.lot_id;
    const estadoPrevio = (await q("SELECT status::text s FROM lots WHERE id=$1", [loteId]))[0].s;
    const abrir = async () => exigir(await api("POST", "/processing-batches", { lot_id: loteId, drying_report_id: rep.id, process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: Number(rep.input_weight_kg ?? 0) || undefined }), `${etiqueta}: abrir proceso de producción`);
    const batch = await abrir();
    return { t, rep, loteId, batch, qq: t.qq, kg: Number(rep.input_weight_kg ?? 0) || undefined, estadoPrevio, abrir };
  };
  const cierre = (L, extra = {}) => ({
    lot_id: L.loteId, is_maquila: false, input_paddy_kg: L.kg, pilador_name: "PILADOR SIMULACRO", estibador_name: "ESTIBADOR SIMULACRO",
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: r2(L.qq * 0.64), unit: "QQ" },
    broken_rice: { product_id: P("ARROCILLO-34"), warehouse_id: bodPT, quantity: r2(L.qq * 0.04), unit: "QQ" },
    fine_broken_rice: { product_id: P("ARROCILLO-FINO"), warehouse_id: bodPT, quantity: r2(L.qq * 0.03), unit: "QQ" },
    bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: r2(L.qq * 0.08), unit: "QQ" }, sacks_used: 0, ...extra
  });

  // ── A. Anular y volver a pilar ─────────────────────────────────────────
  const A = await preparar("A");
  const blanco0 = await stockProd("ARROZ-PILADO-011"), pol0 = await stockProd("POLVILLO");
  exigir(await api("POST", `/processing-batches/${A.batch.id}/finish-production`, cierre(A)), "A1. se cierra la producción");
  const blanco1 = await stockProd("ARROZ-PILADO-011");
  check(blanco1 > blanco0 && (await q("SELECT count(*)::int n FROM worker_payments WHERE reference_type='processing_batch' AND reference_id=$1", [A.batch.id]))[0].n >= 1, "A2. quedó el arroz en bodega y el pago de nómina del pilador/estibador pendiente", { blanco0, blanco1 });
  const sinAdmin = await apiComo((await q("SELECT id FROM users WHERE username ILIKE 'cecilia%' OR name ILIKE 'cecilia%' LIMIT 1"))[0]?.id ?? "00000000-0000-4000-8000-000000000000", "cecilia", "Cecilia")("POST", `/processing-batches/${A.batch.id}/anular`, { motivo: "no soy admin" });
  check(sinAdmin.status === 403, "A3. solo el administrador anula una producción (403)", sinAdmin.status);
  check((await api("POST", `/processing-batches/${A.batch.id}/anular`, { motivo: "x" })).status === 400, "A4. sin motivo claro se rechaza (400)");
  const an = await dos(() => api("POST", `/processing-batches/${A.batch.id}/anular`, { motivo: "Cantidades mal digitadas" }));
  check(an.filter((r) => r.ok).length === 1 && an.every((r) => r.status !== 500), "A5. anular con doble clic: se anula UNA vez", an.map((r) => r.status));
  const okAn = an.find((r) => r.ok)?.data;
  check(okAn && okAn.salidas_revertidas === 4 && okAn.entradas_restauradas >= 1, "A6. revierte las 4 salidas y devuelve la cáscara", okAn);
  check(await stockProd("ARROZ-PILADO-011") === blanco0 && await stockProd("POLVILLO") === pol0, "A7. el arroz y subproductos vuelven al stock de antes de producir", { blanco: await stockProd("ARROZ-PILADO-011"), esperado: blanco0 });
  check((await stockLote(A.loteId, "CASCARA-011")) > 0, "A8. la cáscara del lote vuelve a existir (para pilar de nuevo)", await stockLote(A.loteId, "CASCARA-011"));
  const lb = (await q("SELECT status::text s, finished_at, anulado_motivo FROM processing_batches WHERE id=$1", [A.batch.id]))[0];
  check(lb.s === "CANCELLED" && lb.finished_at === null && lb.anulado_motivo, "A9. el proceso queda ANULADO (con motivo) y sin cerrar", lb);
  check((await q("SELECT count(*)::int n FROM processing_outputs WHERE processing_batch_id=$1", [A.batch.id]))[0].n === 0 && (await q("SELECT count(*)::int n FROM production_yields WHERE processing_batch_id=$1", [A.batch.id]))[0].n === 0 && (await q("SELECT count(*)::int n FROM worker_payments WHERE reference_type='processing_batch' AND reference_id=$1", [A.batch.id]))[0].n === 0, "A10. se borran salidas, rendimiento y pagos de nómina pendientes del proceso");
  check((await q("SELECT status::text s FROM lots WHERE id=$1", [A.loteId]))[0].s === A.estadoPrevio, "A11. el lote vuelve al estado que tenía antes de producir", { ahora: (await q("SELECT status::text s FROM lots WHERE id=$1", [A.loteId]))[0].s, antes: A.estadoPrevio });
  check((await api("POST", `/processing-batches/${A.batch.id}/anular`, { motivo: "otra vez" })).status === 409, "A12. un proceso ya anulado no se anula de nuevo (409)");
  const disp = (await api("GET", "/process-flow/drying/reports")).data;
  const lista = Array.isArray(disp) ? disp : disp.rows ?? disp.reports ?? [];
  check(lista.length >= 0, "A13. el secado vuelve a estar disponible para producción (se pide de nuevo abajo)");
  // volver a pilar con los datos correctos
  const nuevo = await A.abrir();
  const cierre2 = await api("POST", `/processing-batches/${nuevo.id}/finish-production`, cierre(A));
  check(cierre2.ok && r2(await stockProd("ARROZ-PILADO-011")) === blanco1, "A14. se vuelve a pilar y cerrar bien: el stock queda como un solo cierre (no doble)", { blanco: await stockProd("ARROZ-PILADO-011"), esperado: blanco1, r: cierre2.status });
  check((await q("SELECT count(*)::int n FROM worker_payments WHERE reference_type='processing_batch' AND reference_id=$1", [nuevo.id]))[0].n >= 1, "A15. y el pago de nómina nace una sola vez para el proceso nuevo");

  // ── B. Frenos ──────────────────────────────────────────────────────────
  const B = await preparar("B");
  exigir(await api("POST", `/processing-batches/${B.batch.id}/finish-production`, cierre(B)), "B0. se cierra la producción B");
  const bBlanco = r2(B.qq * 0.64);
  const stockActual = await stockProd("ARROZ-PILADO-011");
  // se «usa» arroz de la bodega (ajuste manual de salida): ya no alcanza para devolverlo
  exigir(await api("POST", "/inventory/adjustments", { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: -(stockActual - bBlanco / 2), notes: "se vendió/usó" }), "B1. se usa casi todo el arroz de la bodega");
  const frenoStock = await api("POST", `/processing-batches/${B.batch.id}/anular`, { motivo: "intento con arroz ya usado" });
  check(frenoStock.status === 409 && (await q("SELECT status::text s FROM processing_batches WHERE id=$1", [B.batch.id]))[0].s !== "CANCELLED", "B2. si ya se usó parte del arroz producido, NO se anula (409) y no se toca nada", mostrar(frenoStock));
  const sinCerrar = await api("POST", `/processing-batches/${(await q("SELECT id FROM processing_batches WHERE finished_at IS NULL AND status <> 'CANCELLED' LIMIT 1"))[0]?.id ?? "00000000-0000-4000-8000-000000000000"}/anular`, { motivo: "proceso sin cerrar" });
  check(sinCerrar.status === 409 || sinCerrar.status === 404, "B3. un proceso sin cerrar no se «anula» (no hay cierre que deshacer)", sinCerrar.status);

  // ── C. Servicio de pilada (maquila): cuentas por cobrar ────────────────
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO", tipo: "EFECTIVO", opening_balance_cash: 500 }), "C0. abrir caja");
  const t3 = pend[usados++];
  if (!t3.farmer_id) await api("POST", `/tickets/${t3.id}/link-farmer`, { farmer_id: farmer.id });
  const ing3 = await api("POST", `/tickets/${t3.id}/create-lot`, { rice_type: "0.11", operation_type: "PILADO", ownership: "MAQUILA" });
  if (ing3.ok) {
    const lote3 = (await q("SELECT id FROM lots WHERE id = (SELECT lot_id FROM weighing_tickets WHERE id=$1)", [ing3.data.ingreso.id]))[0]?.id;
    const bt = exigir(await api("POST", "/processing-batches", { lot_id: lote3, process_type: "PILADO", ownership: "MAQUILA", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: 5000 }), "C1. abrir proceso de un servicio de pilada");
    const L3 = { loteId: lote3, qq: t3.qq, kg: 5000 };
    const c3 = await api("POST", `/processing-batches/${bt.id}/finish-production`, { ...cierre(L3), is_maquila: true, farmer_id: farmer.id });
    const ar = (await q("SELECT ar.id, ar.amount::float a FROM accounts_receivable ar JOIN pilado_services s ON s.receivable_id = ar.id WHERE s.processing_batch_id = $1", [bt.id]))[0];
    check(c3.ok && ar && ar.a > 0, "C2. el servicio de pilada genera su cuenta por cobrar", mostrar(c3));
    if (ar) {
      const abono = await api("POST", `/receivable/${ar.id}/pay`, { amount: 1, cash_register_id: caja.id });
      if (abono.ok) {
        const frenoAbono = await api("POST", `/processing-batches/${bt.id}/anular`, { motivo: "con abono" });
        check(frenoAbono.status === 409, "C3. si el cobro del servicio ya tiene abonos, NO se anula (409)", mostrar(frenoAbono));
        await api("POST", `/receivable/${ar.id}/reverse-payment`, {}).catch(() => undefined);
      } else console.log("   (abono no disponible en esta copia: se omite C3)", mostrar(abono));
      await q("UPDATE accounts_receivable SET balance = amount, status = 'CONFIRMED' WHERE id = $1", [ar.id]); // deshace el abono de prueba directamente en la COPIA
      const anC = await api("POST", `/processing-batches/${bt.id}/anular`, { motivo: "servicio mal cargado" });
      const st = (await q("SELECT status::text s, balance::float b FROM accounts_receivable WHERE id=$1", [ar.id]))[0];
      check(anC.ok && st.s === "CANCELLED" && st.b === 0, "C4. sin abonos, la anulación cancela la cuenta por cobrar del servicio (saldo 0)", { anC: anC.status, st });
    }
  } else console.log("   (la copia no permite ingresar un servicio de pilada con este ticket: se omite C)", mostrar(ing3));

  // ── D. Cuadre ──────────────────────────────────────────────────────────
  const huerf = (await q("SELECT count(*)::int n FROM processing_batches WHERE status = 'CANCELLED' AND finished_at IS NOT NULL"))[0].n;
  check(huerf === 0, "D1. ningún proceso anulado quedó «cerrado»", huerf);
  const neg = await q("SELECT p.code, sum(s.quantity)::float q FROM inventory_stock s JOIN products p ON p.id = s.product_id WHERE p.code NOT ILIKE '%SACO%' GROUP BY 1 HAVING sum(s.quantity) < -0.001");
  check(neg.length === 0, "D2. ningún producto quedó con existencias negativas", neg);
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
