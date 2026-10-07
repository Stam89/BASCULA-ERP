// Saldos iniciales (arranque con datos reales) sobre una COPIA de la base: carga, uso posterior y consistencia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const CORTE = "2026-09-30";
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const agri = (await q("SELECT id, full_name FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const cascara = (await q("SELECT id FROM products WHERE code='CASCARA-011'"))[0].id;
  const blanco = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja Arranque", tipo: "EFECTIVO", opening_balance_cash: 1000 }), "0. Abrir caja con $1,000");
  const saldoCaja = async () => r2((await api("GET", `/cash/registers/${caja.id}/summary`)).data.current_balance);
  const cajaInicial = await saldoCaja();
  const mov0 = (await q("SELECT count(*)::int n FROM cash_movements"))[0].n;

  // ── Reglas de fecha ────────────────────────────────────────────────────
  const noFin = await api("POST", "/saldos-iniciales/cxc", { corte: "2026-09-29", contraparte_tipo: "CLIENTE", nombre: "X", monto: 10 });
  check(noFin.status === 400, "A1. el corte debe ser fin de mes (29/09 se rechaza)", mostrar(noFin));
  const futuro = await api("POST", "/saldos-iniciales/cxc", { corte: "2099-12-31", contraparte_tipo: "CLIENTE", nombre: "X", monto: 10 });
  check(futuro.status === 400, "A2. el corte no puede ser futuro", futuro.status);
  const montoNeg = await api("POST", "/saldos-iniciales/cxc", { corte: CORTE, contraparte_tipo: "CLIENTE", nombre: "X", monto: -5 });
  check(montoNeg.status === 400, "A3. un monto negativo se rechaza", montoNeg.status);

  // ── Cuentas por cobrar ─────────────────────────────────────────────────
  const cxc1 = exigir(await api("POST", "/saldos-iniciales/cxc", { corte: CORTE, contraparte_tipo: "CLIENTE", nombre: "CLIENTE ARRANQUE", monto: 500, fecha_deuda: "2026-09-10", vencimiento: "2026-10-30", detalle: "Venta de septiembre" }), "B1. Cuenta por cobrar de un cliente nuevo ($500)");
  const cxc2 = exigir(await api("POST", "/saldos-iniciales/cxc", { corte: CORTE, contraparte_tipo: "AGRICULTOR", contraparte_id: agri.id, monto: 120 }), "B2. Cuenta por cobrar a un agricultor ($120)");
  const cxcSocio = exigir(await api("POST", "/saldos-iniciales/cxc", { corte: CORTE, contraparte_tipo: "SOCIO", contraparte_id: stalyn, monto: 300, detalle: "Pilado de septiembre" }), "B3. Cuenta por cobrar a un SOCIO (STALYN, $300)");
  const espCxP = (await q("SELECT p.* FROM accounts_payable p JOIN saldos_iniciales si ON si.ref2_id = p.id WHERE si.id = $1", [cxcSocio.id]))[0];
  check(!!espCxP && espCxP.accionista_id === stalyn && r2(espCxP.amount) === 300, "B4. STALYN ve esa deuda en SU Por Pagar (espejo)", espCxP && { acc: espCxP.accionista_id === stalyn, monto: espCxP.amount });
  const fechada = (await q("SELECT to_char(created_at AT TIME ZONE 'America/Guayaquil','YYYY-MM-DD') f FROM accounts_receivable WHERE id = (SELECT ref_id FROM saldos_iniciales WHERE id=$1)", [cxc1.id]))[0].f;
  check(fechada === "2026-09-10", "B5. la deuda queda fechada el día que nació (10/09), no el del arranque", fechada);
  const vencidas = (await api("GET", "/receivable")).data;
  const lista = Array.isArray(vencidas) ? vencidas : vencidas.rows ?? [];
  check(lista.some((a) => /ARRANQUE/.test(a.customer_name ?? "") && r2(a.balance) === 500), "B6. aparece en Por Cobrar con su saldo", lista.length);

  // ── Cuentas por pagar ──────────────────────────────────────────────────
  const cxp1 = exigir(await api("POST", "/saldos-iniciales/cxp", { corte: CORTE, contraparte_tipo: "PROVEEDOR", nombre: "PROVEEDOR ARRANQUE", monto: 400, vencimiento: "2026-10-15" }), "C1. Cuenta por pagar a un proveedor nuevo ($400)");
  const cxpSocio = exigir(await api("POST", "/saldos-iniciales/cxp", { corte: CORTE, contraparte_tipo: "SOCIO", contraparte_id: stalyn, monto: 150 }), "C2. Cuenta por pagar a un SOCIO ($150): el socio la ve por cobrar");
  const espCxC = (await q("SELECT a.* FROM accounts_receivable a JOIN saldos_iniciales si ON si.ref2_id = a.id WHERE si.id = $1", [cxpSocio.id]))[0];
  check(!!espCxC && espCxC.accionista_id === stalyn, "C3. espejo en la Por Cobrar de STALYN", !!espCxC);
  const cxcContraCliente = await api("POST", "/saldos-iniciales/cxp", { corte: CORTE, contraparte_tipo: "CLIENTE", nombre: "X", monto: 5 });
  check(cxcContraCliente.status === 400, "C4. una cuenta por pagar a un CLIENTE se rechaza", cxcContraCliente.status);
  const consigoMismo = await api("POST", "/saldos-iniciales/cxc", { corte: CORTE, contraparte_tipo: "SOCIO", contraparte_id: matriz, monto: 5 });
  check(consigoMismo.status === 400, "C5. una deuda con uno mismo (CEYRO ↔ CEYRO) se rechaza", consigoMismo.status);

  // ── Inventario ─────────────────────────────────────────────────────────
  const invC = exigir(await api("POST", "/saldos-iniciales/inventario", { corte: CORTE, product_id: cascara, cantidad: 80, costo_unitario: 25, detalle: "Cáscara seca en bodega" }), "D1. Inventario: 80 QQ de cáscara seca a $25/QQ");
  check(!!invC.lote, "D2. la cáscara nace como un LOTE propio (para pilarla en Producción)", invC.lote);
  const invP = exigir(await api("POST", "/saldos-iniciales/inventario", { corte: CORTE, product_id: blanco, cantidad: 60, costo_unitario: 40 }), "D3. Inventario: 60 QQ de arroz pilado a $40/QQ");
  const stock = async (id) => r2((await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_stock WHERE product_id=$1 AND accionista_id=$2", [id, matriz]))[0].n);
  const stBlanco = await stock(blanco);
  check(stBlanco >= 60, "D4. el arroz pilado ya cuenta en el stock del socio", stBlanco);

  // ── Anticipos ──────────────────────────────────────────────────────────
  const ant = exigir(await api("POST", "/saldos-iniciales/anticipos", { corte: CORTE, contraparte_id: agri.id, monto: 90, fecha_deuda: "2026-09-05" }), "E1. Anticipo a un agricultor ($90)");

  // ── Nada de lo anterior mueve la caja ──────────────────────────────────
  check((await saldoCaja()) === cajaInicial && (await q("SELECT count(*)::int n FROM cash_movements"))[0].n === mov0, "F1. cargar saldos iniciales NO mueve la caja ni crea movimientos", { caja: await saldoCaja(), esperada: cajaInicial });
  const lista2 = (await api("GET", "/saldos-iniciales")).data;
  const filas = Array.isArray(lista2) ? lista2 : lista2.rows ?? lista2.cargas ?? [];
  check(JSON.stringify(lista2).includes("ARRANQUE"), "F2. el listado de cargas las muestra", filas.length);

  // ── Uso posterior: cobrar, pagar, pilar, liquidar con el anticipo ──────
  const cuenta1 = (await q("SELECT id FROM accounts_receivable WHERE id = (SELECT ref_id FROM saldos_iniciales WHERE id=$1)", [cxc1.id]))[0].id;
  const s0 = await saldoCaja();
  const cobro = await api("POST", `/receivable/${cuenta1}/pay`, { amount: 200, cash_register_id: caja.id });
  check(cobro.ok && r2((await saldoCaja()) - s0) === 200, "G1. cobrar $200 de la cuenta del arranque entra a la caja", mostrar(cobro));
  const cuentaP = (await q("SELECT id FROM accounts_payable WHERE id = (SELECT ref_id FROM saldos_iniciales WHERE id=$1)", [cxp1.id]))[0].id;
  const s1 = await saldoCaja();
  const pagoP = await api("POST", `/cash/payables/${cuentaP}/pay`, { cash_register_id: caja.id, amount: 400 });
  check(pagoP.ok && r2(s1 - (await saldoCaja())) === 400, "G2. pagar el proveedor del arranque saca $400 de la caja", mostrar(pagoP));
  const cat = (await q("SELECT category FROM cash_movements WHERE reference_type='accounts_payable' AND reference_id=$1", [cuentaP]))[0]?.category;
  check(cat === "PAGO_SALDO_INICIAL", "G3. y queda con la categoría «pago de saldo inicial» (no es costo del mes)", cat);
  const sCx = (await q("SELECT id, balance::float b FROM accounts_receivable WHERE id = (SELECT ref_id FROM saldos_iniciales WHERE id=$1)", [cxcSocio.id]))[0];
  const sPx = (await q("SELECT p.id, p.balance::float b FROM accounts_payable p WHERE p.id = (SELECT ref2_id FROM saldos_iniciales WHERE id=$1)", [cxcSocio.id]))[0];
  const cobroSocio = await api("POST", `/receivable/${sCx.id}/pay`, { amount: 100, cash_register_id: caja.id });
  const trasCx = (await q("SELECT balance::float b FROM accounts_receivable WHERE id=$1", [sCx.id]))[0].b;
  const trasPx = (await q("SELECT balance::float b FROM accounts_payable WHERE id=$1", [sPx.id]))[0].b;
  check(cobroSocio.ok && trasCx === 200 && trasPx === 200, "G4. cobrarle $100 a STALYN baja los DOS lados: su Por Pagar y tu Por Cobrar quedan en $200", { porCobrar: trasCx, suPorPagar: trasPx, r: mostrar(cobroSocio) });

  // El anticipo se descuenta en la primera liquidación del agricultor
  const tk = (await q("SELECT id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 5 ORDER BY id LIMIT 1"))[0];
  await api("POST", `/tickets/${tk.id}/link-farmer`, { farmer_id: agri.id });
  const ing = exigir(await api("POST", `/tickets/${tk.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" }), "H0. Ingresar un ticket del agricultor");
  const liq = exigir(await api("POST", "/liquidations", { farmer_id: agri.id, weighing_ticket_id: ing.ingreso.id, quintals: tk.qq, price_per_quintal: 30, other_discounts: 0 }), "H1. Liquidarlo a $30/QQ");
  check(r2(liq.advances_discount) >= 90, "H2. se descuenta el anticipo del arranque ($90) en la liquidación", { desc: liq.advances_discount });

  // ── Anular una carga ───────────────────────────────────────────────────
  const anulaConCobro = await api("POST", `/saldos-iniciales/${cxc1.id}/anular`, { motivo: "prueba con cobro" });
  check(anulaConCobro.status === 409, "I1. no se puede anular una cuenta que ya tuvo cobros", mostrar(anulaConCobro));
  const anulaCxc2 = await api("POST", `/saldos-iniciales/${cxc2.id}/anular`, { motivo: "cargada por error" });
  check(anulaCxc2.ok, "I2. una carga sin uso sí se anula", mostrar(anulaCxc2));
  const anulaSocio = await api("POST", `/saldos-iniciales/${cxpSocio.id}/anular`, { motivo: "error de socio" });
  check(anulaSocio.ok && (await q("SELECT status FROM accounts_receivable WHERE id=$1", [espCxC.id]))[0].status === "CANCELLED", "I3. anular una deuda entre socios anula también su espejo", mostrar(anulaSocio));
  const doble = await api("POST", `/saldos-iniciales/${cxc2.id}/anular`, { motivo: "otra vez" });
  check(doble.status === 409, "I4. anular dos veces se rechaza", doble.status);

  // ── Estados financieros después de la carga ────────────────────────────
  const bal = (await api("GET", "/finance/balance")).data;
  check(bal && bal.activo && bal.pasivo, "J1. el Balance responde con la carga hecha", Object.keys(bal ?? {}));
  for (const [n, r] of [["dashboard", "/finance/dashboard"], ["resultados", "/finance/income-statement"], ["flujo", "/finance/cash-flow"]]) {
    const x = await api("GET", r);
    check(x.status === 200, `J2. ${n} financiero responde`, x.status);
  }

  // ── Consistencia global ────────────────────────────────────────────────
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `K1. las ${TOTAL_REGLAS} reglas de consistencia entre módulos se cumplen después de todo esto`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
