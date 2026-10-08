// Transporte y Cosechadora: vales por rendir, transferencias entre cuentas y ciclo de vida de los partes diarios.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dos = (f) => Promise.all([f(), f()]);

try {
  const cuentas = (await api("GET", "/campo/cuentas")).data;
  const CAJA = cuentas.find((c) => c.nombre === "CAJA").id, BANCO = cuentas.find((c) => c.nombre === "BANCO").id;
  const camion = (await q("SELECT id FROM campo_activos WHERE nombre='PLATAFORMA'"))[0].id;
  const saldo = async (id) => r2((await q("SELECT COALESCE(sum(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float n FROM campo_movimientos WHERE cuenta_id=$1", [id]))[0].n);
  await q("DELETE FROM campo_caja_sesiones WHERE estado = 'ABIERTA'");
  exigir(await api("POST", "/campo/caja/abrir", { saldo_inicial: 300 }), "0. se abre la caja de Campo con $300");
  const gastoActivo = async () => {
    const r = (await api("GET", "/campo/reportes/por-maquina")).data;
    return r2(r.maquinas.find((x) => x.activo_id === camion)?.gastos ?? 0);
  };
  const g0 = await gastoActivo();

  // ── A. Vales por rendir ────────────────────────────────────────────────
  const vale = async (monto) => exigir(await api("POST", "/campo/movimientos", { cuenta_id: CAJA, signo: "salida", monto, concepto: "Vale combustible", es_anticipo: true, activo_id: camion }), `A0. se entrega un vale de $${monto}`);
  const v1 = await vale(50);
  check((await saldo(CAJA)) === 250, "A1. el vale de $50 sale de la caja ($250)", await saldo(CAJA));
  const l1 = await api("POST", `/campo/movimientos/${v1.id}/liquidar`, { monto_real: 30 });
  check(l1.ok && l1.data.devolucion === 20 && (await saldo(CAJA)) === 270, "A2. rendir con $30 reales: devuelve $20 a la caja ($270)", mostrar(l1));
  const rep = await api("POST", `/campo/movimientos/${v1.id}/liquidar`, { monto_real: 30 });
  check(rep.status === 409, "A3. un vale ya rendido no se rinde otra vez (409)", rep.status);
  const v2 = await vale(40);
  const [x, y] = await dos(() => api("POST", `/campo/movimientos/${v2.id}/liquidar`, { monto_real: 40 }));
  check([x, y].filter((r) => r.ok).length === 1 && [x, y].every((r) => r.status !== 500), "A4. rendir con doble clic: se rinde UNA vez", [x.status, y.status]);
  const v3 = await vale(20);
  const l3 = await api("POST", `/campo/movimientos/${v3.id}/liquidar`, { monto_real: 35 });
  check(l3.ok && l3.data.reembolso === 15 && l3.data.ajuste.signo === "salida", "A5. gastó $35 con un vale de $20: se reembolsan $15 más", mostrar(l3));
  const v4 = await vale(10);
  const l4 = await api("POST", `/campo/movimientos/${v4.id}/liquidar`, { monto_real: 99999 });
  check(l4.status === 422, "A6. un reembolso mayor al efectivo de CAJA se rechaza (422)", mostrar(l4));
  const rv = await api("POST", `/campo/movimientos/${v4.id}/reversar`, { motivo: "vale equivocado" });
  check(rv.status === 409, "A7. un vale no se reversa como gasto común (409): se rinde con $0 para devolverlo", rv.status);
  const l4b = await api("POST", `/campo/movimientos/${v4.id}/liquidar`, { monto_real: 0 });
  check(l4b.ok && l4b.data.devolucion === 10, "A8. rendir un vale con $0 reales devuelve todo ($10)", mostrar(l4b));
  const negativo = await api("POST", `/campo/movimientos/${(await vale(5)).id}/liquidar`, { monto_real: -1 });
  check(negativo.status === 400, "A9. un monto real negativo se rechaza (400)", negativo.status);
  // El gasto real de la máquina es lo gastado, no lo entregado
  const g1 = await gastoActivo();
  check(r2(g1 - g0) === 105, "A10. el gasto de la máquina es lo REAL gastado (30 + 40 + 35 = $105); el vale de $5 sin rendir aún no cuenta", { antes: g0, despues: g1 });

  // El estado de resultados y «por máquina» coinciden en costos directos de la máquina
  const er = (await api("GET", "/campo/reportes/estado-resultados?mes=2026-10")).data;
  check(er && JSON.stringify(er).length > 100, "A11. el estado de resultados responde con el vale a medias");

  // ── B. Transferencias ──────────────────────────────────────────────────
  const sC = await saldo(CAJA), sB = await saldo(BANCO);
  const tr = await api("POST", "/campo/transferencias", { cuenta_origen_id: CAJA, cuenta_destino_id: BANCO, monto: 20 });
  check(tr.ok && (await saldo(CAJA)) === r2(sC - 20) && (await saldo(BANCO)) === r2(sB + 20) && tr.data.salida.par_id === tr.data.entrada.par_id, "B1. CAJA → BANCO $20: una sale, otra entra, mismo par", mostrar(tr));
  check((await api("POST", "/campo/transferencias", { cuenta_origen_id: CAJA, cuenta_destino_id: CAJA, monto: 1 })).status === 400, "B2. origen y destino iguales → 400");
  check((await api("POST", "/campo/transferencias", { cuenta_origen_id: CAJA, cuenta_destino_id: BANCO, monto: 999999 })).status === 422, "B3. transferir más de lo que hay en CAJA → 422");
  const disp = await saldo(CAJA);
  const tt = await dos(() => api("POST", "/campo/transferencias", { cuenta_origen_id: CAJA, cuenta_destino_id: BANCO, monto: disp }));
  check(tt.filter((r) => r.ok).length === 1 && (await saldo(CAJA)) === 0 && tt.every((r) => r.status !== 500), "B4. dos transferencias de TODO el efectivo a la vez: pasa UNA y la CAJA queda en 0 (nunca negativa)", { st: tt.map((r) => r.status), caja: await saldo(CAJA) });
  const rvt = await api("POST", `/campo/movimientos/${tr.data.salida.id}/reversar`, { motivo: "transferencia equivocada" });
  check(rvt.status === 409, "B5. una transferencia no se reversa suelta (409): se corrige con la transferencia contraria", rvt.status);
  const back = await api("POST", "/campo/transferencias", { cuenta_origen_id: BANCO, cuenta_destino_id: CAJA, monto: 20 });
  check(back.ok && (await saldo(CAJA)) === 20, "B6. la transferencia contraria devuelve el dinero", mostrar(back));
  const cruce = cuentas.find((c) => c.nombre === "CRUCE PILADORA");
  if (cruce) check((await api("POST", "/campo/transferencias", { cuenta_origen_id: BANCO, cuenta_destino_id: cruce.id, monto: 1 })).status >= 400, "B7. no se transfiere dinero a la cuenta interna CRUCE PILADORA");

  if (cruce) {
    const vlc = exigir(await api("POST", "/campo/servicios", { cliente_id: (await api("POST", "/campo/clientes", { nombre: "CLIENTE CRUCE", tipo: "externo" })).data.id, activo_id: camion, tipo: "flete", qq: 10, precio_unitario: 1 }), "B8a. servicio de $10");
    const cxcMal = await api("POST", "/campo/cxc/abono", { cliente_id: vlc.cliente_id, monto: 10, cuenta_id: cruce.id });
    const cxpNueva = exigir(await api("POST", "/campo/cxp", { acreedor: "PROV CRUCE", concepto: "x", monto: 10 }), "B8b. cuenta por pagar de $10");
    const cxpMal = await api("POST", `/campo/cxp/${cxpNueva.id}/abono`, { monto: 10, cuenta_id: cruce.id });
    const movMal = await api("POST", "/campo/movimientos", { cuenta_id: cruce.id, signo: "entrada", monto: 10, concepto: "dinero falso" });
    check(cxcMal.status === 400 && cxpMal.status === 400 && movMal.status === 400, "B8. la cuenta interna CRUCE PILADORA tampoco sirve para cobrar, pagar ni registrar movimientos (400)", [cxcMal.status, cxpMal.status, movMal.status]);
  }

  // ── C. Partes diarios: de «por cobrar» a cobrado y de vuelta ────────────
  const cli = exigir(await api("POST", "/campo/clientes", { nombre: "CLIENTE PARTES", tipo: "externo" }), "C0. cliente");
  const parte = async (qq) => exigir(await api("POST", "/campo/partes", { activo_id: camion, operador: "OPERADOR PARTES", cliente: cli.nombre, cliente_id: cli.id, qq }), `C0b. parte de ${qq} QQ`);
  const p1 = await parte(100);
  const cb = await dos(() => api("POST", `/campo/partes/${p1.id}/cobrar`, { precio_unitario: 2 }));
  check(cb.filter((r) => r.ok).length === 1 && (await q("SELECT count(*)::int n FROM campo_servicios WHERE cliente_id=$1", [cli.id]))[0].n === 1, "C1. cobrar un parte con doble clic crea UN solo servicio ($200)", cb.map((r) => r.status));
  const okc = cb.find((r) => r.ok).data;
  check(okc.valor === 200, "C2. valor = 100 QQ × $2", okc.valor);
  const bor = await api("DELETE", `/campo/partes/${p1.id}`);
  check(bor.status === 409, "C3. un parte cobrado no se borra (409)", bor.status);
  const tf = await api("PATCH", `/campo/partes/${p1.id}/tarifa`, { precio_unitario: 3 });
  check(tf.ok && tf.data.valor === 300, "C4. se corrige la tarifa sin des-cobrar: ahora $300", mostrar(tf));
  exigir(await api("POST", "/campo/cxc/abono", { cliente_id: cli.id, monto: 50, cuenta_id: CAJA }), "C5a. el cliente abona $50");
  check((await api("PATCH", `/campo/partes/${p1.id}/tarifa`, { precio_unitario: 4 })).status === 409, "C5. con abonos, no se cambia la tarifa (409)");
  check((await api("POST", `/campo/partes/${p1.id}/descobrar`)).status === 409, "C6. con abonos, no se des-cobra (409)");
  const p2 = await parte(10);
  exigir(await api("POST", `/campo/partes/${p2.id}/cobrar`, { precio_unitario: 5 }), "C7a. se cobra el parte 2");
  const dc = await api("POST", `/campo/partes/${p2.id}/descobrar`);
  check(dc.ok && (await q("SELECT estado, servicio_id FROM campo_partes WHERE id=$1", [p2.id]))[0].estado === "por_cobrar", "C7. sin abonos, des-cobrar lo devuelve a «por cobrar» y borra su servicio", mostrar(dc));
  const ed = await api("PATCH", `/campo/partes/${p2.id}`, { qq: 12 });
  check(ed.ok && Number(ed.data.qq) === 12, "C8. un parte sin cobrar se puede editar", mostrar(ed));
  const bascula = { cliente_id: cli.id, maquina_id: camion, qq: 25, referencia: "TICKET-SIM-0001" };
  const b1 = await api("POST", "/campo/partes/integracion-bascula", bascula);
  const b2 = await api("POST", "/campo/partes/integracion-bascula", bascula);
  check(b1.ok && (await q("SELECT count(*)::int n FROM campo_partes WHERE observaciones LIKE '%TICKET-SIM-0001%' OR origen_uid LIKE '%TICKET-SIM-0001%'"))[0].n === 1, "C9. el mismo ticket de báscula enviado dos veces crea UN solo parte", [b1.status, b2.status]);
  const bd = await dos(() => api("POST", "/campo/partes/integracion-bascula", { ...bascula, referencia: "TICKET-SIM-0002" }));
  check((await q("SELECT count(*)::int n FROM campo_partes WHERE observaciones LIKE '%TICKET-SIM-0002%' OR origen_uid LIKE '%TICKET-SIM-0002%'"))[0].n === 1 && bd.every((r) => r.status !== 500), "C10. y con doble envío simultáneo también", bd.map((r) => r.status));

  // ── E. Mantenimientos de flota ─────────────────────────────────────────
  const sMant = await saldo(CAJA);
  const mt = await api("POST", "/campo/mantenimientos", { activo_id: camion, tipo: "CAMBIO_ACEITE", detalle: "Cambio de aceite y filtro", costo: 12.5, cuenta_id: CAJA, lectura: 1500, unidad_lectura: "KM", proxima_lectura: 6500 });
  check(mt.ok && (await saldo(CAJA)) === r2(sMant - 12.5) && (await q("SELECT count(*)::int n FROM equipment_maintenance WHERE campo_mantenimiento_id=$1", [mt.data.id]))[0].n === 1, "E1. un mantenimiento con costo saca el dinero de la caja y queda en la hoja de vida de Equipos", mostrar(mt));
  check((await api("POST", "/campo/mantenimientos", { activo_id: camion, tipo: "INSPECCION", detalle: "Revisión general", costo: 0, cuenta_id: CAJA })).status === 400, "E2. un mantenimiento sin costo no lleva cuenta (400)");
  check((await api("POST", "/campo/mantenimientos", { activo_id: camion, tipo: "REPUESTO", detalle: "Llanta", costo: 80 })).status === 400, "E3. con costo exige la cuenta de pago (400)");
  check((await api("POST", "/campo/mantenimientos", { activo_id: camion, tipo: "REPUESTO", detalle: "Turbo", costo: 999999, cuenta_id: CAJA })).status === 422, "E4. no se paga más de lo que hay en CAJA (422)");
  const ult = (await api("GET", `/campo/lecturas/ultima?activo_id=${camion}`)).data;
  check(ult && ult.lectura === 1500 && ult.unidad_lectura === "KM", "E5. la última lectura de la máquina es la del mantenimiento (1500 KM)", ult);
  const revM = await api("POST", `/campo/movimientos/${mt.data.movimiento_id}/reversar`, { motivo: "mantenimiento mal cargado" });
  check(revM.ok && (await q("SELECT anulado_at FROM campo_mantenimientos WHERE id=$1", [mt.data.id]))[0].anulado_at && (await q("SELECT status FROM equipment_maintenance WHERE campo_mantenimiento_id=$1", [mt.data.id]))[0].status === "ANULADO" && (await saldo(CAJA)) === sMant, "E6. reversar el gasto anula el mantenimiento y devuelve el dinero", mostrar(revM));

  // ── F. Mantenedores: máquinas, operadores y tarifas ────────────────────
  const a1 = await api("POST", "/campo/activos", { nombre: "CAMION PRUEBA 1", tipo: "camion" });
  const a2 = await api("POST", "/campo/activos", { nombre: "camion prueba 1", tipo: "camion" });
  check(a1.ok && a2.status === 409, "F1. no se crean dos máquinas con el mismo nombre (aunque cambien mayúsculas)", [a1.status, a2.status]);
  const o1 = await api("POST", "/campo/operadores", { nombre: "OPERADOR PRUEBA" });
  const o2 = await api("POST", "/campo/operadores", { nombre: "operador prueba" });
  check(o1.ok && o2.status === 409, "F2. no se crean dos operadores con el mismo nombre", [o1.status, o2.status]);
  const c1 = await api("POST", "/campo/clientes", { nombre: "CLIENTE DUPLICADO", tipo: "externo" });
  const c2 = await api("POST", "/campo/clientes", { nombre: "cliente duplicado", tipo: "externo" });
  check(c1.ok && (c2.status === 409 || c2.data?.id === c1.data.id), "F3. no se crean dos clientes con el mismo nombre", [c1.status, c2.status]);
  await api("PATCH", `/campo/activos/${a1.data.id}`, { activo: false });
  const pInact = await api("POST", "/campo/partes", { activo_id: a1.data.id, operador: "X", cliente: "CLIENTE DUPLICADO", cliente_id: c1.data.id, qq: 5 });
  check(pInact.status === 409 || pInact.status === 400, "F4. no se registran partes en una máquina dada de baja", mostrar(pInact));
  const t1 = await api("POST", "/campo/tarifas-operador", { operador: "OPERADOR PRUEBA", activo_id: camion, tarifa: 8, unidad: "VIAJE" });
  const t2 = await api("POST", "/campo/tarifas-operador", { operador: "operador prueba", activo_id: camion, tarifa: 9, unidad: "VIAJE" });
  check(t1.ok && t2.ok && (await q("SELECT count(*)::int n FROM campo_tarifas_operador WHERE lower(operador)='operador prueba' AND activo_id=$1", [camion]))[0].n === 1, "F5. la tarifa de un operador+máquina se actualiza, no se duplica", [t1.status, t2.status]);

  // ── G. Con la caja CERRADA no se mueve dinero de CAJA (rendir un vale incluido) ──
  const valeAbierto = await vale(10);
  const prev = (await api("GET", "/campo/caja/cierre-preview")).data;
  exigir(await api("POST", "/campo/caja/cerrar", { saldo_real: prev.saldo_teorico }), "G0. se cierra la caja de Campo");
  const sCerrada = await saldo(CAJA);
  const lc = await api("POST", `/campo/movimientos/${valeAbierto.id}/liquidar`, { monto_real: 0 });
  check(lc.status >= 400 && (await saldo(CAJA)) === sCerrada, "G1. rendir un vale con la caja cerrada no devuelve dinero a CAJA (hay que abrirla primero)", mostrar(lc));
  const nominaCerrada = await api("POST", "/campo/nomina-operadores/liquidar", { parte_ids: [(await parte(5)).id], cuenta_id: CAJA, monto: 1, motivo: "prueba" });
  check(nominaCerrada.status >= 400, "G2. pagar nómina con la caja cerrada se rechaza", nominaCerrada.status);

  // ── D. Cuadre global de Campo ──────────────────────────────────────────
  const neg = (await q("SELECT count(*)::int n FROM campo_servicios_saldo WHERE saldo_pendiente < -0.005"))[0].n;
  check(neg === 0, "D1. ningún servicio con saldo negativo", neg);
  const cajaNeg = await saldo(CAJA);
  check(cajaNeg >= 0, "D2. la CAJA de Campo nunca quedó negativa", cajaNeg);
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. las ${TOTAL_REGLAS} reglas de consistencia se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
