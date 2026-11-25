// 🌱🚜 Liquidación sin descontar el fomento (arroz de un pariente) y con cosechadora de Transporte cuyo parte aún no está
// ingresado (máquina y operador después). Pedido del dueño 2026-11-25. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const socio = (await q("SELECT id FROM accionistas WHERE name = 'STALYN'"))[0].id;
  // Un ingreso propio sin liquidar y un agricultor con fomento activo (se le pone a ese agricultor el fomento si hace falta).
  const ing = await q(`SELECT w.id, w.farmer_id, w.quintals::float qq, f.full_name FROM weighing_tickets w JOIN farmers f ON f.id = w.farmer_id
                        WHERE w.accionista_id = $1 AND w.is_maquila = false AND w.quintals > 15
                          AND NOT EXISTS (SELECT 1 FROM liquidations l WHERE l.weighing_ticket_id = w.id AND l.status <> 'CANCELLED') ORDER BY w.created_at`, [socio]);
  if (ing.length < 5) throw new Error("la copia no tiene 5 ingresos sin liquidar");
  const fomentoDe = async (farmer, nombre, monto) => {
    const f = (await q("INSERT INTO fomentos (farmer_name, farmer_id, cuadras, inicio, renta, status, accionista_id) VALUES ($1, $2, 1, CURRENT_DATE, 0, 'ACTIVOS', $3) RETURNING id", [nombre, farmer, socio]))[0].id;
    await q("INSERT INTO fomento_entregas (fomento_id, fecha, valor, concepto) VALUES ($1, CURRENT_DATE, $2, 'mixta')", [f, monto]);
    return f;
  };
  const E = ing[0];
  const F = await fomentoDe(E.farmer_id, E.full_name, 200);
  const deuda = async (id) => (await q(`SELECT status, (SELECT COALESCE(sum(valor),0) FROM fomento_entregas WHERE fomento_id = f.id)::float - (SELECT COALESCE(sum(valor),0) FROM fomento_pagos WHERE fomento_id = f.id)::float s FROM fomentos f WHERE id = $1`, [id]))[0];
  const cos = await q("SELECT id, nombre FROM campo_activos WHERE tipo = 'cosechadora' AND activo ORDER BY nombre");
  const linea = (e, extra = {}) => ({ farmer_id: e.farmer_id, weighing_ticket_id: e.id, quintals: e.qq, price_per_quintal: 32, other_discounts: 0, ...extra });
  const liquidar = (e, extra) => api("POST", "/liquidations/lote", { lineas: [linea(e, extra)] }, socio);
  const conCosecha = (qq, precio, mas = {}) => ({ other_discounts: r2(qq * precio), discount_breakdown: { fomento: 0, bascula: 0, flete: 0, cosechadora: r2(qq * precio) },
    cosechadora_detalles: [{ qq, precio_por_qq: precio, tipo: "propia" }], ...mas });
  const porAsignar = async () => exigir(await api("GET", "/campo/partes/por-asignar", undefined, matriz), "por asignar");
  const antes = (await porAsignar()).pendientes.length;
  const anticipos = async (f) => r2((await q("SELECT COALESCE(sum(balance),0)::float s FROM farmer_advances WHERE farmer_id = $1 AND accionista_id = $2", [f, socio]))[0].s);

  // ── A. Sin descontar el fomento + cosechadora con parte por ingresar ──
  const ant = await anticipos(E.farmer_id);
  const L = exigir(await liquidar(E, conCosecha(20, 2.5, { nota_fomento: "Fomento sin descontar · Arroz de: hermano" })), "A1. liquidar sin descontar fomento y con 20 QQ de cosechadora a $2.50")[0];
  check(r2(L.net_amount) === r2(E.qq * 32 - 50 - Math.min(ant, E.qq * 32 - 50)), "A2. el neto solo baja la cosechadora (y los anticipos que ya tenía)", { neto: L.net_amount, ant });
  const d1 = await deuda(F);
  check(d1.s === 200 && d1.status === "ACTIVOS", "A3. el fomento queda igual, activo y debiendo lo mismo", d1);
  check((await q("SELECT nota_fomento n FROM liquidations WHERE id = $1", [L.id]))[0].n.includes("hermano"), "A4. queda anotado por qué");
  const det = (await q("SELECT d.*, a.por_asignar, a.activo FROM liquidation_harvest_details d JOIN campo_activos a ON a.id = d.activo_id WHERE liquidation_id = $1", [L.id]))[0];
  check(det?.campo_parte_id && det.por_asignar && det.activo === false, "A5. nace el parte con la máquina POR ASIGNAR");
  const svc = async () => (await q("SELECT s.*, v.saldo_pendiente::float saldo, a.nombre maquina FROM campo_servicios s JOIN campo_servicios_saldo v ON v.id = s.id JOIN campo_activos a ON a.id = s.activo_id WHERE s.origen_id = $1", [det.id]))[0];
  check(r2((await svc()).saldo) === 50, "A6. Transporte tiene $50 por cobrar al socio");
  check(r2((await q("SELECT balance::float b FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1 AND accionista_id=$2", [(await svc()).id, socio]))[0].b) === 50, "A7. y el socio se lo debe en su Por Pagar");
  const pend = await porAsignar();
  const P = pend.pendientes.find((x) => x.id === det.campo_parte_id);
  check(pend.pendientes.length === antes + 1 && P?.qq === 20 && P.monto === 50 && P.agricultor === E.full_name, "A8. sale en Transporte como cosecha por completar", P);
  check(!exigir(await api("GET", "/campo/activos", undefined, matriz), "activos").some((a) => a.nombre === "POR ASIGNAR"), "A9. «POR ASIGNAR» no sale en la lista de máquinas");
  const nom = exigir(await api("GET", "/campo/nomina-operadores?from=2000-01-01&to=2999-12-31", undefined, matriz), "nómina");
  check(!JSON.stringify(nom).includes(det.campo_parte_id), "A10. todavía no entra en la nómina de operadores");
  check(!exigir(await api("GET", `/liquidations/parte-cosechadora?farmer_id=${E.farmer_id}`, undefined, socio), "partes").partes.some((p) => p.id === det.campo_parte_id), "A11. no se vuelve a ofrecer en otra liquidación");

  // ── B. Completar máquina y operador ──
  check((await api("POST", `/campo/partes/${P.id}/asignar`, { activo_id: det.activo_id, operador: "PABLO" }, matriz)).status === 404, "B1. no deja elegir «POR ASIGNAR»");
  const noCos = (await q("SELECT id FROM campo_activos WHERE tipo <> 'cosechadora' AND activo LIMIT 1"))[0].id;
  check((await api("POST", `/campo/partes/${P.id}/asignar`, { activo_id: noCos, operador: "PABLO" }, matriz)).status === 400, "B2. ni un carro");
  exigir(await api("POST", `/campo/partes/${P.id}/asignar`, { activo_id: cos[0].id, operador: "PABLO", fecha: "2026-11-20" }, matriz), "B3. ponerle máquina y operador");
  const s2 = await svc();
  check(s2.maquina === cos[0].nombre && /Operador: PABLO/.test(s2.notas) && r2(s2.saldo) === 50, "B4. la cuenta por cobrar pasa a esa máquina, por el mismo valor", s2.notas);
  check((await porAsignar()).pendientes.length === antes, "B5. ya no está pendiente");
  const nom2 = exigir(await api("GET", "/campo/nomina-operadores?from=2000-01-01&to=2999-12-31", undefined, matriz), "nómina");
  check(JSON.stringify(nom2).includes(P.id), "B6. ahora sí entra en la nómina del operador");
  exigir(await api("POST", `/campo/partes/${P.id}/asignar`, { activo_id: cos[1].id, operador: "LEONEL" }, matriz), "B7. corregirla mientras no se le pague al operador");
  check((await svc()).maquina === cos[1].nombre && !/PABLO/.test((await svc()).notas), "B8. queda la corregida", (await svc()).notas);
  await q("UPDATE campo_partes SET operador_pagado_at = now() WHERE id = $1", [P.id]);
  check((await api("POST", `/campo/partes/${P.id}/asignar`, { activo_id: cos[0].id, operador: "PABLO" }, matriz)).status === 409, "B9. pagado el operador, no se cambia");
  await q("UPDATE campo_partes SET operador_pagado_at = NULL WHERE id = $1", [P.id]);

  // ── C. El parte ya estaba ingresado (con otro nombre): se enlaza y no se cobra dos veces ──
  const E2 = ing.find((x) => x.id !== E.id);
  const L2 = exigir(await liquidar(E2, conCosecha(30, 2)), "C1. otra liquidación con parte por ingresar")[0];
  const det2 = (await q("SELECT * FROM liquidation_harvest_details WHERE liquidation_id = $1", [L2.id]))[0];
  const ex = exigir(await api("POST", "/campo/partes", { fecha: "2026-11-18", activo_id: cos[0].id, operador: "PABLO", cliente: "Apodo raro", is_nuevo_externo: true, qq: 28 }, matriz), "C2. Transporte ingresa el parte con otro nombre");
  check((await porAsignar()).libres.some((x) => x.id === ex.id), "C3. sale para enlazarlo");
  exigir(await api("POST", `/campo/partes/${det2.campo_parte_id}/asignar`, { parte_existente_id: ex.id }, matriz), "C4. enlazarlo");
  const d3 = (await q("SELECT * FROM liquidation_harvest_details WHERE id = $1", [det2.id]))[0];
  check(d3.campo_parte_id === ex.id && d3.activo_id === cos[0].id && !(await q("SELECT 1 FROM campo_partes WHERE id = $1", [det2.campo_parte_id])).length, "C5. queda ese parte y el provisional desaparece");
  const cobro = await api("POST", `/campo/partes/${ex.id}/cobrar`, { precio_unitario: 2 }, matriz);
  check(cobro.status === 409, "C6. ese parte ya no se puede cobrar otra vez", mostrar(cobro));

  // ── D. Anular ──
  const E3 = ing.find((x) => ![E.id, E2.id].includes(x.id));
  const L3 = exigir(await liquidar(E3, conCosecha(10, 2)), "D1. otra con parte por ingresar")[0];
  const p3 = (await q("SELECT campo_parte_id p FROM liquidation_harvest_details WHERE liquidation_id = $1", [L3.id]))[0].p;
  exigir(await api("POST", `/liquidations/${L3.id}/anular`, { motivo: "simulacro" }, socio), "D2. anular sin haberla completado");
  check(!(await q("SELECT 1 FROM campo_partes WHERE id = $1", [p3])).length && (await porAsignar()).pendientes.length === antes, "D3. el parte pendiente se va con ella");
  exigir(await api("POST", `/liquidations/${L.id}/anular`, { motivo: "simulacro" }, socio), "D4. anular la que ya tenía máquina");
  const pa = (await q("SELECT estado, operador FROM campo_partes WHERE id = $1", [P.id]))[0];
  check(pa?.estado === "por_cobrar" && pa.operador === "LEONEL" && !(await q("SELECT 1 FROM campo_servicios WHERE origen_id = $1", [det.id])).length, "D5. el trabajo queda como parte por cobrar y se quita la cuenta", pa);

  // ── E. Con el fomento, como siempre ──
  const E4 = ing.find((x) => x.farmer_id === E.farmer_id && x.id !== E.id && ![E2.id, E3.id].includes(x.id)) ?? E;
  exigir(await liquidar(E4, { other_discounts: 200, discount_breakdown: { fomento: 200, bascula: 0, flete: 0, cosechadora: 0 } }), "E1. liquidar descontando el fomento");
  check((await deuda(F)).status === "CERRADO_LIQUIDACION" && (await deuda(F)).s === 0, "E2. el fomento se cobra y se cierra como siempre", await deuda(F));

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
