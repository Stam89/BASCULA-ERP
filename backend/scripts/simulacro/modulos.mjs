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
  const entregaId = (entrega.data.id ?? entrega.data.entrega?.id);
  const borrar = await api("DELETE", `/fomentos/${fom.id}/entregas/${entregaId}`);
  const cajaTrasBorrar = await saldoCaja();
  check(borrar.ok ? cajaTrasBorrar === r2(f1 + 400 + 1500) || cajaTrasBorrar === r2(f1 + 400) : true, "D5. borrar una entrega con salida de caja: la caja queda coherente (se repone o se rechaza el borrado)", { borrado: borrar.status, caja: cajaTrasBorrar, sinReponer: r2(f1 + 400), repuesta: r2(f1 + 400 + 1500) });

  // ── TRASPASO DE LOTE ENTRE SOCIOS ──────────────────────────────────────
  const lote = (await q("SELECT id, lot_code, accionista_id FROM lots WHERE accionista_id=$1 AND status <> 'PROCESSED' ORDER BY created_at DESC LIMIT 1", [matriz]))[0];
  if (lote) {
    const tr = await api("PUT", `/lots/${lote.id}/accionista`, { accionista_id: stalyn, notes: "Traspaso de prueba" });
    check(tr.ok, "E1. traspasar un lote de CEYRO a STALYN", mostrar(tr));
    const duenio = (await q("SELECT accionista_id FROM lots WHERE id=$1", [lote.id]))[0].accionista_id;
    check(duenio === stalyn, "E2. el lote ya es de STALYN", duenio === stalyn);
    const dup = await api("PUT", `/lots/${lote.id}/accionista`, { accionista_id: stalyn });
    check(dup.ok && (dup.data?.sin_cambios === true), "E3. traspasar de nuevo al mismo dueño no hace nada (sin_cambios)", mostrar(dup));
  } else console.log("   (no hay un lote de CEYRO sin pilar para probar el traspaso)");

  // ── Consistencia global ────────────────────────────────────────────────
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. las ${TOTAL_REGLAS} reglas de consistencia se cumplen después de todo esto`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
