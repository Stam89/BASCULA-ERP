// 📒 CAJA DEL DÍA (2026-11-23): cada renglón de la hoja guarda con su flujo, queda en su día, enlaza sus movimientos y se anula
// completo; el saldo es solo de la gaveta y el conteo no lo mueve. SOLO copia.
import { randomUUID } from "crypto";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 220) : JSON.stringify(r.data).slice(0, 320)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const diaEc = (atras = 0) => new Date(Date.now() - atras * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const HOY = diaEc(), AYER = diaEc(1), ANTES = diaEc(3);
try {
  const socios = await q("SELECT id, name FROM accionistas WHERE tipo='SOCIO' AND is_active ORDER BY name");
  const ROV = socios.find((s) => s.name === "ROVINSON") ?? socios[0], STA = socios.find((s) => s.name === "STALYN") ?? socios[1];
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja del día sim", tipo: "MIXTO", opening_balance_cash: 500, opening_balance_bank: 1000 }, matriz), "0. caja mixta de CEYRO (500 gaveta, 1000 banco)");
  // La caja se abrió hace 5 días (para probar días anteriores).
  await q("UPDATE cash_registers SET opened_at = now() - interval '5 days' WHERE id = $1", [caja.id]);
  const cabecera = (o) => ({ "x-caja-renglon": Buffer.from(JSON.stringify({ caja: caja.id, fecha: HOY, quien: "", detalle: "", datos: {}, sin_gaveta: "", ...o }), "utf8").toString("base64"), "x-confirmar": "SOBREGIRO,LIMITE_FOMENTO" });
  const dia = async (f = HOY) => exigir(await api("GET", `/cash/dia/${caja.id}?fecha=${f}`, undefined, matriz), `· leer ${f}`);

  // 1 · Gasto corriente de hoy
  const R1 = randomUUID();
  exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "ALIMENTACION", amount: 12.5, description: "COCINA · ALMUERZO" }, matriz,
    cabecera({ id: R1, bloque: "EGRESO", quien: "COCINA", detalle: "ALMUERZO", monto: 12.5, flujo: "comida" })), "1. gasto de hoy con su renglón");
  let d = await dia();
  let f1 = d.filas.find((f) => f.k === `r:${R1}`);
  check(f1 && f1.efecto === -12.5 && f1.bloque === "EGRESO" && f1.movimientos.length === 1, "2. la hoja lo muestra como se escribió", f1);
  check(d.anterior === 500 && d.totales.disponible === 487.5 && d.totales.descuadre === 0, "3. saldo anterior 500 y disponible 487.50 (solo gaveta)", d.totales);

  // 2 · Renglón de un día anterior: queda en ese día y hoy arranca con él
  const R2 = randomUUID();
  exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "ALIMENTACION", amount: 20, description: "AGUA" }, matriz,
    cabecera({ id: R2, fecha: ANTES, bloque: "EGRESO", detalle: "AGUA", monto: 20, flujo: "comida" })), "4. gasto escrito en la hoja de hace 3 días");
  const mv2 = await q("SELECT (created_at AT TIME ZONE 'America/Guayaquil')::date::text AS f FROM cash_movements WHERE renglon_id = $1", [R2]);
  check(mv2.length === 1 && mv2[0].f === ANTES, "5. el movimiento quedó con esa fecha", mv2);
  check((await dia(ANTES)).totales.disponible === 480 && (await dia()).anterior === 480, "6. aquel día cierra en 480 y hoy arranca con 480");
  const malo = await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "ALIMENTACION", amount: 5, description: "X" }, matriz,
    cabecera({ id: randomUUID(), fecha: diaEc(30), bloque: "EGRESO", detalle: "X", monto: 5, flujo: "comida" }));
  check(malo.status === 400 && (await q("SELECT 1 FROM cash_movements WHERE cash_register_id=$1 AND amount=5", [caja.id])).length === 0, "7. antes de abrir la caja no deja, y no guarda nada", mostrar(malo));

  // 3 · Fomento de ROVINSON entregado por la caja de CEYRO (cuenta aprobada en cero → activa)
  const fom = (await q(`INSERT INTO fomentos (farmer_name, cuadras, inicio, renta, status, accionista_id) VALUES ('AGRICULTOR SIM UNO', 5, CURRENT_DATE, 0.07, 'APROBADOS', $1) RETURNING id`, [ROV.id]))[0];
  const R3 = randomUUID();
  exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: AYER, valor: 60, concepto: "FANGUEADA", cash_register_id: caja.id }, matriz,
    cabecera({ id: R3, fecha: AYER, bloque: "EGRESO", quien: "AGRICULTOR SIM UNO", detalle: "FOMENTO", monto: 60, flujo: "fomento" })), "8. fomento de ROVINSON desde la hoja de ayer");
  const e3 = (await q("SELECT fecha::text AS f, valor::float AS v, id FROM fomento_entregas WHERE fomento_id=$1", [fom.id]))[0];
  const m3 = (await q("SELECT category, (created_at AT TIME ZONE 'America/Guayaquil')::date::text AS f FROM cash_movements WHERE renglon_id=$1", [R3]))[0];
  check(e3?.f === AYER && e3.v === 60 && m3?.f === AYER && m3.category === "GASTO_POR_SOCIO", "9. la entrega y la caja quedan en el mismo día", { e3, m3 });
  check((await q("SELECT status FROM fomentos WHERE id=$1", [fom.id]))[0].status === "ACTIVOS", "10. la cuenta aprobada pasó a activa");

  // 4 · Devolución de ese fomento en la caja de CEYRO
  const R4 = randomUUID();
  exigir(await api("POST", `/fomentos/${fom.id}/pagos`, { fecha: HOY, valor: 25, concepto: "DEVUELVE", cash_register_id: caja.id }, matriz,
    cabecera({ id: R4, bloque: "INGRESO", quien: "AGRICULTOR SIM UNO", detalle: "FOMENTO", monto: 25, flujo: "fomento_dev" })), "11. devolución de fomento de ROVINSON en la caja de CEYRO");
  const m4 = (await q("SELECT id, category FROM cash_movements WHERE renglon_id=$1", [R4]))[0];
  const esp4 = await q("SELECT 'cxc' t, accionista_id, balance::float b FROM accounts_receivable WHERE reference_type='cobro_por_socio' AND reference_id=$1 UNION ALL SELECT 'cxp', accionista_id, balance::float FROM accounts_payable WHERE reference_type='cobro_por_socio' AND reference_id=$1", [m4.id]);
  check(m4.category === "COBRO_POR_SOCIO" && esp4.length === 2 && esp4.every((x) => x.b === 25), "12. CEYRO le queda debiendo $25 a ROVINSON", esp4);
  exigir(await api("POST", `/cash/dia/renglones/${R4}/anular`, { motivo: "prueba de anular" }, matriz), "13. anular el renglón de la devolución");
  check((await q("SELECT 1 FROM fomento_pagos WHERE fomento_id=$1", [fom.id])).length === 0 && (await q("SELECT 1 FROM accounts_payable WHERE reference_type='cobro_por_socio' AND reference_id=$1 AND status<>'CANCELLED'", [m4.id])).length === 0, "14. se quitó de la cuenta del agricultor y la deuda entre los dos");
  exigir(await api("POST", `/cash/dia/renglones/${R3}/anular`, { motivo: "prueba de anular" }, matriz), "15. anular el renglón del fomento (de ayer)");
  check((await q("SELECT 1 FROM fomento_entregas WHERE fomento_id=$1", [fom.id])).length === 0, "16. la entrega salió del fomento");
  const dAyer = await dia(AYER);
  check(!dAyer.filas.some((f) => f.k === `r:${R3}`) && dAyer.anulados.some((f) => f.k === `r:${R3}`) && dAyer.totales.disponible === 480, "17. la hoja de ayer queda como si no se hubiera escrito", dAyer.totales);
  check((await dia()).anterior === 480, "18. y la de hoy no cambia");

  // 5 · Cobro de una cuenta de STALYN recibido por CEYRO, en el día de la hoja
  const cli = (await q("INSERT INTO customers (full_name) VALUES ('CLIENTE SIM UNO') RETURNING id"))[0];
  const cxc = (await q("INSERT INTO accounts_receivable (customer_id, accionista_id, reference_type, description, amount, balance, status) VALUES ($1,$2,'saldo_inicial','prueba',80,80,'CONFIRMED') RETURNING id", [cli.id, STA.id]))[0];
  const ctx = exigir(await api("GET", `/cash/dia/${caja.id}/contexto?fecha=${HOY}`, undefined, matriz), "19. contexto de la hoja");
  const per = ctx.cobros.find((p) => p.nombre === "CLIENTE SIM UNO");
  check(per && per.socio === STA.name && per.saldo === 80 && per.cuentas[0].id === cxc.id, "20. ve lo que le deben a los socios", per);
  check(ctx.fomentos.some((f) => f.id === fom.id) && ctx.maquinas.some((m) => m.section === "TURBINA POLVILLERA") && Array.isArray(ctx.nomina) && ctx.transporte.length > 0, "21. ve fomentos, máquinas, nómina y Transporte");
  const R5 = randomUUID();
  exigir(await api("POST", "/receivable/pay-group", { receivable_ids: [cxc.id], amount: 80, recibido_por: matriz, medio_pago: "EFECTIVO", concepto: "PAGA" }, STA.id,
    cabecera({ id: R5, fecha: AYER, bloque: "INGRESO", quien: "CLIENTE SIM UNO", detalle: "PAGO DE CUENTA", monto: 80, flujo: "cobro" })), "22. cobro de la cuenta de STALYN (lo recibe CEYRO, hoja de ayer)");
  const m5 = (await q("SELECT cash_register_id, category, (created_at AT TIME ZONE 'America/Guayaquil')::date::text AS f FROM cash_movements WHERE renglon_id=$1", [R5]))[0];
  check(m5?.cash_register_id === caja.id && m5.f === AYER && m5.category === "COBRO_POR_SOCIO", "23. entró a la gaveta de CEYRO ayer", m5);

  // 6 · Arroz de STALYN pagado por CEYRO: paga lo que se le debe y el resto queda de anticipo de STALYN
  const agr = (await q("INSERT INTO farmers (full_name) VALUES ('AGRICULTOR SIM DOS') RETURNING id"))[0];
  const cxp = (await q("INSERT INTO accounts_payable (farmer_id, accionista_id, reference_type, description, amount, balance, status) VALUES ($1,$2,'saldo_inicial','arroz sim',30,30,'CONFIRMED') RETURNING id", [agr.id, STA.id]))[0];
  const R6 = randomUUID();
  exigir(await api("POST", "/advances", { farmer_id: agr.id, amount: 50, concept: "ABONO ARROZ", cash_register_id: caja.id, apply_to_payables: true, por_cuenta_de: STA.id }, matriz,
    cabecera({ id: R6, bloque: "EGRESO", quien: "AGRICULTOR SIM DOS", detalle: "ARROZ", monto: 50, flujo: "agricultor" })), "24. abono de arroz por cuenta de STALYN");
  const est6 = { cxp: (await q("SELECT balance::float b FROM accounts_payable WHERE id=$1", [cxp.id]))[0].b, adv: (await q("SELECT balance::float b, accionista_id FROM farmer_advances WHERE farmer_id=$1", [agr.id]))[0], mov: (await q("SELECT category, por_cuenta_de FROM cash_movements WHERE renglon_id=$1", [R6]))[0] };
  check(est6.cxp === 0 && est6.adv.b === 20 && est6.adv.accionista_id === STA.id && est6.mov.category === "GASTO_POR_SOCIO" && est6.mov.por_cuenta_de === STA.id, "25. pagó los 30 y dejó 20 de anticipo de STALYN", est6);
  exigir(await api("POST", `/cash/dia/renglones/${R6}/anular`, { motivo: "prueba de anular" }, matriz), "26. anular el renglón del arroz");
  check((await q("SELECT balance::float b FROM accounts_payable WHERE id=$1", [cxp.id]))[0].b === 30 && (await q("SELECT status FROM farmer_advances WHERE farmer_id=$1", [agr.id]))[0].status === "CANCELLED", "27. vuelve a deberse y el anticipo se cancela");

  // 7 · Trabajo en una máquina, con el día en que se hizo
  const maq = ctx.maquinas.find((m) => m.section === "TURBINA POLVILLERA");
  const R7 = randomUUID();
  exigir(await api("POST", "/equipment/planta/gasto", { cash_register_id: caja.id, maquina_id: maq.id, clase: "REPARACION", monto: 40, description: "ARREGLO DEL VENTILADOR", fecha_trabajo: ANTES }, matriz,
    cabecera({ id: R7, bloque: "EGRESO", quien: "TURBINA POLVILLERA", detalle: "ARREGLO DEL VENTILADOR", monto: 40, flujo: "maquina", datos: { fecha_trabajo: ANTES } })), "28. reparación pagada hoy, hecha hace 3 días");
  const hv = (await q("SELECT em.fecha_trabajo::text f, em.section FROM equipment_maintenance em JOIN cash_movements m ON m.reference_id = em.id WHERE m.renglon_id=$1", [R7]))[0];
  check(hv?.f === ANTES && hv.section === "TURBINA POLVILLERA", "29. la hoja de vida guarda el día en que se hizo", hv);
  exigir(await api("PATCH", `/cash/dia/renglones/${R7}`, { fecha_trabajo: AYER }, matriz), "30. se corrige el día del trabajo");
  check((await q("SELECT em.fecha_trabajo::text f FROM equipment_maintenance em JOIN cash_movements m ON m.reference_id = em.id WHERE m.renglon_id=$1", [R7]))[0].f === AYER, "31. quedó corregido en la hoja de vida");

  // 8 · Banco → gaveta
  const R8 = randomUUID();
  exigir(await api("POST", `/cash/registers/${caja.id}/traspaso`, { direccion: "RETIRO", monto: 200, descripcion: "RST" }, matriz,
    cabecera({ id: R8, bloque: "INGRESO", quien: "BANCO", detalle: "RST", monto: 200, flujo: "banco" })), "32. retiro del banco a la gaveta");
  d = await dia();
  const f8 = d.filas.find((f) => f.k === `r:${R8}`);
  check(f8 && f8.efecto === 200 && d.totales.descuadre === 0, "33. entra a la gaveta y no es venta", { f8, t: d.totales });

  // 9 · Venta al detalle de ayer, por asignar; al asignarla queda con su día
  const bod = (await q("SELECT warehouse_id, product_id FROM inventory_movements WHERE warehouse_id IS NOT NULL GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 1"))[0];
  const prod = (await q("SELECT name FROM products WHERE id=$1", [bod.product_id]))[0].name;
  const R9 = randomUUID();
  const v9 = exigir(await api("POST", "/sales/retail", { cash_register_id: caja.id, product_id: bod.product_id, warehouse_id: bod.warehouse_id, quantity_qq: 0.25, total_amount: 5, price_per_pound: 0.2, mode: "LIBRA", input_amount: 25, medio: "EFECTIVO", product_name: prod, buyer: { full_name: "CONSUMIDOR FINAL" }, por_asignar: true }, matriz,
    cabecera({ id: R9, fecha: AYER, bloque: "INGRESO", detalle: "0,25 LB DE 3/4", monto: 5, flujo: "venta" })), "34. venta de 25 lb en la hoja de ayer");
  const pa = (await q("SELECT (created_at AT TIME ZONE 'America/Guayaquil')::date::text f FROM ventas_detalle_por_asignar WHERE id=$1", [v9.id]))[0];
  check(pa.f === AYER, "35. la venta por asignar quedó ayer", pa);
  exigir(await api("POST", "/sales/retail/por-asignar/asignar", { ids: [v9.id], dueno_id: ROV.id }, matriz), "36. se asigna hoy a ROVINSON");
  const sv = (await q("SELECT (s.created_at AT TIME ZONE 'America/Guayaquil')::date::text f, (SELECT (i.created_at AT TIME ZONE 'America/Guayaquil')::date::text FROM inventory_movements i WHERE i.reference_type='sales' AND i.reference_id=s.id LIMIT 1) AS inv FROM sales s JOIN ventas_detalle_por_asignar v ON v.sale_id=s.id WHERE v.id=$1", [v9.id]))[0];
  check(sv?.f === AYER && sv.inv === AYER, "37. la venta y su salida de inventario son de ayer, no de hoy", sv);

  // 10 · Fiado por asignar (no mueve la gaveta) y su anulación
  const R10 = randomUUID();
  exigir(await api("POST", "/sales/retail", { cash_register_id: caja.id, product_id: bod.product_id, warehouse_id: bod.warehouse_id, quantity_qq: 1, total_amount: 20, price_per_pound: 0.2, mode: "QQ", input_amount: 1, medio: "EFECTIVO", product_name: prod, buyer: { full_name: "CLIENTE SIM FIADO" }, por_asignar: true, pagado: 0 }, matriz,
    cabecera({ id: R10, bloque: "INGRESO", quien: "CLIENTE SIM FIADO", detalle: "1 QQ", monto: 20, flujo: "venta", sin_gaveta: "cuenta" })), "38. venta fiada desde la hoja");
  d = await dia();
  const f10 = d.filas.find((f) => f.k === `r:${R10}`);
  check(f10 && f10.efecto === 0 && f10.sin_gaveta === "cuenta", "39. se ve en la hoja sin mover la gaveta", f10);
  exigir(await api("POST", `/cash/dia/renglones/${R10}/anular`, { motivo: "prueba de anular" }, matriz), "40. anular el fiado");
  check((await q("SELECT 1 FROM ventas_detalle_por_asignar WHERE customer_name='CLIENTE SIM FIADO' AND anulado_at IS NULL")).length === 0, "41. la venta fiada quedó anulada");

  // 11 · A crédito y lo pagó un socio (no mueven la gaveta)
  const R11 = randomUUID();
  exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "GASTO_OPERATIVO", amount: 33, description: "CINTAS", modalidad_pago: "CREDITO", proveedor_nombre: "FERRETERIA SIM" }, matriz,
    cabecera({ id: R11, bloque: "EGRESO", quien: "FERRETERIA SIM", detalle: "CINTAS", monto: 33, flujo: "otro", sin_gaveta: "credito" })), "42. gasto a crédito");
  const R12 = randomUUID();
  exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "GASTO_OPERATIVO", amount: 18, description: "FOCOS", pagado_por: ROV.id }, matriz,
    cabecera({ id: R12, fecha: AYER, bloque: "EGRESO", detalle: "FOCOS", monto: 18, flujo: "otro", sin_gaveta: "socio" })), "43. gasto que pagó ROVINSON, en la hoja de ayer");
  d = await dia(); const dA = await dia(AYER);
  const f11 = d.filas.find((f) => f.k === `r:${R11}`), f12 = dA.filas.find((f) => f.k === `r:${R12}`);
  check(f11?.efecto === 0 && f12?.efecto === 0 && dA.filas.filter((f) => f.monto === 18).length === 1 && d.totales.descuadre === 0 && dA.totales.descuadre === 0, "44. se ven una sola vez y la gaveta no cambia", { f11: f11?.efecto, f12: f12?.efecto, dA: dA.totales });
  exigir(await api("POST", `/cash/dia/renglones/${R11}/anular`, { motivo: "prueba de anular" }, matriz), "45. anular el gasto a crédito");
  check((await q("SELECT status FROM accounts_payable WHERE description LIKE '%CINTAS%' ORDER BY created_at DESC LIMIT 1"))[0]?.status === "CANCELLED", "46. su cuenta por pagar quedó anulada");
  exigir(await api("POST", `/cash/dia/renglones/${R12}/anular`, { motivo: "prueba de anular" }, matriz), "47. anular el gasto que pagó el socio");

  // 12 · Transporte con hoja de vida y su día
  const act = ctx.transporte[0];
  const R13 = randomUUID();
  exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: caja.id, activo_id: act.id, description: "CAMBIO DE BANDA", mano_obra: 35, fecha: AYER, fecha_trabajo: ANTES }, matriz,
    cabecera({ id: R13, fecha: AYER, bloque: "TRANSPORTE", quien: "", detalle: `${act.nombre} CAMBIO DE BANDA`, monto: 35, flujo: "transporte" })), "48. arreglo de una máquina de Transporte, hoja de ayer");
  const tr = (await q("SELECT mt.fecha::text f, m.cash_register_id, (m.created_at AT TIME ZONE 'America/Guayaquil')::date::text c FROM cash_movements m JOIN campo_mantenimientos mt ON mt.cxp_id = m.reference_id WHERE m.renglon_id=$1", [R13]))[0];
  check(tr?.f === ANTES && tr.c === AYER, "49. la plata salió ayer y el trabajo es de hace 3 días", tr);
  const dT = await dia(AYER);
  check(dT.filas.find((f) => f.k === `r:${R13}`)?.bloque === "TRANSPORTE" && dT.totales.transporte === 35, "50. está en el bloque de Transporte", dT.totales);

  // 13 · Por reportar
  const R14 = randomUUID();
  exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "GASTO_OPERATIVO", amount: 77, description: "RULIMAN" }, matriz,
    cabecera({ id: R14, fecha: AYER, bloque: "EGRESO", quien: "", detalle: "RULIMAN", monto: 77, flujo: "otro", reportar: "HUGO SIM" })), "51. «por reportar Hugo», hoja de ayer");
  check((await dia()).por_reportar.some((x) => x.id === R14 && x.reportar === "HUGO SIM"), "52. hoy sigue saliendo como pendiente de reportar");
  exigir(await api("POST", `/cash/dia/renglones/${R14}/reportado`, { nota: "trajo factura" }, matriz), "53. ya reportó");
  check(!(await dia()).por_reportar.some((x) => x.id === R14), "54. ya no sale como pendiente");

  // 14 · Conteo de la gaveta: se anota, no mueve el saldo
  d = await dia();
  const c14 = exigir(await api("PUT", `/cash/dia/${caja.id}/conteo`, { fecha: HOY, lineas: ["13*20", "5*10", "3*0,25"], apartado: "10" }, matriz), "55. conteo «13*20»");
  check(c14.contado === 300.75 && r2(c14.diferencia) === r2(300.75 - d.totales.disponible), "56. suma y muestra la diferencia", c14);
  check((await dia()).totales.disponible === d.totales.disponible && (await q("SELECT 1 FROM cash_movements WHERE cash_register_id=$1 AND category IN ('SOBRANTE_CAJA','FALTANTE_CAJA')", [caja.id])).length === 0, "57. no mueve el saldo ni crea sobrante");

  // 15 · Apodos
  exigir(await api("POST", "/cash/dia/apodos", { tipo: "fomento", apodo: "Agric. Uno", nombre: "AGRICULTOR SIM UNO" }, matriz), "58. aprende un apodo");
  check((await q("SELECT nombre FROM caja_apodos WHERE tipo='fomento' AND apodo='agric uno'"))[0]?.nombre === "AGRICULTOR SIM UNO", "59. quedó guardado");

  // 16 · Seguridad: un operador sin acceso a esa caja no puede usarla por la cabecera
  const oper = await S.operador("sin_caja", ["EDIT:Caja"], STA.id);
  const ajeno = await oper("POST", "/customers", { full_name: "NO DEBE" });
  void ajeno;
  const espia = await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "ALIMENTACION", amount: 4, description: "X" }, matriz, { "x-caja-renglon": "no-es-json" });
  check(espia.status === 400 && (await q("SELECT 1 FROM cash_movements WHERE cash_register_id=$1 AND amount=4", [caja.id])).length === 0, "60. una cabecera dañada no guarda nada", mostrar(espia));

  // 17 · Todo cuadra: la suma de las hojas = la gaveta
  const saldoBd = (await q("SELECT (500 + COALESCE(sum(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0))::float s FROM cash_movements WHERE cash_register_id=$1 AND medio='EFECTIVO'", [caja.id]))[0].s;
  d = await dia();
  check(r2(saldoBd) === d.totales.disponible && d.totales.descuadre === 0, "61. el disponible de hoy = la gaveta en la base", { saldoBd, t: d.totales });
  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
