// 🧹 Selectora de la piladora (pedido del dueño 2026-11-06): al socio se le cobra su tarifa del tarifario; de eso sale lo de
// la selectora, que le queda por pagar a su dueño. Con un cliente, la cuenta queda a la Matriz. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, matriz, operador } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const hoyEc = (await q("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text d"))[0].d;
const ayer = (await q("SELECT ((now() AT TIME ZONE 'America/Guayaquil')::date - 1)::text d"))[0].d;
try {
  const prods = await q("SELECT id, code FROM products");
  const P = (c) => prods.find((p) => p.code === c)?.id;
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name = 'STALYN'"))[0].id;
  const tarifaSocio = (await q("SELECT precio_por_qq::float p FROM tarifario_servicio WHERE socio_id = $1 AND servicio = 'PILADO' AND is_active ORDER BY fecha_vigencia DESC LIMIT 1", [stalyn]))[0].p;
  check(tarifaSocio === 4.5, "0. STALYN tiene $4.50 en el tarifario", tarifaSocio);

  // Lote propio de STALYN: 110 QQ, de ellos 10 QQ en sacos de 25 lb (recargo de arroba).
  const pilar = async (etiqueta, extra = {}) => {
    const nuevo = exigir(await api("POST", "/saldos-iniciales/inventario", { corte: "2026-11-03", product_id: P("CASCARA-011"), cantidad: 200, detalle: `sim selectora ${etiqueta}` }, stalyn), `${etiqueta}: cargar lote`);
    const lote = (await q("SELECT id, lot_code FROM lots WHERE lot_code = $1", [nuevo.lote]))[0];
    const batch = exigir(await api("POST", "/processing-batches", { lot_id: lote.id, process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: 200 * 45.359237 }, stalyn), `${etiqueta}: abrir la pilada`);
    const fin = exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
      lot_id: lote.id, is_maquila: false, input_paddy_kg: 200 * 45.359237, pilador_name: "SIM PILADOR", estibador_name: "SIM ESTIBADOR", tulas: 5,
      white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: 110, unit: "QQ" },
      white_rice_presentations: [{ presentation: "TULA", quantity: 100, destino: "TULA", tulas: 5 }, { presentation: "25 LB", quantity: 10, sack_weight_lb: 25, destino: "SACO" }],
      bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: 40, unit: "QQ" }, sacks_used: 0, ...extra
    }, stalyn), `${etiqueta}: finalizar`);
    return { lote, batch, fin };
  };
  const cuentas = async (batchId) => {
    const s = (await q("SELECT id, total::float total, rate_per_qq::float rate, detalle, receivable_id, payable_id FROM pilado_services WHERE processing_batch_id = $1", [batchId]))[0];
    const cargo = (await q("SELECT accionista_id, total::float total, quintales::float qq, tarifa_qq::float tarifa, payable_id, fecha::text fecha FROM selectora_cargos WHERE processing_batch_id = $1", [batchId]))[0];
    const ar = s ? (await q("SELECT amount::float a, balance::float b, status::text st, description d FROM accounts_receivable WHERE id = $1", [s.receivable_id]))[0] : null;
    const ap = s?.payable_id ? (await q("SELECT amount::float a, balance::float b, status::text st FROM accounts_payable WHERE id = $1", [s.payable_id]))[0] : null;
    const sel = cargo ? (await q("SELECT accionista_id, amount::float a, balance::float b, status::text st, reference_type r FROM accounts_payable WHERE id = $1", [cargo.payable_id]))[0] : null;
    return { s, cargo, ar, ap, sel };
  };

  // ── A. Configuración ─────────────────────────────────────────────────────
  const prov = exigir(await api("POST", "/selection/providers", { name: "SIM DUENO SELECTORA" }), "A1. persona que cobra la selectora");
  const op = await operador("sim_selectora", ["Configuracion"]);
  check((await op("POST", "/pilado/selectora", { provider_id: prov.id, precio_por_qq: 0.7, fecha_vigencia: hoyEc })).status === 403, "A2. sin ser administrador no se guarda la selectora");
  check((await op("PUT", "/pilado/tarifa-clientes", { precio_por_qq: 1 })).status === 403, "A3. ni la tarifa de clientes");
  exigir(await api("POST", "/pilado/selectora", { provider_id: prov.id, precio_por_qq: 0.7, fecha_vigencia: hoyEc }), "A4. selectora a $0.70 desde hoy");
  exigir(await api("PUT", "/pilado/tarifa-clientes", { precio_por_qq: 5 }, stalyn), "A5. tarifa a clientes con un socio activo");
  let cfg = exigir(await api("GET", "/pilado/servicio-config"), "A6. leer");
  check(cfg.tarifa_clientes === 5 && cfg.selectora?.tarifa === 0.7 && cfg.selectora?.proveedor === "SIM DUENO SELECTORA", "A7. queda la tarifa de la Matriz y la selectora", cfg);

  // ── B. Socio ─────────────────────────────────────────────────────────────
  const B = await pilar("B");
  const b = await cuentas(B.batch.id);
  // 110 × 4.50 + 10 × 0.80 (arroba) = 503; selectora 110 × 0.70 = 77; a la Matriz 426.
  check(cerca(b.cargo?.total, 77) && cerca(b.cargo?.qq, 110) && b.cargo?.accionista_id === stalyn, "B1. selectora $77 a cargo de STALYN", b.cargo);
  check(cerca(b.ar?.a, 426), "B2. la Matriz cobra $426 = $503 menos la selectora", b.ar);
  check(cerca(b.ap?.a, 426), "B3. su espejo: STALYN le debe $426 a la Matriz", b.ap);
  check(b.sel?.r === "selectora_servicio" && cerca(b.sel?.a, 77), "B4. y le debe $77 al dueño de la selectora", b.sel);
  check(cerca(b.s.total, 426) && cerca(b.s.detalle.reduce((t, l) => t + Number(l.subtotal), 0), 426), "B5. el desglose del servicio cuadra", b.s.detalle);
  check(/menos selectora/.test(b.ar.d) && /\$4\.5/.test(b.ar.d), "B6. el detalle explica la resta", b.ar.d);
  check(B.fin.selectora?.total === 77 && B.fin.selectora?.paga === "STALYN", "B7. la respuesta avisa la cuenta", B.fin.selectora);
  const y = (await q("SELECT tarifa_pilada_aplicada::float t FROM production_yields WHERE processing_batch_id = $1", [B.batch.id]))[0];
  check(y.t === 4.5, "B8. el costo del lote queda con los $4.50 completos", y);
  const lista = exigir(await api("GET", "/cash/payables", undefined, stalyn), "B9. Por Pagar de STALYN").find((x) => x.id === b.cargo.payable_id);
  check(lista?.farmer_name === "SIM DUENO SELECTORA" && !lista?.entre_socios, "B10. sale a nombre del dueño de la selectora", lista?.farmer_name);

  // ── C. Pago y anulación ──────────────────────────────────────────────────
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim selectora", tipo: "EFECTIVO", opening_balance_cash: 500 }, stalyn), "C1. caja de STALYN").id;
  const matrizAntes = (await q("SELECT count(*)::int n FROM cash_movements WHERE category = 'PAGO_SELECCION'"))[0].n;
  exigir(await api("POST", `/cash/payables/${b.cargo.payable_id}/pay`, { cash_register_id: caja, amount: 20 }, stalyn), "C2. abonar $20");
  const mov = (await q("SELECT category, amount::float a FROM cash_movements WHERE reference_type = 'accounts_payable' AND reference_id = $1", [b.cargo.payable_id]));
  check(mov.length === 1 && mov[0].category === "PAGO_SELECCION" && cerca(mov[0].a, 20), "C3. sale de su caja una sola vez", mov);
  check((await q("SELECT count(*)::int n FROM cash_movements WHERE category = 'PAGO_SELECCION'"))[0].n === matrizAntes + 1, "C4. sin espejo: no entra plata a la Matriz");
  check(cerca((await cuentas(B.batch.id)).ar.b, 426), "C5. lo que debe a la Matriz no cambia");
  const anulaPagada = await api("POST", `/processing-batches/${B.batch.id}/anular`, { motivo: "prueba con abono" }, stalyn);
  check(anulaPagada.status === 409 && /selectora/.test(mostrar(anulaPagada)), "C6. con abono no se anula", mostrar(anulaPagada));

  const C = await pilar("C");
  const c0 = await cuentas(C.batch.id);
  exigir(await api("POST", `/processing-batches/${C.batch.id}/anular`, { motivo: "Cantidades mal digitadas" }, stalyn), "C7. anular sin abonos");
  const apSel = (await q("SELECT status::text st, balance::float b FROM accounts_payable WHERE id = $1", [c0.cargo.payable_id]))[0];
  check(apSel.st === "CANCELLED" && apSel.b === 0, "C8. la cuenta de la selectora se cancela", apSel);
  check(!(await cuentas(C.batch.id)).cargo, "C9. no queda el cargo");

  // ── D. Antes de la fecha de vigencia ─────────────────────────────────────
  const D = await pilar("D", { fecha_pilado: ayer });
  const d = await cuentas(D.batch.id);
  check(!d.cargo && cerca(d.ar?.a, 503), "D1. pilado antes de la fecha: sin selectora, todo a la Matriz", { cargo: d.cargo, ar: d.ar?.a });

  // ── E. Cliente ───────────────────────────────────────────────────────────
  const sec = (await q(`SELECT d.id, d.lot_id, d.input_weight_kg::float kg FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id
                         WHERE l.is_maquila AND d.status = 'COMPLETED' AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id) LIMIT 1`))[0];
  check(!!sec, "E0. hay un secado de cliente sin pilar");
  const batchE = exigir(await api("POST", "/processing-batches", { lot_id: sec.lot_id, drying_report_id: sec.id, process_type: "PILADO", ownership: "MAQUILA", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: sec.kg }), "E1. abrir la pilada del cliente");
  exigir(await api("POST", `/processing-batches/${batchE.id}/finish-production`, {
    lot_id: sec.lot_id, is_maquila: true, input_paddy_kg: sec.kg, pilador_name: "SIM PILADOR", estibador_name: "SIM ESTIBADOR",
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: 100, unit: "QQ" },
    bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: 10, unit: "QQ" }, sacks_used: 0
  }), "E2. finalizar 100 QQ");
  const e = await cuentas(batchE.id);
  const minimo = Math.round((sec.kg / 100) * 1.07 * 100) / 100;
  check(cerca(e.ar?.a, Math.round(minimo * 5 * 100) / 100), `E3. al cliente se le cobra todo, con el mínimo ${minimo} QQ a $5`, e.ar?.a);
  check(e.cargo?.accionista_id === matriz && cerca(e.cargo?.total, 70) && cerca(e.cargo?.qq, 100), "E4. la selectora queda a la Matriz, por los 100 QQ reales", e.cargo);
  check(e.sel?.accionista_id === matriz && cerca(e.sel?.a, 70), "E5. en el Por Pagar de la Matriz", e.sel);
  const [yy, mm] = hoyEc.split("-").map(Number);
  const rm = exigir(await api("GET", `/resultado-mensual?year=${yy}&month=${mm}`), "E6. Resultado mensual");
  check(cerca(rm.rubros.find((r) => r.nombre === "Selectora")?.gasto_total, 70), "E7. sale en su rubro del mes", rm.rubros.find((r) => r.nombre === "Selectora"));
  const er = exigir(await api("GET", `/finance/income-statement?desde=${hoyEc}&hasta=${hoyEc}`, undefined, stalyn), "E8. Estado de Resultados de STALYN");
  check(JSON.stringify(er).includes("servicios_recibidos"), "E9. lo tiene en servicios recibidos");
  cfg = exigir(await api("GET", "/pilado/servicio-config"), "E10. leer");
  check(cfg.pendiente.some((x) => x.accionista === "STALYN" && cerca(x.saldo, 57)) && cfg.pendiente.some((x) => x.accionista === "CEYRO" && cerca(x.saldo, 70)), "E11. se ve lo pendiente por pagar", cfg.pendiente);

  // ── F. Dejar de cobrarla ─────────────────────────────────────────────────
  exigir(await api("POST", "/pilado/selectora", { provider_id: prov.id, precio_por_qq: 0, fecha_vigencia: hoyEc }), "F1. guardar $0 con la misma fecha");
  const F = await pilar("F");
  const f = await cuentas(F.batch.id);
  check(!f.cargo && cerca(f.ar?.a, 503), "F2. en $0 no se genera nada y todo es de la Matriz", { cargo: f.cargo, ar: f.ar?.a });

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
