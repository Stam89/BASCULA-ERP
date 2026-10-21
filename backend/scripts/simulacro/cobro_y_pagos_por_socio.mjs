// 💸 Caso real: STALYN vende, su cliente le transfiere a CEYRO y CEYRO con esa plata paga deudas de STALYN
// (cáscara al agricultor y Transporte). Un solo paso, todo o nada; al final queda quién le debe a quién. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const CORTE = "2026-09-30";
const r2 = (n) => Math.round(Number(n) * 100) / 100;

try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const rovinson = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  // Caja abierta de CEYRO (el que recibe) — en la copia puede no haber.
  if (!(await q("SELECT 1 FROM cash_registers WHERE accionista_id = $1 AND status = 'OPEN'", [matriz])).length) {
    exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO", tipo: "EFECTIVO", opening_balance_cash: 500 }, matriz), "0. CEYRO abre caja");
  }
  const cajaCeyro = async () => Number((await q(
    `SELECT COALESCE(sum(CASE WHEN movement='INCOME' THEN amount ELSE -amount END) FILTER (WHERE reversed_at IS NULL),0)::float s
       FROM cash_movements m JOIN cash_registers r ON r.id = m.cash_register_id WHERE r.accionista_id = $1 AND r.status = 'OPEN'`, [matriz]))[0].s);
  const saldoAR = async (id) => Number((await q("SELECT balance::float b FROM accounts_receivable WHERE id = $1", [id]))[0].b);
  const saldoAP = async (id) => Number((await q("SELECT balance::float b FROM accounts_payable WHERE id = $1", [id]))[0].b);
  const entre = async () => exigir(await api("GET", `/receivable/cruce-socios/resumen?contraparte_id=${matriz}`, undefined, stalyn), "· saldo entre STALYN y CEYRO");

  // STALYN: un cliente que le debe $1000, un agricultor al que le debe $600 de cáscara (deudas de arranque).
  const cxc = exigir(await api("POST", "/saldos-iniciales/cxc", { corte: CORTE, contraparte_tipo: "CLIENTE", nombre: "SIM CLIENTE VENTA STALYN", monto: 1000 }, stalyn), "A0. cliente de STALYN le debe $1000");
  const cxp = exigir(await api("POST", "/saldos-iniciales/cxp", { corte: CORTE, contraparte_tipo: "PROVEEDOR", nombre: "SIM AGRICULTOR CASCARA", monto: 600 }, stalyn), "A0b. STALYN debe $600 de cáscara");
  const arId = (await q("SELECT ref_id FROM saldos_iniciales WHERE id = $1", [cxc.id]))[0].ref_id;
  const apId = (await q("SELECT ref_id FROM saldos_iniciales WHERE id = $1", [cxp.id]))[0].ref_id;
  // Deuda de STALYN con Transporte (si la copia tiene una abierta).
  const transp = (await q(`SELECT ap.id, ap.balance::float b, ap.reference_id FROM accounts_payable ap
     WHERE ap.accionista_id = $1 AND ap.reference_type = 'campo_servicio' AND ap.balance > 1 ORDER BY ap.created_at LIMIT 1`, [stalyn]))[0];
  const sesionCampo = (await q("SELECT 1 FROM campo_caja_sesiones WHERE estado = 'ABIERTA'")).length > 0;

  // ── A. Todo o nada: un pago con una cuenta ajena falla y no se guarda NADA ──
  const ajena = (await q("SELECT id FROM accounts_payable WHERE accionista_id = $1 AND balance > 0 LIMIT 1", [rovinson]))[0];
  if (ajena) {
    const mal = await api("POST", "/receivable/cobro-y-pagos-por-socio", {
      receivable_ids: [arId], amount: 1000, recibido_por: matriz, pagos: [{ payable_ids: [ajena.id], amount: 1 }]
    }, stalyn);
    check(!mal.ok && (await saldoAR(arId)) === 1000, "A1. si un pago está mal no se guarda nada (el cliente sigue debiendo $1000)", mostrar(mal));
  }

  // ── B. Caso real: recibe $1000 y paga $600 de cáscara (+ Transporte) ──
  const e0 = await entre();
  const c0 = await cajaCeyro();
  const pagos = [{ payable_ids: [apId], amount: 600 }];
  const montoTransp = transp && sesionCampo ? r2(Math.min(20, transp.b)) : 0;
  if (montoTransp > 0) pagos.push({ payable_ids: [transp.id], amount: montoTransp });
  const saldoServ0 = transp ? Number((await q("SELECT saldo_pendiente::float s FROM campo_servicios_saldo WHERE id = $1", [transp.reference_id]))[0]?.s ?? 0) : 0;
  const r = exigir(await api("POST", "/receivable/cobro-y-pagos-por-socio", {
    receivable_ids: [arId], amount: 1000, recibido_por: matriz, medio_pago: "BANCO", concepto: "transferencia del cliente", pagos
  }, stalyn), `B1. CEYRO recibió $1000 del cliente de STALYN y pagó $600 de cáscara${montoTransp ? ` y $${montoTransp} a Transporte` : ""}`);
  const pagado = 600 + montoTransp;
  check(r.cobrado === 1000 && Math.abs(r.pagado - pagado) < 0.01, "B2. cobrado $1000 · pagado lo indicado", r);
  check((await saldoAR(arId)) === 0 && (await saldoAP(apId)) === 0, "B3. el cliente ya no debe y la cáscara quedó pagada");
  check(Math.abs((await cajaCeyro()) - c0 - (1000 - pagado)) < 0.01, "B4. en la caja de CEYRO entra $1000 y sale lo pagado", { antes: c0, ahora: await cajaCeyro() });
  if (montoTransp > 0) {
    const s1 = Number((await q("SELECT saldo_pendiente::float s FROM campo_servicios_saldo WHERE id = $1", [transp.reference_id]))[0].s);
    check(Math.abs(saldoServ0 - s1 - montoTransp) < 0.01 && Math.abs((await saldoAP(transp.id)) - (transp.b - montoTransp)) < 0.01,
      "B5. Transporte cobró lo suyo y la Por Pagar de STALYN a Transporte bajó igual", { antes: saldoServ0, ahora: s1 });
  }
  const e1 = await entre();
  check(Math.abs((e1.total_me_debe - e0.total_me_debe) - (1000 - pagado)) < 0.01, `B6. CEYRO le queda debiendo a STALYN la diferencia ($${r2(1000 - pagado)})`, { antes: e0.total_me_debe, ahora: e1.total_me_debe });
  check(Math.abs(r.el_receptor_te_debe - e1.total_me_debe) < 0.01, "B7. la respuesta dice el saldo total entre los dos", r);

  // ── C. Pagó MÁS de lo que recibió: la diferencia queda como deuda de STALYN con CEYRO ──
  const cxc2 = exigir(await api("POST", "/saldos-iniciales/cxc", { corte: CORTE, contraparte_tipo: "CLIENTE", nombre: "SIM CLIENTE DOS", monto: 100 }, stalyn), "C0. otro cliente debe $100");
  const cxp2 = exigir(await api("POST", "/saldos-iniciales/cxp", { corte: CORTE, contraparte_tipo: "PROVEEDOR", nombre: "SIM AGRICULTOR DOS", monto: r2(e1.total_me_debe + 2000) }, stalyn), "C0b. otro agricultor $2000");
  const ar2 = (await q("SELECT ref_id FROM saldos_iniciales WHERE id = $1", [cxc2.id]))[0].ref_id;
  const ap2 = (await q("SELECT ref_id FROM saldos_iniciales WHERE id = $1", [cxp2.id]))[0].ref_id;
  const yaDebia = e1.total_me_debe;
  const r3 = exigir(await api("POST", "/receivable/cobro-y-pagos-por-socio", {
    receivable_ids: [ar2], amount: 100, recibido_por: matriz, pagos: [{ payable_ids: [ap2], amount: yaDebia + 100 + 50 }]
  }, stalyn, { "x-confirmar": "SOBREGIRO" }), "C1. recibe $100 y paga más de lo que tenía de STALYN (se confirma que la caja queda en negativo)");
  check(r3.el_receptor_te_debe < 0.01 && Math.abs(r3.deuda_nueva - 50) < 0.01 && Math.abs(r3.tu_le_debes - (e1.total_le_debo + 50)) < 0.01,
    "C2. se descuenta todo lo que CEYRO le debía y STALYN queda debiéndole $50 más", { r3, antes: e1.total_le_debo });

  // ── D. Por Cobrar / Por Pagar normales siguen igual ──
  const sinOtro = await api("POST", "/receivable/cobro-y-pagos-por-socio", { receivable_ids: [ar2], amount: 1, recibido_por: stalyn }, stalyn);
  check(sinOtro.status === 400, "D1. el que recibe tiene que ser OTRO socio", sinOtro.status);

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió después/.test(x.regla));
  check(h.length === 0, `Z. los controles de integridad se cumplen (sin contar el aviso de báscula de los datos reales)`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
  void TOTAL_REGLAS;
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
