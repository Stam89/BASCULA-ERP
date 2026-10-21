// 🤝 Cuentas entre socios (pedido del dueño 2026-10-21): saldo único por pareja, y cada pago/gasto/dinero entre socios
// baja PRIMERO lo que el que pone la plata le debía al otro (cualquier deuda); lo que pase queda como préstamo. El dinero
// entre socios mueve las DOS cajas con un solo registro; anularlo lo deshace todo. SOLO contra la copia.
import fs from "fs";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(n * 100) / 100;
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261112_dinero_entre_socios.sql", import.meta.url), "utf8"));
  const ceyro = matriz;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const rovinson = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const abrir = async (acc, nombre, tipo = "EFECTIVO") => exigir(await api("POST", "/cash/registers/open", { name: nombre, tipo, opening_balance_cash: 5000 }, acc), `0. caja de ${nombre}`);
  const cajaC = await abrir(ceyro, "CEYRO", "MIXTO");
  const cajaS = await abrir(stalyn, "STALYN", "MIXTO");
  const cajaR = await abrir(rovinson, "ROVINSON", "EFECTIVO");
  const saldoCaja = async (id) => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [id]))[0].s);
  const par = async (x, y) => {
    const ps = exigir(await api("GET", "/entre-socios/cuentas", undefined, ceyro), "cuentas");
    const p = ps.find((z) => (z.a.id === x && z.b.id === y) || (z.a.id === y && z.b.id === x));
    // devuelve cuánto x le debe a y y cuánto y le debe a x
    return p.a.id === x ? { xDebe: p.a_debe_b.total, yDebe: p.b_debe_a.total, p } : { xDebe: p.b_debe_a.total, yDebe: p.a_debe_b.total, p };
  };

  // 1. Pantalla: saldo único por pareja
  const p0 = await par(ceyro, stalyn);
  check(p0.xDebe > 0 && p0.yDebe > 0, "1. CEYRO y STALYN se deben en las dos direcciones", { ceyro_debe: p0.xDebe, stalyn_debe: p0.yDebe });
  check(Math.abs(p0.p.saldo - (p0.p.a.id === ceyro ? p0.xDebe - p0.yDebe : p0.yDebe - p0.xDebe)) < 0.01, "1. saldo único = la diferencia", p0.p.saldo);
  check(p0.p.a_debe_b.conceptos.length > 0 && p0.p.a_debe_b.conceptos.every((c) => c.concepto && c.monto > 0), "1. detalle por concepto", p0.p.a_debe_b.conceptos.map((c) => `${c.concepto} ${c.monto}`));

  // 2. Gasto de STALYN pagado por CEYRO: baja lo que CEYRO le debe a STALYN (antes solo se descontaban algunos tipos)
  const g = exigir(await api("POST", `/cash/${cajaC.id}/movements`, { movement: "EXPENSE", category: "ALIMENTACION", amount: 40, description: "SIM almuerzo de STALYN", por_cuenta_de: stalyn }, ceyro), "2. CEYRO paga un gasto de STALYN ($40)");
  check(g.gasto_por_socio?.descontado === 40 && g.gasto_por_socio?.por_cobrar === 0, "2. se descuenta todo de lo que CEYRO le debe a STALYN (no queda deuda nueva)", g.gasto_por_socio);
  const p1 = await par(ceyro, stalyn);
  check(Math.abs(p1.xDebe - (p0.xDebe - 40)) < 0.01 && Math.abs(p1.yDebe - p0.yDebe) < 0.01, "2. CEYRO le debe $40 menos; lo de STALYN no cambia", { antes: p0.xDebe, ahora: p1.xDebe });

  // 3. CEYRO paga una deuda de STALYN con un tercero (agricultor): baja esa deuda y lo que CEYRO le debe a STALYN
  const cxp = (await q(`SELECT ap.id, ap.balance::float b FROM accounts_payable ap WHERE ap.accionista_id=$1 AND ap.status IN ('CONFIRMED','PARTIAL') AND ap.balance > 60
      AND COALESCE(ap.reference_type,'') NOT IN ('fomento_cruce','retencion_matriz','saldo_inicial_socio','compra_producto_socio','cobro_por_socio','pago_por_socio','campo_servicio','pilado_service','lot_transfer','service_charge','packaging_charge')
      AND NOT EXISTS (SELECT 1 FROM pilado_services ps WHERE ps.payable_id=ap.id) AND NOT EXISTS (SELECT 1 FROM matriz_packaging_charges m WHERE m.payable_id=ap.id)
      AND NOT EXISTS (SELECT 1 FROM matriz_service_charges m WHERE m.payable_id=ap.id) AND NOT EXISTS (SELECT 1 FROM lot_transfers lt WHERE lt.payable_id=ap.id)
      ORDER BY ap.created_at LIMIT 1`, [stalyn]))[0];
  if (cxp) {
    const c0 = await saldoCaja(cajaC.id);
    const pg = exigir(await api("POST", "/cash/payables/pay-group", { payable_ids: [cxp.id], amount: 60, pagado_por: ceyro }, stalyn), "3. CEYRO paga $60 de una deuda de STALYN con un tercero");
    check(pg.pago_por_socio?.descontado === 60 && pg.pago_por_socio?.deuda_nueva === 0, "3. se descuenta de lo que CEYRO le debe a STALYN", pg.pago_por_socio);
    check(r2((await q("SELECT balance::float b FROM accounts_payable WHERE id=$1", [cxp.id]))[0].b) === r2(cxp.b - 60), "3. la deuda de STALYN con el tercero baja $60");
    check(Math.abs((await saldoCaja(cajaC.id)) - (c0 - 60)) < 0.01, "3. salen $60 de la caja de CEYRO");
  } else check(true, "3. (STALYN no tiene deudas con terceros en la copia)");

  // 4. STALYN le da $1,000 a CEYRO: baja lo que STALYN le debe a CEYRO; mueve las DOS cajas con un solo registro
  const pA = await par(ceyro, stalyn);
  const cS0 = await saldoCaja(cajaS.id), cC0 = await saldoCaja(cajaC.id);
  const d4 = exigir(await api("POST", "/entre-socios/dinero", { de_id: stalyn, para_id: ceyro, monto: 1000, nota: "SIM abono", medio_pago: "EFECTIVO" }, ceyro), "4. STALYN le da $1,000 a CEYRO (registrado desde CEYRO)");
  check(d4.descontado === 1000 && d4.prestamo === 0, "4. todo baja de lo que STALYN le debe a CEYRO", d4);
  check(Math.abs((await saldoCaja(cajaS.id)) - (cS0 - 1000)) < 0.01 && Math.abs((await saldoCaja(cajaC.id)) - (cC0 + 1000)) < 0.01, "4. sale de la caja de STALYN y entra a la de CEYRO (un solo registro)");
  const pB = await par(ceyro, stalyn);
  check(Math.abs(pB.yDebe - (pA.yDebe - 1000)) < 0.01 && Math.abs(pB.xDebe - pA.xDebe) < 0.01, "4. STALYN le debe $1,000 menos a CEYRO", { antes: pA.yDebe, ahora: pB.yDebe });

  // 5. CEYRO le da $300 a ROVINSON (ROVINSON ya le debía a CEYRO): todo queda como préstamo a ROVINSON
  const pR0 = await par(ceyro, rovinson);
  const d5 = exigir(await api("POST", "/entre-socios/dinero", { de_id: ceyro, para_id: rovinson, monto: 300, medio_pago: "EFECTIVO" }, ceyro), "5. CEYRO le da $300 a ROVINSON");
  check(d5.descontado === r2(Math.min(300, pR0.xDebe)) && d5.prestamo === r2(300 - Math.min(300, pR0.xDebe)), "5. baja lo que CEYRO le debía a ROVINSON y el resto es préstamo", { d5, ceyro_debia: pR0.xDebe });
  const pR1 = await par(ceyro, rovinson);
  check(Math.abs(pR1.yDebe - (pR0.yDebe + d5.prestamo)) < 0.01, "5. ROVINSON le debe a CEYRO lo de antes + el préstamo", { antes: pR0.yDebe, ahora: pR1.yDebe });

  // 6. ROVINSON le da $600 a CEYRO por BANCO (su caja es solo efectivo → pasa a mixta): baja lo que debe; sobra préstamo
  const d6 = exigir(await api("POST", "/entre-socios/dinero", { de_id: rovinson, para_id: ceyro, monto: 600, medio_pago: "BANCO" }, ceyro), "6. ROVINSON le da $600 a CEYRO por transferencia");
  check(d6.descontado === r2(Math.min(600, pR1.yDebe)) && d6.prestamo === r2(600 - Math.min(600, pR1.yDebe)), "6. baja lo que ROVINSON debía y el resto queda a su favor", d6);
  const movs6 = await q("SELECT cm.medio, cr.tipo FROM dinero_entre_socios d JOIN cash_movements cm ON cm.id IN (d.mov_de_id, d.mov_para_id) JOIN cash_registers cr ON cr.id = cm.cash_register_id WHERE d.id=$1", [d6.id]);
  check(movs6.length === 2 && movs6.every((m) => m.medio === "BANCO"), "6. las dos líneas van por el banco (la caja de ROVINSON pasa a mixta)", movs6);
  const pR2 = await par(ceyro, rovinson);
  check(Math.abs(pR2.xDebe - (pR1.xDebe + d6.prestamo)) < 0.01, "6. CEYRO le debe a ROVINSON lo que sobró", { ceyro_debe: pR2.xDebe });

  // 7. Integridad
  const h1 = await revisar(q);
  check(h1.length === 0, "7. control de integridad sin hallazgos", h1.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 200)));

  // 8. Anular desde Caja (en la caja de STALYN): se deshacen las dos líneas y lo descontado
  const movDe4 = (await q("SELECT mov_de_id FROM dinero_entre_socios WHERE id=$1", [d4.id]))[0].mov_de_id;
  exigir(await api("POST", `/cash/movements/${movDe4}/reverse`, { reason: "SIM anular dinero" }, stalyn), "8. anular el dinero de STALYN a CEYRO desde la caja de STALYN");
  const pC = await par(ceyro, stalyn);
  check(Math.abs(pC.yDebe - pA.yDebe) < 0.01, "8. STALYN vuelve a deber lo de antes", { antes: pA.yDebe, ahora: pC.yDebe });
  check(Math.abs((await saldoCaja(cajaS.id)) - cS0) < 0.01, "8. la caja de STALYN vuelve a su saldo");
  const an = (await q("SELECT anulado_at IS NOT NULL a FROM dinero_entre_socios WHERE id=$1", [d4.id]))[0].a;
  check(an, "8. queda anulado (y la línea de CEYRO también)");

  // 9. Anular desde el historial (préstamo sin abonos)
  exigir(await api("POST", `/entre-socios/dinero/${d6.id}/anular`, { motivo: "SIM anular" }, ceyro), "9. anular el dinero de ROVINSON desde Cuentas entre socios");
  const pR3 = await par(ceyro, rovinson);
  check(Math.abs(pR3.yDebe - pR1.yDebe) < 0.01 && Math.abs(pR3.xDebe - pR1.xDebe) < 0.01, "9. ROVINSON y CEYRO vuelven a como estaban antes del 6", { r: pR3.yDebe, c: pR3.xDebe });

  // 10. Historial y cruce con el botón
  const hist = exigir(await api("GET", `/entre-socios/historial?con=${stalyn}`, undefined, ceyro), "10. historial CEYRO–STALYN");
  check(hist.some((x) => x.tipo === "dinero") && hist.some((x) => x.tipo === "gasto"), "10. el historial muestra el dinero y el gasto", hist.map((x) => `${x.tipo} ${x.monto}`).slice(0, 6));
  const antesCruce = await par(ceyro, stalyn);
  const cr = exigir(await api("POST", "/receivable/cruce-socios", { contraparte_id: stalyn }, ceyro), "10. «Cruzar» CEYRO–STALYN");
  const desp = await par(ceyro, stalyn);
  check(Math.abs(cr.monto - Math.min(antesCruce.xDebe, antesCruce.yDebe)) < 0.01 && Math.abs(desp.p.saldo - antesCruce.p.saldo) < 0.01 && desp.p.cruzable < 0.01,
    "10. el cruce deja un solo saldo y no cambia el saldo único", { cruzado: cr.monto, saldo: desp.p.saldo });

  // 11. Un operador no puede anular
  const op = (await q("SELECT u.id, u.username, u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='OPERADOR' AND u.is_active LIMIT 1"))[0];
  const O = S.apiComo(op.id, op.username, op.name);
  check((await O("POST", `/entre-socios/dinero/${d5.id}/anular`, { motivo: "x prueba" })).status === 403, "11. un operador no puede anular");

  const h2 = await revisar(q);
  check(h2.length === 0, "12. integridad al final sin hallazgos", h2.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 200)));
} catch (err) { console.log("ERROR", err?.stack ?? err); check(false, "excepción"); } finally {
  const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0);
}
