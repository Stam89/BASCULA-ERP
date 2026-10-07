// Liquidaciones a agricultores: cálculo, pago, anticipos, doble clic, edición, anulación y fletes.
// Sobre una COPIA de la base (servidor real en :4001). Cada FAIL es un hueco real.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 240)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dos = (f) => Promise.all([f(), f()]);
// Lo pagado de una cuenta por pagar = egresos de caja que la pagaron − sus reversas.
const PAGADO_SQL = `SELECT a.id, a.amount::float a, a.balance::float b,
    COALESCE((SELECT sum(m.amount) FROM cash_movements m WHERE m.reference_type='accounts_payable' AND m.reference_id=a.id), 0)::float
  - COALESCE((SELECT sum(r.amount) FROM cash_movements r JOIN cash_movements m ON m.id = r.reversal_of WHERE m.reference_type='accounts_payable' AND m.reference_id=a.id), 0)::float AS pagado
  FROM accounts_payable a`;

try {
  const farmer = (await q("SELECT id FROM farmers ORDER BY full_name LIMIT 1"))[0].id;
  const otroAgri = (await q("SELECT id FROM farmers ORDER BY full_name DESC LIMIT 1"))[0].id;
  const plataforma = (await q("SELECT id FROM campo_activos WHERE nombre='PLATAFORMA'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja Liq", tipo: "EFECTIVO", opening_balance_cash: 20000 }), "0. Abrir caja con $20,000");
  const saldoCaja = async () => r2((await api("GET", `/cash/registers/${caja.id}/summary`)).data.current_balance);

  // Ingresos de materia prima (COMPRA) del mismo agricultor, listos para liquidar.
  const tickets = await q(`SELECT id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 5 ORDER BY id LIMIT 14`);
  const ingresos = [];
  for (const t of tickets) {
    await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer });
    const i = await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" });
    if (i.ok) ingresos.push({ id: i.data.ingreso.id, qq: t.qq });
  }
  check(ingresos.length >= 13, "0b. hay 13+ ingresos para probar", ingresos.length);
  const [E1, E2, E3, E4, E5, E6, E7] = ingresos;
  const liquidar = (E, extra = {}) => api("POST", "/liquidations", { farmer_id: farmer, weighing_ticket_id: E.id, quintals: E.qq, price_per_quintal: 30, other_discounts: 0, ...extra });
  const apDe = async (liqId) => (await q("SELECT * FROM accounts_payable WHERE liquidation_id=$1 AND reference_type IS NULL", [liqId]))[0];

  // ── A. Cálculo básico y vista previa ───────────────────────────────────
  const prev = (await api("POST", "/liquidations/preview", { farmer_id: farmer, weighing_ticket_id: E1.id, quintals: E1.qq, price_per_quintal: 30, other_discounts: 0 })).data;
  const L1 = exigir(await liquidar(E1), "A1. Liquidar el ingreso 1 a $30/QQ");
  check(r2(L1.gross_amount) === r2(E1.qq * 30) && r2(L1.net_amount) === r2(E1.qq * 30), "A2. bruto = QQ × precio y neto = bruto sin descuentos", { gross: L1.gross_amount, net: L1.net_amount });
  check(r2(prev.net_amount) === r2(L1.net_amount), "A3. la vista previa coincide con la liquidación real", { previa: prev.net_amount, real: L1.net_amount });
  const ap1 = await apDe(L1.id);
  check(!!ap1 && r2(ap1.amount) === r2(L1.net_amount) && r2(ap1.balance) === r2(L1.net_amount), "A4. nace la cuenta por pagar al agricultor por el neto", ap1 && { amount: ap1.amount, balance: ap1.balance });

  // ── B. Doble clic sobre el mismo ingreso ───────────────────────────────
  const [d1, d2] = await dos(() => liquidar(E2));
  check([d1, d2].filter((r) => r.status === 201).length === 1, "B1. liquidar el mismo ingreso dos veces a la vez crea UNA sola liquidación", [d1.status, d2.status]);
  check((await q("SELECT count(*)::int n FROM liquidations WHERE weighing_ticket_id=$1 AND status<>'CANCELLED'", [E2.id]))[0].n === 1, "B2. y una sola en la base");
  const L2 = d1.status === 201 ? d1.data : d2.data;

  // ── C. Pago de la liquidación desde caja ───────────────────────────────
  const s0 = await saldoCaja();
  const pago = exigir(await api("POST", `/cash/payables/${ap1.id}/pay`, { cash_register_id: caja.id, amount: Number(ap1.balance) }), "C1. Pagar la liquidación 1 completa desde caja");
  check(r2(s0 - (await saldoCaja())) === r2(L1.net_amount), "C2. la caja pagó exactamente el neto", { salio: r2(s0 - (await saldoCaja())), neto: L1.net_amount });
  check((await apDe(L1.id)).status === "PAID", "C3. la cuenta queda PAGADA");
  void pago;

  // ── D. Anticipos descontados al liquidar ───────────────────────────────
  const ant = exigir(await api("POST", "/advances", { farmer_id: farmer, amount: 100, concept: "Anticipo de prueba" }), "D0. Anticipo de $100 al agricultor (sin caja)");
  const L3 = exigir(await liquidar(E3), "D1. Liquidar el ingreso 3 con un anticipo pendiente de $100");
  check(r2(L3.advances_discount) === 100 && r2(L3.net_amount) === r2(E3.qq * 30 - 100), "D2. descuenta el anticipo completo y el neto baja $100", { desc: L3.advances_discount, neto: L3.net_amount, esperado: r2(E3.qq * 30 - 100) });
  const antDb = (await q("SELECT balance::float b, status FROM farmer_advances WHERE id=$1", [ant.id]))[0];
  check(antDb.b === 0 && antDb.status === "PAID", "D3. el anticipo queda en 0 y PAGADO", antDb);
  check((await q("SELECT COALESCE(sum(amount_applied),0)::float n FROM advance_applications WHERE liquidation_id=$1", [L3.id]))[0].n === 100, "D4. queda registrada la aplicación de $100");
  const L4 = exigir(await liquidar(E4), "D5. la liquidación siguiente ya no vuelve a descontar ese anticipo");
  check(r2(L4.advances_discount) === 0, "D6. descuento de anticipos = 0 en la siguiente", L4.advances_discount);

  // ── E. Descuentos propios: flete de flota propia y de tercero ──────────
  const L5 = exigir(await liquidar(E5, { other_discounts: 50, discount_breakdown: { fomento: 0, bascula: 0, flete: 50, cosechadora: 0 }, flete_detalle: { monto: 50, tipo: "propia", activo_id: plataforma } }), "E1. Liquidar con flete de flota propia $50");
  check(r2(L5.net_amount) === r2(E5.qq * 30 - 50), "E2. el neto descuenta el flete", { neto: L5.net_amount });
  const sv = (await q("SELECT s.* FROM campo_servicios s WHERE s.origen_tipo='liquidacion_flete' AND s.origen_id=$1", [L5.id]))[0];
  check(!!sv && r2(sv.valor) === 50, "E3. nace la cuenta por cobrar de Transporte y Cosechadora ($50)", sv && sv.valor);
  check((await q("SELECT 1 FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [sv.id])).length === 1, "E4. y el espejo en Por Pagar del socio");
  const L6 = exigir(await liquidar(E6, { other_discounts: 20, discount_breakdown: { fomento: 0, bascula: 0, flete: 20, cosechadora: 0 }, flete_detalle: { monto: 20, tipo: "tercero", prestador: "Don Pedro" } }), "E5. Liquidar con flete de tercero $20");
  check((await q("SELECT amount::float a FROM accounts_payable WHERE liquidation_id=$1 AND reference_type='flete_tercero'", [L6.id]))[0]?.a === 20, "E6. nace la cuenta por pagar al transportista externo ($20)");

  // ── F. Descuentos mayores al bruto ─────────────────────────────────────
  const L7 = exigir(await liquidar(E7, { price_per_quintal: 1, other_discounts: 5000 }), "F1. Liquidar con descuentos mayores al bruto");
  check(r2(L7.net_amount) === 0 && !(await apDe(L7.id)), "F2. el neto queda en $0 y no se crea cuenta por pagar", { neto: L7.net_amount });

  // ── G. Reglas de pertenencia ───────────────────────────────────────────
  const ajeno = await api("POST", "/liquidations", { farmer_id: otroAgri, weighing_ticket_id: E1.id, quintals: 1, price_per_quintal: 30, other_discounts: 0 });
  check(!ajeno.ok, "G1. liquidar un ingreso a nombre de OTRO agricultor se rechaza", mostrar(ajeno));
  const yaLiq = await liquidar(E1);
  check(yaLiq.status === 409, "G2. liquidar de nuevo un ingreso ya liquidado se rechaza (409)", yaLiq.status);
  const deOtroSocio = await api("POST", "/liquidations", { farmer_id: farmer, weighing_ticket_id: E1.id, quintals: E1.qq, price_per_quintal: 30, other_discounts: 0 }, (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id);
  check(!deOtroSocio.ok, "G3. un socio no puede liquidar un ingreso de la matriz", mostrar(deOtroSocio));

  // ── H. Aplicar anticipos DESPUÉS de liquidar ───────────────────────────
  const apAntes = await apDe(L4.id);
  const ant2 = exigir(await api("POST", "/advances", { farmer_id: farmer, amount: 40, concept: "Anticipo posterior" }), "H0. Nuevo anticipo de $40");
  const aplic = exigir(await api("POST", `/liquidations/${L4.id}/apply-advances`, {}), "H1. Aplicar el anticipo a la liquidación 4 ya hecha");
  const apDesp = await apDe(L4.id);
  const liq4 = (await q("SELECT net_amount::float n, advances_discount::float a FROM liquidations WHERE id=$1", [L4.id]))[0];
  check(r2(apDesp.balance) === r2(apAntes.balance - 40) && liq4.a === 40 && r2(liq4.n) === r2(Number(L4.net_amount) - 40), "H2. baja el saldo por pagar y el neto de la liquidación en $40", { saldo: apDesp.balance, neto: liq4.n });
  check(r2(apDesp.amount) === r2(liq4.n), "H3. el monto de la cuenta por pagar coincide con el nuevo neto (no queda un monto viejo)", { cuenta_monto: apDesp.amount, neto_liquidacion: liq4.n });
  const anulaH = await api("POST", `/liquidations/${L4.id}/anular`, { motivo: "prueba de anulación tras anticipo" });
  check(anulaH.ok, "H4. se puede anular una liquidación a la que se aplicó un anticipo (no se paga nada)", mostrar(anulaH));
  if (anulaH.ok) check(r2((await q("SELECT balance::float b FROM farmer_advances WHERE id=$1", [ant2.id]))[0].b) === 40, "H5. y el anticipo de $40 vuelve a estar pendiente");

  // ── I. Editar una liquidación (admin desbloquea) ───────────────────────
  exigir(await api("POST", "/liquidations/set-lock", { ids: [L1.id], unlocked: true }), "I0. Desbloquear la liquidación 1 (ya pagada)");
  const baja = await api("PUT", `/liquidations/${L1.id}`, { price_per_quintal: 10 });
  const pagadoL1 = r2((await q(PAGADO_SQL + " WHERE a.id=$1", [ap1.id]))[0]?.pagado ?? 0);
  const netoL1 = r2((await q("SELECT net_amount::float n FROM liquidations WHERE id=$1", [L1.id]))[0].n);
  check(!baja.ok || netoL1 >= pagadoL1 - 0.01, "I1. no se puede bajar el neto de una liquidación por debajo de lo ya pagado al agricultor", { neto: netoL1, pagado: pagadoL1, status: baja.status });
  const L2ap = await apDe(L2.id);
  exigir(await api("POST", "/liquidations/set-lock", { ids: [L2.id], unlocked: true }), "I2. Desbloquear la liquidación 2 (sin pagos)");
  const sube = await api("PUT", `/liquidations/${L2.id}`, { price_per_quintal: 40 });
  const apTrasEdicion = await apDe(L2.id);
  check(sube.ok && r2(apTrasEdicion.amount) === r2(E2.qq * 40) && apTrasEdicion.status === "CONFIRMED", "I3. subir el precio en una liquidación sin pagos actualiza la cuenta y la deja «por pagar» (no «parcial»)", apTrasEdicion && { amount: apTrasEdicion.amount, balance: apTrasEdicion.balance, status: apTrasEdicion.status });
  void L2ap;

  // ── J. Anulaciones ─────────────────────────────────────────────────────
  const anulaPagada = await api("POST", `/liquidations/${L1.id}/anular`, { motivo: "prueba con pago" });
  check(anulaPagada.status === 409, "J1. anular una liquidación ya pagada se rechaza (409: reversa el pago primero)", anulaPagada.status);
  const anulaL5 = await api("POST", `/liquidations/${L5.id}/anular`, { motivo: "prueba con flete propio" });
  check(anulaL5.ok, "J2. anular la liquidación con flete propio", mostrar(anulaL5));
  check((await q("SELECT 1 FROM campo_servicios WHERE id=$1", [sv.id])).length === 0 && (await q("SELECT 1 FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [sv.id])).length === 0, "J3. desaparece la cuenta por cobrar de Transporte y su espejo");
  const dobleAnula = await api("POST", `/liquidations/${L5.id}/anular`, { motivo: "otra vez" });
  check(dobleAnula.status === 409, "J4. anular dos veces la misma se rechaza", dobleAnula.status);
  const anulaL3 = await api("POST", `/liquidations/${L3.id}/anular`, { motivo: "prueba con anticipo" });
  check(anulaL3.ok && r2((await q("SELECT balance::float b FROM farmer_advances WHERE id=$1", [ant.id]))[0].b) === 100, "J5. anular la liquidación 3 devuelve el anticipo de $100", mostrar(anulaL3));
  const reliq = await liquidar(E3);
  check(reliq.status === 201, "J6. el ingreso de una liquidación anulada se puede volver a liquidar", mostrar(reliq));
  const [za, zb] = await dos(() => api("POST", `/liquidations/${L6.id}/anular`, { motivo: "doble clic" }));
  check([za, zb].filter((r) => r.ok).length === 1, "J7. anular dos veces a la vez anula UNA sola vez", [za.status, zb.status]);

  // ── L. Liquidación de VARIAS líneas: todas o ninguna ───────────────────
  const [E8, E9, E10, E11, E12, E13] = ingresos.slice(7);
  const linea = (E, extra = {}) => ({ farmer_id: farmer, weighing_ticket_id: E.id, quintals: E.qq, price_per_quintal: 30, other_discounts: 0, ...extra });
  const nLiq = async () => (await q("SELECT count(*)::int n FROM liquidations WHERE status<>'CANCELLED'"))[0].n;
  const n0 = await nLiq();
  const lote = await api("POST", "/liquidations/lote", { lineas: [linea(E8), linea(E9)] });
  check(lote.status === 201 && Array.isArray(lote.data) && lote.data.length === 2 && (await nLiq()) === n0 + 2, "L1. un lote de 2 líneas se guarda completo", mostrar(lote));
  const n1 = await nLiq();
  const loteMalo = await api("POST", "/liquidations/lote", { lineas: [linea(E10), linea(E1)] });
  check(loteMalo.status === 409 && (await nLiq()) === n1, "L2. si una línea falla (ingreso ya liquidado), NO se guarda ninguna", { status: loteMalo.status, antes: n1, despues: await nLiq() });
  check((await q("SELECT 1 FROM liquidations WHERE weighing_ticket_id=$1 AND status<>'CANCELLED'", [E10.id])).length === 0, "L3. la primera línea del lote fallido tampoco quedó hecha");
  const ant3 = exigir(await api("POST", "/advances", { farmer_id: farmer, amount: 50, concept: "Anticipo para lote" }), "L4. Anticipo de $50 antes de un lote");
  const loteAnt = await api("POST", "/liquidations/lote", { lineas: [linea(E10), linea(E11)] });
  const descTotal = r2((loteAnt.data ?? []).reduce((acc, l) => acc + Number(l.advances_discount), 0));
  check(loteAnt.status === 201 && descTotal === 50 && r2(loteAnt.data[0].advances_discount) === 50 && r2(loteAnt.data[1].advances_discount) === 0, "L5. en un lote el anticipo se descuenta UNA sola vez (en la primera línea)", { status: loteAnt.status, desc: (loteAnt.data ?? []).map?.((l) => l.advances_discount) });
  void ant3;

  // ── M. Aviso de quintales de más ───────────────────────────────────────
  const n2 = await nLiq();
  const demas = await api("POST", "/liquidations/lote", { lineas: [linea(E12, { quintals: r2(E12.qq + 10) })] });
  check(demas.status === 409 && demas.data?.code === "QQ_EXCEDE" && demas.data?.confirmable === true && /pesó/.test(demas.data?.error ?? ""), "M1. liquidar más QQ de los que pesó el ticket AVISA (confirmable)", mostrar(demas));
  check((await nLiq()) === n2, "M2. mientras no se confirme NO se guarda nada");
  const demasOk = await api("POST", "/liquidations/lote", { lineas: [linea(E12, { quintals: r2(E12.qq + 10) })] }, matriz, { "x-confirmar": "QQ_EXCEDE" });
  check(demasOk.status === 201 && r2(demasOk.data[0].quintals) === r2(E12.qq + 10), "M3. confirmando, se liquida con los QQ escritos", mostrar(demasOk));
  const menos = await api("POST", "/liquidations", linea(E13, { quintals: r2(E13.qq - 1) }));
  check(menos.status === 201, "M4. liquidar MENOS QQ de los pesados no pide nada", mostrar(menos));
  const unaDemas = await api("POST", "/liquidations", linea(E8, { quintals: 9999 }));
  check(unaDemas.status === 409 && (unaDemas.data?.code === "QQ_EXCEDE" || /ya fue liquidado/.test(unaDemas.data?.error ?? "")), "M5. la ruta de una sola línea también avisa (o rechaza si ya estaba liquidado)", mostrar(unaDemas));

  // ── K. Coherencia final: lo que debe el negocio = lo que dicen las cuentas ─
  const incoh = await q(`SELECT l.liquidation_number, l.net_amount::float n, a.amount::float a FROM liquidations l JOIN accounts_payable a ON a.liquidation_id=l.id AND a.reference_type IS NULL WHERE l.status<>'CANCELLED' AND abs(l.net_amount - a.amount) > 0.01`);
  check(incoh.length === 0, "K1. en toda liquidación vigente, el neto coincide con el monto de su cuenta por pagar", incoh);
  const pagosDemas = (await q(PAGADO_SQL + " WHERE a.status<>'CANCELLED'")).filter((x) => x.pagado > x.a + 0.01);
  check(pagosDemas.length === 0, "K2. ninguna cuenta por pagar tiene pagos mayores a su monto", pagosDemas);
  const saldoMal = (await q(PAGADO_SQL + " WHERE a.liquidation_id IS NOT NULL AND a.reference_type IS NULL AND a.status<>'CANCELLED'")).filter((x) => Math.abs((x.a - x.pagado) - x.b) > 0.01);
  check(saldoMal.length === 0, "K3. en las liquidaciones: monto − pagado = saldo (nada descuadrado)", saldoMal);
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
