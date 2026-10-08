// Sacos (inventario de la Matriz), repuestos y mantenimiento de equipos: compras con caja, kárdex, anulación, carreras y permisos.
// SOLO contra la copia (sim_base aborta si no).
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dos = (f) => Promise.all([f(), f()]);

try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO", tipo: "EFECTIVO", opening_balance_cash: 1000 }), "0. CEYRO abre caja con $1000");
  const saldo = async () => r2((await api("GET", `/cash/registers/${caja.id}/summary`)).data.current_balance);
  const saco = (await q("SELECT id, tipo, stock::float s FROM sack_inventory WHERE accionista_id IS NULL AND activo ORDER BY tipo LIMIT 1"))[0];
  if (!saco) throw new Error("la copia no tiene sacos de la Matriz");
  const stockSaco = async () => (await q("SELECT stock::float s FROM sack_inventory WHERE id=$1", [saco.id]))[0].s;
  const kardex = async () => (await q("SELECT COALESCE(sum(CASE WHEN movement='ENTRADA' THEN cantidad ELSE -cantidad END),0)::float k FROM sack_movements WHERE sack_id=$1", [saco.id]))[0].k;

  // ── A. Sacos ───────────────────────────────────────────────────────────
  const s0 = await stockSaco(), c0 = await saldo();
  const comp = await api("POST", "/sacks/purchases", { items: [{ sack_id: saco.id, cantidad: 10, precio: 0.5 }], cash_register_id: caja.id });
  check(comp.ok && (await stockSaco()) === s0 + 10 && r2(c0 - (await saldo())) === 5, "A1. comprar 10 sacos a $0.50: entran 10 al stock y salen $5 de caja", mostrar(comp));
  const mov = (await q("SELECT id FROM cash_movements WHERE reference_type='sack_purchase' ORDER BY created_at DESC LIMIT 1"))[0];
  const rev = await api("POST", `/cash/movements/${mov.id}/reverse`, { reason: "compra equivocada" });
  check(rev.ok && (await stockSaco()) === s0, "A2. anular la compra en Caja devuelve el stock de sacos (queda como antes)", { stock: await stockSaco(), esperado: s0 });
  const sinCaja = await api("POST", "/sacks/purchases", { items: [{ sack_id: saco.id, cantidad: 1, precio: 1 }], cash_register_id: "00000000-0000-4000-8000-000000000000" });
  check(sinCaja.status === 404, "A3. comprar con una caja que no existe se rechaza (404)", sinCaja.status);
  const actual = await stockSaco();
  const salidaGrande = await api("POST", "/sacks/movements", { sack_id: saco.id, movement: "SALIDA", cantidad: actual + 1 });
  check(salidaGrande.status === 409, "A4. una salida mayor al stock se rechaza (409)", salidaGrande.status);
  if (actual >= 1) {
    const ss = await dos(() => api("POST", "/sacks/movements", { sack_id: saco.id, movement: "SALIDA", cantidad: actual }));
    check(ss.filter((r) => r.ok).length === 1 && (await stockSaco()) === 0 && ss.every((r) => r.status !== 500), "A5. dos salidas de TODO el stock a la vez: pasa UNA y el stock queda en 0 (no negativo)", { st: ss.map((r) => r.status), stock: await stockSaco() });
    await api("POST", "/sacks/movements", { sack_id: saco.id, movement: "ENTRADA", cantidad: actual, concepto: "reponer" });
  }
  // Ajuste manual: el kárdex debe seguir cuadrando
  const stBefore = await stockSaco(), kdBefore = await kardex();
  const aj = await api("PATCH", `/sacks/${saco.id}/adjust`, { stock: stBefore + 7 });
  const dStock = (await stockSaco()) - stBefore, dKardex = (await kardex()) - kdBefore;
  check(aj.ok && dStock === 7 && r2(dKardex) === 7, "A6. un ajuste manual de +7 deja su movimiento en el kárdex (stock y kárdex cambian igual)", { aj: aj.status, dStock, dKardex });
  const ajConc = await dos(() => api("PATCH", `/sacks/${saco.id}/adjust`, { stock: (stBefore + 7) + 3 }));
  check(ajConc.every((r) => r.status !== 500) && (await stockSaco()) === stBefore + 10, "A7. dos ajustes iguales a la vez no pisan ni duplican (queda en +3 sobre lo anterior)", { st: ajConc.map((r) => r.status), stock: await stockSaco() });
  // Aislamiento: un socio no toca los sacos de la Matriz
  const ajeno = await api("POST", "/sacks/movements", { sack_id: saco.id, movement: "ENTRADA", cantidad: 1 }, stalyn);
  const ajenoAdj = await api("PATCH", `/sacks/${saco.id}/adjust`, { stock: 999 }, stalyn);
  check(ajeno.status >= 400 && ajenoAdj.status >= 400 && (await stockSaco()) === stBefore + 10, "A8. un socio NO puede mover ni ajustar los sacos de la Matriz", [ajeno.status, ajenoAdj.status]);
  const porComprar = await api("GET", "/sacks/por-comprar");
  check(porComprar.ok, "A9. «Sacos por comprar» responde", porComprar.status);
  const delCon = await api("DELETE", `/sacks/${saco.id}`);
  check(delCon.ok && delCon.data.resultado === "DESACTIVADO", "A10. un saco con historial se DESACTIVA, no se borra", mostrar(delCon));
  await api("PATCH", `/sacks/${saco.id}`, { activo: true });

  // ── B. Repuestos ───────────────────────────────────────────────────────
  const rep = await api("POST", "/repuestos", { nombre: "REPUESTO SIMULACRO", unidad: "UNIDAD", stock_minimo: 1, costo_unitario: 2, stock_inicial: 5 });
  if (!rep.ok) { console.log("   (alta de repuesto no disponible con este formato: se omiten B y C)", mostrar(rep)); }
  else {
    const rid = rep.data.id;
    const stockRep = async () => Number((await q("SELECT stock::float s FROM repuestos WHERE id=$1", [rid]))[0].s);
    check(await stockRep() === 5, "B1. el repuesto nace con su stock inicial (5)", await stockRep());
    check((await api("POST", `/repuestos/${rid}/salida`, { cantidad: 99 })).status === 409, "B2. no se saca más de lo que hay (409)");
    const salC = await dos(() => api("POST", `/repuestos/${rid}/salida`, { cantidad: 5 }));
    check(salC.filter((r) => r.ok).length === 1 && await stockRep() === 0 && salC.every((r) => r.status !== 500), "B3. dos salidas de TODO el stock a la vez: pasa UNA y no queda negativo", { st: salC.map((r) => r.status), stock: await stockRep() });
    const c1 = await saldo();
    const ent = await api("POST", `/repuestos/${rid}/entrada`, { cantidad: 4, costo_unitario: 3, cash_register_id: caja.id, proveedor: "FERRETERIA" });
    check(ent.ok && await stockRep() === 4 && r2(c1 - (await saldo())) === 12, "B4. la compra de 4 repuestos a $3 entra al stock y saca $12 de caja", mostrar(ent));
    const movR = (await q("SELECT id FROM cash_movements WHERE reference_type='repuesto_compra' ORDER BY created_at DESC LIMIT 1"))[0];
    const revR = await api("POST", `/cash/movements/${movR.id}/reverse`, { reason: "compra equivocada" });
    check(revR.ok && await stockRep() === 0, "B5. anular esa compra en Caja devuelve el stock a 0", { stock: await stockRep(), r: revR.status });
    check((await api("POST", `/repuestos/${rid}/entrada`, { cantidad: 4, costo_unitario: 3 }, stalyn)).status === 403, "B6. un socio no maneja los repuestos de la planta (403)");
    await api("POST", `/repuestos/${rid}/ajuste`, { stock_real: 6, motivo: "conteo" });

    // ── C. Mantenimiento por área, con repuestos del stock ────────────────
    const c2 = await saldo();
    const man = await api("POST", "/equipment/maintenance", { area: "PILADORA", section: "MOTOR PRINCIPAL", maintenance_type: "CORRECTIVO", description: "Cambio de rodamiento", amount: 20, cash_register_id: caja.id, repuestos_usados: [{ repuesto_id: rid, cantidad: 3 }] });
    check(man.ok && r2(c2 - (await saldo())) === 20 && await stockRep() === 3, "C1. mantenimiento: sale $20 de caja y 3 repuestos del stock (quedan 3)", mostrar(man));
    const excede = await api("POST", "/equipment/maintenance", { area: "PILADORA", section: "MOTOR PRINCIPAL", maintenance_type: "CORRECTIVO", description: "Usa más de lo que hay", amount: 5, cash_register_id: caja.id, repuestos_usados: [{ repuesto_id: rid, cantidad: 50 }] });
    check(excede.status >= 400 && await stockRep() === 3, "C2. pedir más repuestos de los que hay se rechaza y NO queda nada a medias", mostrar(excede));
    const cx = await saldo();
    const dc = await dos(() => api("POST", "/equipment/maintenance", { area: "PILADORA", section: "MOTOR PRINCIPAL", maintenance_type: "CORRECTIVO", description: "Carrera por el mismo repuesto", amount: 1, cash_register_id: caja.id, repuestos_usados: [{ repuesto_id: rid, cantidad: 3 }] }));
    check(dc.filter((r) => r.ok).length <= 1 && await stockRep() >= 0 && dc.every((r) => r.status !== 500), "C3. dos mantenimientos que usan los últimos 3 repuestos a la vez: nunca stock negativo", { st: dc.map((r) => r.status), stock: await stockRep(), caja: r2(cx - (await saldo())) });
    const movM = (await q("SELECT id FROM cash_movements WHERE reference_type='equipment_maintenance' AND description LIKE '%rodamiento%' ORDER BY created_at DESC LIMIT 1"))[0];
    if (movM) {
      const stAntes = await stockRep();
      const revM = await api("POST", `/cash/movements/${movM.id}/reverse`, { reason: "mantenimiento mal cargado" });
      const em = (await q("SELECT status FROM equipment_maintenance WHERE id=$1", [man.data.id]))[0];
      check(revM.ok && em.status === "ANULADO" && await stockRep() === stAntes + 3, "C4. anular el egreso en Caja anula el mantenimiento y devuelve los 3 repuestos", { r: revM.status, estado: em.status, stock: await stockRep(), esperado: stAntes + 3 });
    }
    check((await api("POST", "/equipment/maintenance", { area: "PILADORA", section: "X", maintenance_type: "CORRECTIVO", description: "socio", amount: 5, cash_register_id: caja.id, repuestos_usados: [{ repuesto_id: rid, cantidad: 1 }] }, stalyn)).status >= 400, "C5. un socio no consume repuestos de la planta");
  }

  // ── D. Equipos ─────────────────────────────────────────────────────────
  const eq = await api("POST", "/equipment", { name: "EQUIPO SIMULACRO", type: "OTRO" });
  if (eq.ok) {
    const m1 = await api("POST", `/equipment/${eq.data.id}/maintenance`, { maintenance_type: "PREVENTIVO", description: "Revisión", amount: 15, cash_register_id: caja.id });
    check(m1.ok, "D1. mantenimiento de un equipo con egreso de caja", mostrar(m1));
    const del = await api("DELETE", `/equipment/${eq.data.id}`);
    check(del.ok && del.data.status === "FUERA_SERVICIO", "D2. un equipo con mantenimientos no se borra: pasa a «fuera de servicio»", mostrar(del));
    const sinCajaM = await api("POST", `/equipment/${eq.data.id}/maintenance`, { maintenance_type: "PREVENTIVO", description: "caja ajena", amount: 5, cash_register_id: caja.id }, stalyn);
    check(sinCajaM.status >= 400, "D3. un socio no puede cargar el mantenimiento a la caja de CEYRO", sinCajaM.status);
  }

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
