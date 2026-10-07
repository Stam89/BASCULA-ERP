// Transporte y Cosechadora (Campo): su caja, cobros de servicios, cuentas por pagar, reversos y el cruce con los socios.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dos = (f) => Promise.all([f(), f()]);

try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const cuentas = (await api("GET", "/campo/cuentas")).data;
  const CAJA = cuentas.find((c) => c.nombre === "CAJA").id, BANCO = cuentas.find((c) => c.nombre === "BANCO").id;
  const plataforma = (await q("SELECT id FROM campo_activos WHERE nombre='PLATAFORMA'"))[0].id;
  const saldoCuenta = async (id) => r2((await q("SELECT COALESCE(sum(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float n FROM campo_movimientos WHERE cuenta_id=$1", [id]))[0].n);
  await q("DELETE FROM campo_caja_sesiones WHERE estado = 'ABIERTA'");

  // ── Caja de Campo ──────────────────────────────────────────────────────
  const sinCaja = await api("POST", "/campo/movimientos", { cuenta_id: CAJA, signo: "entrada", monto: 10, concepto: "sin caja abierta" });
  check(!sinCaja.ok, "A1. sin caja abierta no se registran movimientos en CAJA", mostrar(sinCaja));
  const ses = exigir(await api("POST", "/campo/caja/abrir", { saldo_inicial: 100, observaciones: "Apertura de prueba" }), "A2. Abrir la caja de Campo con $100");
  const [o1, o2] = await dos(() => api("POST", "/campo/caja/abrir", { saldo_inicial: 5 }));
  check(o1.status === 409 && o2.status === 409, "A3. abrir otra caja con una ya abierta se rechaza (409)", [o1.status, o2.status]);
  check((await saldoCuenta(CAJA)) === 100, "A4. la apertura queda como $100 en la cuenta CAJA", await saldoCuenta(CAJA));

  // ── Servicio a un cliente y cobros ─────────────────────────────────────
  const cli = exigir(await api("POST", "/campo/clientes", { nombre: "CLIENTE CAMPO", tipo: "externo" }), "B0. Cliente de Campo");
  const serv = exigir(await api("POST", "/campo/servicios", { cliente_id: cli.id, activo_id: plataforma, tipo: "flete", qq: 100, precio_unitario: 2 }), "B1. Servicio de flete: 100 QQ × $2 = $200");
  check(r2(serv.valor) === 200, "B2. el valor se calcula (QQ × precio)", serv.valor);
  const ab1 = await api("POST", "/campo/cxc/abono", { cliente_id: cli.id, monto: 80, cuenta_id: CAJA });
  check(ab1.ok && (await saldoCuenta(CAJA)) === 180, "B3. el cliente abona $80 en CAJA: la caja pasa a $180", mostrar(ab1));
  const abExc = await api("POST", "/campo/cxc/abono", { cliente_id: cli.id, monto: 500, cuenta_id: CAJA });
  check(abExc.status === 422, "B4. un abono mayor a lo que debe se rechaza (422)", mostrar(abExc));
  const [a1, a2] = await dos(() => api("POST", "/campo/cxc/abono", { cliente_id: cli.id, monto: 120, cuenta_id: BANCO }));
  const quedo = (await q("SELECT saldo_pendiente::float s FROM campo_servicios_saldo WHERE id=$1", [serv.id]))[0].s;
  check([a1, a2].filter((r) => r.ok).length === 1 && quedo === 0, "B5. dos abonos de $120 a la vez (saldo $120): pasa UNO y queda en $0 (sin cobrar de más)", { r: [a1.status, a2.status], saldo: quedo });
  const ab0 = await api("POST", "/campo/cxc/abono", { cliente_id: cli.id, monto: 1, cuenta_id: CAJA });
  check(ab0.status === 422, "B6. un servicio saldado no recibe más abonos", ab0.status);

  // ── Gastos y movimientos de caja ───────────────────────────────────────
  const gasto = await api("POST", "/campo/movimientos", { cuenta_id: CAJA, signo: "salida", monto: 30, concepto: "Combustible" });
  check(gasto.ok && (await saldoCuenta(CAJA)) === 150, "C1. un gasto de $30 baja la caja a $150", mostrar(gasto));
  const gastoGrande = await api("POST", "/campo/movimientos", { cuenta_id: CAJA, signo: "salida", monto: 5000, concepto: "demasiado" });
  check(!gastoGrande.ok && (await saldoCuenta(CAJA)) === 150, "C2. gastar más efectivo del que hay en CAJA se rechaza (Campo bloquea el negativo)", mostrar(gastoGrande));
  const movId = gasto.data.id ?? gasto.data.movimiento?.id;
  const [r1, r2x] = await dos(() => api("POST", `/campo/movimientos/${movId}/reversar`, { motivo: "doble clic" }));
  check([r1, r2x].filter((r) => r.ok).length === 1 && (await saldoCuenta(CAJA)) === 180, "C3. reversar el gasto dos veces a la vez lo reversa UNA vez y la caja vuelve a $180", { r: [r1.status, r2x.status], caja: await saldoCuenta(CAJA) });
  const revRev = await q("SELECT id FROM campo_movimientos WHERE movimiento_origen_id IS NOT NULL LIMIT 1");
  const noRevRev = revRev[0] ? await api("POST", `/campo/movimientos/${revRev[0].id}/reversar`, { motivo: "reversar una reversa" }) : { status: 409 };
  check(!noRevRev.ok, "C4. una reversa no se puede volver a reversar", noRevRev.status);

  // ── Cuentas por pagar de Campo ─────────────────────────────────────────
  const cxp = exigir(await api("POST", "/campo/cxp", { acreedor: "TALLER SIMULACRO", concepto: "Reparación", monto: 150 }), "D1. Cuenta por pagar de $150 al taller");
  const pg1 = await api("POST", `/campo/cxp/${cxp.id}/abono`, { monto: 50, cuenta_id: CAJA });
  check(pg1.ok && pg1.data.saldo === 100 && (await saldoCuenta(CAJA)) === 130, "D2. pagar $50: queda debiendo $100 y la caja baja a $130", mostrar(pg1));
  const pgExc = await api("POST", `/campo/cxp/${cxp.id}/abono`, { monto: 500, cuenta_id: CAJA });
  check(!pgExc.ok, "D3. pagar más de lo que se debe se rechaza", pgExc.status);
  const [p1, p2] = await dos(() => api("POST", `/campo/cxp/${cxp.id}/abono`, { monto: 100, cuenta_id: CAJA }));
  const saldoCxp = (await api("GET", "/campo/cxp")).data.find?.((c) => c.id === cxp.id) ?? (await api("GET", "/campo/cxp")).data.cuentas?.find((c) => c.id === cxp.id);
  check([p1, p2].filter((r) => r.ok).length === 1 && (await saldoCuenta(CAJA)) === 30, "D4. dos pagos de $100 a la vez (debe $100): pasa UNO y la caja queda en $30", { r: [p1.status, p2.status], caja: await saldoCuenta(CAJA), saldoCxp: saldoCxp?.saldo });
  const delCxp = await api("DELETE", `/campo/cxp/${cxp.id}`);
  check(delCxp.status === 409, "D5. no se elimina una cuenta por pagar que ya tiene pagos", delCxp.status);

  // ── Cierre de caja (arqueo) ────────────────────────────────────────────
  const prev = (await api("GET", "/campo/caja/cierre-preview")).data;
  check(prev && r2(prev.saldo_teorico) === 30, "E1. el arqueo previo calcula el saldo teórico ($30)", prev && { teorico: prev.saldo_teorico });
  const cierre = await api("POST", "/campo/caja/cerrar", { saldo_real: 25, observaciones: "Faltan $5", generar_ajuste: true });
  check(cierre.ok && r2(cierre.data.diferencia ?? cierre.data.sesion?.diferencia) === -5, "E2. cerrar con $25 reales: diferencia −$5", mostrar(cierre));
  check((await saldoCuenta(CAJA)) === 25, "E3. el ajuste deja la caja en $25 (lo que hay físicamente)", await saldoCuenta(CAJA));
  const trasCierre = await api("POST", "/campo/movimientos", { cuenta_id: CAJA, signo: "entrada", monto: 1, concepto: "después del cierre" });
  check(!trasCierre.ok, "E4. después de cerrar no se registran movimientos en CAJA", mostrar(trasCierre));
  const cierre2 = await api("POST", "/campo/caja/cerrar", { saldo_real: 25 });
  check(cierre2.status === 400, "E5. cerrar una caja ya cerrada se rechaza", cierre2.status);

  // ── Cruce con un SOCIO: el flete de envejecido es cuenta por cobrar de Campo contra STALYN ──
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const bodPT = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS'"))[0].id;
  const proveedor = (await q("SELECT id FROM external_providers WHERE is_active = true LIMIT 1"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',100,'simulacro','OWNED',$3)", [prod, bodPT, stalyn]);
  const lote = exigir(await api("POST", "/selection/batches", { provider_id: proveedor, service_type: "ENVEJECIMIENTO", warehouse_id: bodPT, rate_per_qq: 3.5, inputs: [{ product_id: prod, quantity: 30 }], flete: { tipo: "propia", monto: 60, activo_id: plataforma } }, stalyn), "F1. STALYN manda a envejecer 30 QQ con flete de PLATAFORMA ($60)");
  void lote;
  const svS = (await q("SELECT s.id FROM campo_servicios s WHERE s.origen_tipo='envejecido_flete' ORDER BY s.created_at DESC LIMIT 1"))[0].id;
  const espejo = async () => (await q("SELECT balance::float b, status FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [svS]))[0];
  check((await espejo()).b === 60, "F2. STALYN debe $60 a Transporte en su Por Pagar", await espejo());
  const clienteStalyn = (await q("SELECT id FROM campo_clientes WHERE nombre='STALYN'"))[0].id;
  await api("POST", "/campo/caja/abrir", { saldo_inicial: 0 });
  const nots0 = (await q("SELECT count(*)::int n FROM notificaciones WHERE accionista_id=$1", [stalyn]))[0].n;
  const abS = await api("POST", "/campo/cxc/abono", { cliente_id: clienteStalyn, monto: 25, cuenta_id: BANCO });
  check(abS.ok && (await espejo()).b === 35, "F3. Campo registra un abono de $25 de STALYN: su Por Pagar baja a $35 (el trigger lo refleja solo)", { abono: abS.status, espejo: await espejo() });
  const nots1 = (await q("SELECT count(*)::int n FROM notificaciones WHERE accionista_id=$1", [stalyn]))[0].n;
  check(nots1 > nots0, "F4. a STALYN le llega una notificación del cobro", { antes: nots0, despues: nots1 });
  const abTodo = await api("POST", "/campo/cxc/abono", { cliente_id: clienteStalyn, monto: 35, cuenta_id: BANCO });
  check(abTodo.ok && (await espejo()).b === 0 && (await espejo()).status === "PAID", "F5. al saldar el resto, su Por Pagar queda PAGADA", await espejo());

  // ── Reportes de Campo responden ────────────────────────────────────────
  for (const r of ["/campo/reportes/saldo-caja", "/campo/reportes/por-cobrar", "/campo/reportes/por-maquina", "/campo/reportes/estado-resultados", "/campo/clientes/estado-cuenta", "/campo/caja/libro", "/campo/caja/sesiones", "/campo/servicios", "/campo/movimientos"]) {
    const x = await api("GET", r);
    check(x.status === 200, `G. ${r} responde`, x.status === 200 ? undefined : mostrar(x));
  }

  // ── Consistencia global ────────────────────────────────────────────────
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. las ${TOTAL_REGLAS} reglas de consistencia se cumplen después de todo esto`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
