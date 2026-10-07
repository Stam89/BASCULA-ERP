// Compras, sacos, repuestos, fomentos y traspaso de lotes entre socios, sobre una COPIA de la base.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dos = (f) => Promise.all([f(), f()]);
const unico = (rs) => rs.filter((r) => r.ok).length === 1;

try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja Modulos", tipo: "EFECTIVO", opening_balance_cash: 5000 }), "0. Abrir caja con $5,000");
  const saldoCaja = async () => r2((await api("GET", `/cash/registers/${caja.id}/summary`)).data.current_balance);

  // ── COMPRAS ────────────────────────────────────────────────────────────
  const prov = exigir(await api("POST", "/suppliers", { name: "PROVEEDOR MODULOS" }), "A0. Crear proveedor");
  const dupProv = await api("POST", "/suppliers", { name: "proveedor modulos" });
  check(dupProv.status === 409, "A0b. un proveedor con el mismo nombre (sin importar mayúsculas) se rechaza", dupProv.status);
  const insumo = (await q("SELECT id, stock_actual::float s FROM insumos WHERE nombre='Sacos vacios'"))[0];
  const stockInsumo = async () => Number((await q("SELECT stock_actual::float s FROM insumos WHERE id=$1", [insumo.id]))[0].s);
  const compra = (tipo, extra = {}) => api("POST", "/purchases", { supplier_id: prov.id, payment_type: tipo, items: [{ item_type: "INSUMO", insumo_id: insumo.id, quantity: 100, unit_price: 0.5 }], ...extra });
  const c0 = await saldoCaja();
  const cCash = exigir(await compra("CASH", { cash_register_id: caja.id }), "A1. Compra al CONTADO: 100 sacos vacíos × $0.50");
  check(r2(c0 - (await saldoCaja())) === 50 && (await stockInsumo()) === insumo.s + 100, "A2. salen $50 de caja y entran 100 al stock", { caja: r2(c0 - (await saldoCaja())), stock: await stockInsumo() });
  const sinCaja = await compra("CASH");
  check(!sinCaja.ok, "A3. una compra al contado sin caja se rechaza", sinCaja.status);
  const cCred = exigir(await compra("CREDIT", { due_date: "2026-11-30" }), "A4. Compra a CRÉDITO: queda por pagar");
  const apC = (await q("SELECT id, amount::float a, balance::float b FROM accounts_payable WHERE reference_type='purchase' AND reference_id=$1", [cCred.id ?? cCred.purchase?.id]))[0];
  check(apC && apC.a === 50 && apC.b === 50, "A5. nace la cuenta por pagar de $50", apC);
  check((await saldoCaja()) === r2(c0 - 50), "A6. la compra a crédito NO movió la caja");
  const pagoC = await api("POST", `/cash/payables/${apC.id}/pay`, { cash_register_id: caja.id, amount: 20 });
  check(pagoC.ok, "A7. pagar $20 de la compra a crédito", mostrar(pagoC));
  const anulaPag = await api("POST", `/purchases/${cCred.id ?? cCred.purchase?.id}/cancel`, { reason: "prueba con pago" });
  check(anulaPag.status === 409, "A8. no se anula una compra a crédito que ya tiene pagos", anulaPag.status);
  const cC2 = exigir(await compra("CREDIT"), "A9. Otra compra a crédito (sin pagos)");
  const idC2 = cC2.id ?? cC2.purchase?.id;
  const [x1, x2] = await dos(() => api("POST", `/purchases/${idC2}/cancel`, { reason: "doble clic" }));
  check(unico([x1, x2]), "A10. anular la misma compra dos veces a la vez la anula UNA vez", [x1.status, x2.status]);
  check((await stockInsumo()) === insumo.s + 100 + 100 + 100 - 100, "A11. y el stock se revierte una sola vez", await stockInsumo());
  const idCash = cCash.id ?? cCash.purchase?.id;
  const cajaAntes = await saldoCaja();
  const anulaCash = await api("POST", `/purchases/${idCash}/cancel`, { reason: "devolución", cash_register_id: caja.id });
  check(anulaCash.ok && r2((await saldoCaja()) - cajaAntes) === 50, "A12. anular la compra al contado devuelve los $50 a la caja", mostrar(anulaCash));

  // ── SACOS (compra con egreso consolidado) ──────────────────────────────
  const saco = (await q("SELECT id, stock FROM sack_inventory WHERE tipo='Oso 25 LB' AND accionista_id IS NULL LIMIT 1"))[0];
  const sacoStock = async () => Number((await q("SELECT stock::float s FROM sack_inventory WHERE id=$1", [saco.id]))[0].s);
  const s0 = await saldoCaja();
  const cSaco = await api("POST", "/sacks/purchases", { items: [{ sack_id: saco.id, cantidad: 200, precio: 0.4 }], cash_register_id: caja.id, concepto: "Compra de sacos de prueba" });
  check(cSaco.ok && r2(s0 - (await saldoCaja())) === 80 && (await sacoStock()) === Number(saco.stock) + 200, "B1. comprar 200 sacos × $0.40 saca $80 de caja y suma al stock", mostrar(cSaco));
  const sObre = await api("POST", "/sacks/purchases", { items: [{ sack_id: saco.id, cantidad: 100000, precio: 50 }], cash_register_id: caja.id });
  check(sObre.status === 409 && sObre.data?.code === "SOBREGIRO", "B2. una compra de sacos que deja la caja en negativo AVISA (409 SOBREGIRO)", mostrar(sObre));
  check((await sacoStock()) === Number(saco.stock) + 200, "B3. y mientras no se confirme no cambia el stock");

  // ── REPUESTOS ──────────────────────────────────────────────────────────
  const rep = (await q("SELECT id, stock::float s FROM repuestos WHERE nombre='RODILLOS'"))[0];
  const repStock = async () => Number((await q("SELECT stock::float s FROM repuestos WHERE id=$1", [rep.id]))[0].s);
  const r0 = await saldoCaja();
  const ent = await api("POST", `/repuestos/${rep.id}/entrada`, { cantidad: 4, costo_unitario: 25, cash_register_id: caja.id, proveedor: "Ferretería", nota: "Compra" });
  check(ent.ok && (await repStock()) === rep.s + 4 && r2(r0 - (await saldoCaja())) === 100, "C1. entrada de 4 repuestos × $25: stock +4 y caja −$100", mostrar(ent));
  const sal = await api("POST", `/repuestos/${rep.id}/salida`, { cantidad: 3, motivo: "Cambio de rodillos" });
  check(sal.ok && (await repStock()) === rep.s + 1, "C2. salida de 3: el stock baja a 1", mostrar(sal));
  const salDemas = await api("POST", `/repuestos/${rep.id}/salida`, { cantidad: 5 });
  check(salDemas.status === 409 && (await repStock()) === rep.s + 1, "C3. sacar más de lo que hay se rechaza (el stock no queda negativo)", mostrar(salDemas));
  const [sa, sb] = await dos(() => api("POST", `/repuestos/${rep.id}/salida`, { cantidad: 1, motivo: "doble clic" }));
  check(unico([sa, sb]) && (await repStock()) === rep.s, "C4. dos salidas a la vez de la última unidad: pasa UNA y el stock queda en 0", [sa.status, sb.status, await repStock()]);
  const kardex = (await api("GET", `/repuestos/${rep.id}/movimientos`)).data;
  const lista = Array.isArray(kardex) ? kardex : kardex.rows ?? [];
  check(lista.length >= 3 && lista[0].stock_resultante != null, "C5. el kárdex registra cada movimiento con su stock resultante", lista.length);

  const rCompra = await api("POST", "/repuestos/compra", { items: [{ repuesto_id: rep.id, cantidad: 1, costo_unitario: 9_999_999 }], cash_register_id: caja.id, modalidad_pago: "CONTADO" });
  check(rCompra.status === 409 && rCompra.data?.code === "SOBREGIRO" && (await repStock()) === rep.s, "C6. una compra de repuestos que deja la caja en negativo AVISA y no cambia el stock", mostrar(rCompra));
  const equipo = (await q("SELECT id FROM equipment WHERE name='Piladora 1'"))[0].id;
  const mant = await api("POST", `/equipment/${equipo}/maintenance`, { maintenance_type: "PREVENTIVO", description: "Mantenimiento de prueba", amount: 9_999_999, cash_register_id: caja.id });
  check(mant.status === 409 && mant.data?.code === "SOBREGIRO", "C7. un mantenimiento que deja la caja en negativo AVISA", mostrar(mant));
  const mantOk = await api("POST", `/equipment/${equipo}/maintenance`, { maintenance_type: "PREVENTIVO", description: "Mantenimiento normal", amount: 35, cash_register_id: caja.id });
  check(mantOk.ok, "C8. y uno normal se registra", mostrar(mantOk));

  // ── FOMENTOS ───────────────────────────────────────────────────────────
  const agri = (await q("SELECT id, full_name FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const fom = exigir(await api("POST", "/fomentos", { farmer_name: agri.full_name, farmer_id: agri.id, cuadras: 5, inicio: "2026-10-01", renta: 0.07 }), "D1. Crear un fomento de 5 cuadras");
  const f0 = await saldoCaja();
  const entrega = await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: "2026-10-01", valor: 1500, concepto: "Entrega de dinero", cash_register_id: caja.id });
  check(entrega.ok && r2(f0 - (await saldoCaja())) === 1500, "D2. entregar $1,500 al agricultor saca $1,500 de caja", mostrar(entrega));
  const det = (await api("GET", `/fomentos/${fom.id}`)).data;
  check(det && Number(det.total_entregado ?? det.total_pedido ?? 1500) >= 0, "D3. el detalle del fomento responde", Object.keys(det ?? {}).slice(0, 8));
  const f1 = await saldoCaja();
  const pagoF = await api("POST", `/fomentos/${fom.id}/pagos`, { fecha: "2026-10-05", valor: 400, concepto: "Abono del agricultor", cash_register_id: caja.id });
  check(pagoF.ok && r2((await saldoCaja()) - f1) === 400, "D4. el agricultor abona $400: entran a la caja", mostrar(pagoF));
  const entregaId = entrega.data.id;
  const pagoId = pagoF.data.id;
  const cajaAntesBorrar = await saldoCaja();
  const borraPago = await api("DELETE", `/fomentos/${fom.id}/pagos/${pagoId}`);
  check(borraPago.status === 409 && (await q("SELECT 1 FROM fomento_pagos WHERE id=$1", [pagoId])).length === 1 && (await saldoCaja()) === cajaAntesBorrar, "D5. borrar un pago que movió la caja se RECHAZA (409): antes dejaba el ingreso huérfano en la caja", mostrar(borraPago));
  const borraEntrega = await api("DELETE", `/fomentos/${fom.id}/entregas/${entregaId}`);
  check(!borraEntrega.ok && (await q("SELECT 1 FROM fomento_entregas WHERE id=$1", [entregaId])).length === 1, "D6. y lo mismo con una entrega que sacó dinero de caja", mostrar(borraEntrega));
  // Se anula primero el movimiento en Caja (admin) y entonces sí se puede borrar
  const movPago = (await q("SELECT id FROM cash_movements WHERE reference_type='fomento_pagos' AND reference_id=$1", [pagoId]))[0].id;
  const rev = await api("POST", `/cash/movements/${movPago}/reverse`, { reason: "pago cargado por error" });
  const cajaTrasRev = await saldoCaja();
  check(rev.ok && cajaTrasRev === r2(cajaAntesBorrar - 400), "D7. anular su movimiento en Caja descuenta los $400 de la caja", { rev: rev.status, caja: cajaTrasRev, esperada: r2(cajaAntesBorrar - 400) });
  const borraPago2 = await api("DELETE", `/fomentos/${fom.id}/pagos/${pagoId}`);
  check(borraPago2.ok && (await q("SELECT 1 FROM fomento_pagos WHERE id=$1", [pagoId])).length === 0 && (await saldoCaja()) === cajaTrasRev, "D8. ya anulado en Caja, el pago se puede borrar y la caja no cambia", mostrar(borraPago2));
  const borraNoExiste = await api("DELETE", `/fomentos/${fom.id}/pagos/${pagoId}`);
  check(borraNoExiste.status === 404, "D9. borrar un pago que ya no existe responde 404", borraNoExiste.status);

  // ── TRASPASO DE LOTE ENTRE SOCIOS ──────────────────────────────────────
  const tk = (await q("SELECT id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 5 ORDER BY id LIMIT 1"))[0];
  await api("POST", `/tickets/${tk.id}/link-farmer`, { farmer_id: agri.id });
  const ing = exigir(await api("POST", `/tickets/${tk.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" }), "E0. Ingresar un ticket (compra de CEYRO)");
  const libre = (await q("SELECT tunnel_number FROM tunnel_status WHERE status = 'DISPONIBLE' ORDER BY tunnel_number DESC LIMIT 1"))[0]?.tunnel_number;
  const sec = exigir(await api("POST", "/process-flow/drying", { entry_ids: [ing.ingreso.id], tunnel_number: libre, dryer_name: `Secadora ${libre}`, rice_type: "0.11", moisture_before: 20, filled_at: new Date().toISOString() }), "E0b. Formar el lote en un túnel libre");
  const liq = exigir(await api("POST", "/liquidations", { farmer_id: agri.id, weighing_ticket_id: ing.ingreso.id, quintals: tk.qq, price_per_quintal: 30, other_discounts: 0 }), "E0c. Liquidarlo al agricultor");
  const apLiq = (await q("SELECT id, amount::float a FROM accounts_payable WHERE liquidation_id=$1 AND reference_type IS NULL", [liq.id]))[0];
  exigir(await api("POST", `/cash/payables/${apLiq.id}/pay`, { cash_register_id: caja.id, amount: apLiq.a }), "E0d. Pagarle al agricultor desde la caja de CEYRO");
  const tr = await api("PUT", `/lots/${sec.lot_id}/accionista`, { accionista_id: stalyn, notes: "Traspaso de prueba" });
  check(tr.ok, "E1. traspasar el lote de CEYRO a STALYN", mostrar(tr));
  check((await q("SELECT accionista_id FROM lots WHERE id=$1", [sec.lot_id]))[0].accionista_id === stalyn, "E2. el lote ya es de STALYN");
  const arT = (await q("SELECT * FROM accounts_receivable WHERE reference_type='lot_transfer' ORDER BY created_at DESC LIMIT 1"))[0];
  const apT = (await q("SELECT * FROM accounts_payable WHERE reference_type='lot_transfer' ORDER BY created_at DESC LIMIT 1"))[0];
  check(arT && apT && arT.accionista_id === matriz && apT.accionista_id === stalyn && r2(arT.amount) === r2(apLiq.a) && r2(apT.amount) === r2(apLiq.a), "E3. STALYN le debe a CEYRO lo que CEYRO ya pagó al agricultor ($" + r2(apLiq.a) + "), en los DOS lados (por cobrar de CEYRO y por pagar de STALYN)", { cxc: arT && [arT.accionista_id === matriz, arT.amount], cxp: apT && [apT.accionista_id === stalyn, apT.amount] });
  check((await q("SELECT accionista_id FROM liquidations WHERE id=$1", [liq.id]))[0].accionista_id === stalyn && (await q("SELECT accionista_id FROM weighing_tickets WHERE id=$1", [ing.ingreso.id]))[0].accionista_id === stalyn, "E4. la liquidación y el ingreso también pasan a STALYN");
  const dup = await api("PUT", `/lots/${sec.lot_id}/accionista`, { accionista_id: stalyn });
  check(dup.ok && dup.data?.sin_cambios === true, "E5. traspasar de nuevo al mismo dueño no hace nada", mostrar(dup));
  const cobroTr = await api("POST", `/receivable/${arT.id}/pay`, { amount: 50, cash_register_id: caja.id });
  const trasAp = (await q("SELECT balance::float b FROM accounts_payable WHERE id=$1", [apT.id]))[0].b;
  check(cobroTr.ok && trasAp === r2(apT.amount - 50), "E6. cuando STALYN reintegra $50, su cuenta por pagar baja también", { cobro: cobroTr.status, suPorPagar: trasAp, esperado: r2(apT.amount - 50) });

  // ── Consistencia global ────────────────────────────────────────────────
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. las ${TOTAL_REGLAS} reglas de consistencia se cumplen después de todo esto`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
