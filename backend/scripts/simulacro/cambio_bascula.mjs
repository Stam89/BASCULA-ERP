// ⚖️ Ticket que la báscula cambió DESPUÉS de ingresarlo (caso real: #000 387 de MARGARO): «Aplicar el peso nuevo»
// corrige ingreso, lote/secado/pilado, cáscara y liquidación; «Mantener el ingresado» lo descarta. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const lista = exigir(await api("GET", "/tickets/cambios-bascula", undefined, matriz), "A1. lista de tickets que la báscula cambió");
  const t = lista.find((x) => /387/.test(x.numero ?? ""));
  if (!t) { check(true, "A2. (la copia no tiene el ticket 387 con cambio: se omite)"); throw new Error("sin caso"); }
  check(t.neto === 950 && t.nuevo.neto === 1710 && t.nuevo.qq === 16.72, "A2. ticket 387: 950 kg ingresados → 1710 kg en la báscula (16.72 QQ)", t);

  const wtId = (await q("SELECT weighing_ticket_id FROM mobile_synced_tickets WHERE id = $1", [t.id]))[0].weighing_ticket_id;
  const liq0 = (await q("SELECT id, net_amount::float n, gross_amount::float g, other_discounts::float o FROM liquidations WHERE weighing_ticket_id = $1", [wtId]))[0];
  const cascara = async () => Number((await q(`SELECT COALESCE(sum(quantity),0)::float s FROM inventory_movements m JOIN products p ON p.id = m.product_id WHERE p.code = 'CASCARA-CORRIENTE'`))[0].s);
  const c0 = await cascara();
  const pb0 = (await q("SELECT pb.id, pb.input_quantity::float iq FROM processing_batches pb JOIN processing_batch_drying_lots d ON d.processing_batch_id = pb.id WHERE d.weighing_ticket_id = $1", [wtId]))[0];

  const r = exigir(await api("POST", `/tickets/${t.id}/aplicar-cambio`, {}, matriz), "B1. «Aplicar el peso nuevo»");
  check(r.qq === 16.72 && r.qq_antes === 9.29 && r.pilados === 1, "B2. 9.29 → 16.72 QQ, corregido también en su pilado", r);
  const wt = (await q("SELECT gross_weight::float g, tare_weight::float t, net_weight::float n, quintals::float qq FROM weighing_tickets WHERE id = $1", [wtId]))[0];
  check(wt.g === 5360 && wt.t === 3650 && wt.n === 1710 && wt.qq === 16.72, "B3. el ingreso queda 5360 / 3650 / 1710 kg / 16.72 QQ", wt);
  const liq = (await q("SELECT quintals::float qq, gross_amount::float g, net_amount::float n FROM liquidations WHERE id = $1", [liq0.id]))[0];
  const ap = (await q("SELECT amount::float a, balance::float b FROM accounts_payable WHERE liquidation_id = $1 AND reference_type IS NULL", [liq0.id]))[0];
  check(liq.qq === 16.72 && liq.g === 668.8 && Math.abs(liq.n - (668.8 - liq0.o)) < 0.01, "B4. liquidación: 16.72 QQ × $40 = $668.80, neto con los mismos descuentos", liq);
  check(ap.a === liq.n && ap.b === liq.n, `B5. la Por Pagar a MARGARO sube a $${liq.n}`, ap);
  check(Math.abs((await cascara()) - c0) < 0.001, "B6. el stock de cáscara no cambia (entró y salió al pilado lo mismo de más)", { antes: c0, ahora: await cascara() });
  const pb = (await q("SELECT input_quantity::float iq FROM processing_batches WHERE id = $1", [pb0.id]))[0];
  check(Math.abs(pb.iq - pb0.iq - 760) < 0.01, "B7. el pilado registra 760 kg más de entrada", { antes: pb0.iq, ahora: pb.iq });
  const otra = await api("POST", `/tickets/${t.id}/aplicar-cambio`, {}, matriz);
  check(otra.status === 409, "B8. no se aplica dos veces", otra.status);

  // ── C. «Mantener el ingresado» en otro ticket ──
  const otro = (await q(`SELECT id FROM mobile_synced_tickets WHERE weighing_ticket_id IS NOT NULL AND id <> $1 AND NOT raw_payload ? 'cambioPosterior' LIMIT 1`, [t.id]))[0];
  if (otro) {
    await q(`UPDATE mobile_synced_tickets SET raw_payload = raw_payload || jsonb_build_object('cambioPosterior', jsonb_build_object('pesoBruto', gross_weight + 100, 'pesoTara', tare_weight, 'calificacion', qualification, 'en', now())) WHERE id = $1`, [otro.id]);
    exigir(await api("POST", `/tickets/${otro.id}/descartar-cambio`, {}, matriz), "C1. «Mantener el ingresado»");
    const raw = (await q("SELECT raw_payload ? 'cambioPosterior' AS pend, raw_payload ? 'cambioDescartado' AS desc FROM mobile_synced_tickets WHERE id = $1", [otro.id]))[0];
    check(!raw.pend && raw.desc, "C2. el cambio queda descartado (guardado) y deja de avisar", raw);
  }

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, "Z. TODOS los controles de integridad se cumplen (incluido el aviso de báscula)", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { if (e.message !== "sin caso") console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
