// 💵 Préstamo de JACOBO MACIAS (pedido del dueño 2026-11-06): se descuenta de a poco de lo que CEYRO le debe por la selectora,
// sin mover la gaveta. Lo que le deben los socios no entra. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, matriz, operador } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const F1 = "c04a147a-2e36-435f-b9ed-9cefc6d99341", F2 = "593a069d-dcd1-4aa5-a112-c3d6b7c58730", F3 = "cc4b8b51-e571-455f-a5ed-da3ea939e8bf";
const CAJA = "ebd52a08-d839-4a49-99a9-b7bde673faab";
try {
  const prods = await q("SELECT id, code FROM products");
  const P = (c) => prods.find((p) => p.code === c)?.id;
  const bod = await q("SELECT id, type FROM warehouses");
  const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name = 'STALYN'"))[0].id;
  const prov = (await q("SELECT id FROM external_providers WHERE name = 'JACOBO MACIAS'"))[0].id;
  const cats = await q("SELECT category FROM cash_movements WHERE id = ANY($1::uuid[])", [[F1, F2, F3]]);
  check(cats.length === 3 && cats.every((x) => x.category === "PRESTAMO_TERCERO"), "0. las 3 entregas son préstamo, no gasto", cats);
  check((await q("SELECT category FROM cash_movements WHERE es_fondo AND responsable = 'ROBERTO'"))[0].category !== "PRESTAMO_TERCERO", "0b. el fondo de Roberto no se tocó");

  const pilar = async (etiqueta, acc, qq) => {
    const nuevo = exigir(await api("POST", "/saldos-iniciales/inventario", { corte: "2026-11-03", product_id: P("CASCARA-011"), cantidad: 200, detalle: `sim prestamo ${etiqueta}` }, acc), `${etiqueta}: cargar lote`);
    const lote = (await q("SELECT id FROM lots WHERE lot_code = $1", [nuevo.lote]))[0];
    const batch = exigir(await api("POST", "/processing-batches", { lot_id: lote.id, process_type: "PILADO", ownership: "OWNED", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: 200 * 45.359237 }, acc), `${etiqueta}: abrir`);
    exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
      lot_id: lote.id, is_maquila: false, input_paddy_kg: 200 * 45.359237, pilador_name: "SIM PILADOR", estibador_name: "SIM ESTIBADOR", tulas: 5,
      white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: qq, unit: "QQ" },
      white_rice_presentations: [{ presentation: "TULA", quantity: qq, destino: "TULA", tulas: 5 }], sacks_used: 0
    }, acc), `${etiqueta}: finalizar ${qq} QQ`);
    return { batch, cuenta: (await q("SELECT payable_id FROM selectora_cargos WHERE processing_batch_id = $1", [batch.id]))[0].payable_id };
  };
  const cuenta = async (id) => (await q("SELECT balance::float b, status::text st FROM accounts_payable WHERE id = $1", [id]))[0];
  const estado = async (id) => (await q("SELECT fondo_estado e FROM cash_movements WHERE id = $1", [id]))[0].e;
  const saldo = async () => exigir(await api("GET", `/cash/payables/prestamo-selectora?provider_id=${prov}`), "leer préstamo").saldo;
  const gaveta = async () => (await q("SELECT count(*)::int n, COALESCE(sum(amount), 0)::float s FROM cash_movements"))[0];
  const fondosCaja = async () => (await api("GET", `/cash/registers/${CAJA}/summary`)).data.fondos_por_liquidar;

  const A = await pilar("A", matriz, 100), B = await pilar("B", matriz, 10), C = await pilar("C", stalyn, 10);
  check(cerca((await cuenta(A.cuenta)).b, 70) && cerca((await cuenta(B.cuenta)).b, 7), "1. CEYRO le debe $70 y $7 por su arroz");
  check(cerca(await saldo(), 60), "2. préstamo pendiente $60");
  const lista = exigir(await api("GET", "/cash/payables"), "2b. Por Pagar").find((x) => x.id === A.cuenta);
  check(lista?.selectora_provider_id === prov, "2c. la lista trae a la persona", lista?.selectora_provider_id);

  // ── Descontar una parte ──────────────────────────────────────────────────
  const g0 = await gaveta(), f0 = await fondosCaja();
  const d1 = exigir(await api("POST", "/cash/payables/prestamo-selectora/descontar", { payable_ids: [A.cuenta, B.cuenta], monto: 45 }), "3. descontar $45");
  const g1 = await gaveta(), f1 = await fondosCaja();
  check(g1.n === g0.n && cerca(g1.s, g0.s), "4. no se crea ningún movimiento de caja", { g0, g1 });
  check(cerca((await cuenta(A.cuenta)).b, 25) && (await cuenta(A.cuenta)).st === "PARTIAL" && cerca((await cuenta(B.cuenta)).b, 7), "5. baja la cuenta más vieja", await cuenta(A.cuenta));
  check(cerca(await saldo(), 15) && cerca(d1.saldo_prestamo, 15), "6. quedan $15 de préstamo");
  check(await estado(F1) === "LIQUIDADO" && await estado(F2) === "POR_LIQUIDAR", "7. el fondo de $40 quedó cubierto; el de $10 sigue a medias");
  check(cerca(f0.monto - f1.monto, 45), "8. el aviso de fondos por liquidar baja lo descontado", { f0, f1 });

  // ── Frenos ───────────────────────────────────────────────────────────────
  check((await api("POST", "/cash/payables/prestamo-selectora/descontar", { payable_ids: [A.cuenta], monto: 16 })).status === 409, "9. no más que el préstamo");
  check((await api("POST", "/cash/payables/prestamo-selectora/descontar", { payable_ids: [B.cuenta], monto: 8 })).status === 409, "10. no más que la cuenta");
  check((await api("POST", "/cash/payables/prestamo-selectora/descontar", { payable_ids: [C.cuenta], monto: 1 }, stalyn)).status === 409, "11. con un socio activo no se descuenta");
  check((await api("POST", "/cash/payables/prestamo-selectora/descontar", { payable_ids: [C.cuenta], monto: 1 })).status === 409, "12. ni la cuenta de un socio desde la Matriz");
  check((await api("GET", `/cash/payables/prestamo-selectora?provider_id=${prov}`, undefined, stalyn)).data === null, "13. el socio no ve el préstamo de la Matriz");
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim préstamo", tipo: "EFECTIVO", opening_balance_cash: 500 }), "14. caja de CEYRO").id;
  const liq = await api("POST", `/cash/movements/${F2}/liquidar`, { cash_register_id: caja, gasto_real: 10 });
  check(liq.status === 409 && /descuentos/.test(mostrar(liq)), "15. un fondo a medias no se liquida a mano", mostrar(liq));
  const rev = await api("POST", `/cash/movements/${F2}/reverse`, { reason: "prueba de anular fondo" });
  check(rev.status === 409 && /descuentos/.test(mostrar(rev)), "16. ni se anula", mostrar(rev));
  const anProd = await api("POST", `/processing-batches/${A.batch.id}/anular`, { motivo: "prueba con descuento" });
  check(anProd.status === 409, "17. la pilada con descuento no se anula", mostrar(anProd));
  const op = await operador("sim_prestamo", ["Por Pagar"]);
  check((await op("POST", `/cash/payables/prestamo-selectora/${d1.lote}/anular`, {})).status === 403, "18. anular es solo del administrador");

  // ── Anular y volver a descontar ──────────────────────────────────────────
  exigir(await api("POST", `/cash/payables/prestamo-selectora/${d1.lote}/anular`, {}), "19. anular el descuento");
  check(cerca((await cuenta(A.cuenta)).b, 70) && (await cuenta(A.cuenta)).st === "CONFIRMED", "20. la cuenta vuelve a deber", await cuenta(A.cuenta));
  check(cerca(await saldo(), 60) && await estado(F1) === "POR_LIQUIDAR", "21. el préstamo vuelve a $60");
  check((await api("POST", `/cash/payables/prestamo-selectora/${d1.lote}/anular`, {})).status === 404, "22. no se anula dos veces");

  exigir(await api("POST", "/cash/payables/prestamo-selectora/descontar", { payable_ids: [B.cuenta], monto: 7 }), "23. descontar toda una cuenta chica");
  check((await cuenta(B.cuenta)).st === "PAID", "24. la cuenta queda pagada", await cuenta(B.cuenta));
  exigir(await api("POST", `/cash/payables/${A.cuenta}/pay`, { cash_register_id: caja, amount: 70 }), "25. lo otro se paga como siempre");
  check((await cuenta(A.cuenta)).st === "PAID", "26. pagada");
  check(cerca(await saldo(), 53), "27. quedan $53 de préstamo", await saldo());

  // ── Resultado ────────────────────────────────────────────────────────────
  const hoy = (await q("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text d"))[0].d;
  const [yy, mm] = hoy.split("-").map(Number);
  const rm = exigir(await api("GET", `/resultado-mensual?year=${yy}&month=${mm}`), "28. Resultado mensual");
  const enRubros = rm.rubros.flatMap((r) => r.detalle).concat(rm.sin_clasificar.detalle).filter((m) => /selectada|selectora/i.test(m.descripcion) && m.categoria_codigo !== "SERVICIO_SELECTORA");
  check(enRubros.length === 0, "29. el préstamo no cuenta como gasto", enRubros);
  check(cerca(rm.rubros.find((r) => r.nombre === "Selectora")?.gasto_total, 77), "30. la selectora cuenta una sola vez: $77", rm.rubros.find((r) => r.nombre === "Selectora")?.gasto_total);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
