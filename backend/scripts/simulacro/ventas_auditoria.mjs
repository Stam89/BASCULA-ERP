// Auditoría de VENTAS (parte 2): editar, preparar/revertir, cancelar, respaldo de stock, cobros a crédito,
// guía de remisión, cuadrilla del despacho y pedidos de otro socio. SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-OSO'"))[0].id;
  const bodPT = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS'"))[0].id;
  const p25 = (await q("SELECT id, name FROM product_presentations WHERE product_id=$1 AND weight_lb=25 LIMIT 1", [prod]))[0];
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',100,'simulacro','OWNED',$3)", [prod, bodPT, stalyn]);
  const abrir = async (acc, n) => { const r = await api("POST", "/cash/registers/open", { name: n, tipo: "EFECTIVO", opening_balance_cash: 200 }, acc); return r.ok ? r.data : (await api("GET", "/cash/registers/current", undefined, acc)).data; };
  const caja = await abrir(stalyn, "Caja STALYN");
  const saldoCaja = async () => r2((await api("GET", `/cash/registers/${caja.id}/summary`, undefined, stalyn)).data.current_balance);
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE AUDITORIA VENTAS" }, stalyn), "0. cliente");
  const item = (qq, precio = 30) => ({ product_id: prod, inventory_product_id: prod, presentation_id: p25?.id, presentation_name: p25?.name, quantity: qq, unit_price: precio });
  const stock = async () => r2((await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_movements WHERE product_id=$1 AND accionista_id=$2", [prod, stalyn]))[0].n);
  const sacos = async () => r2((await q("SELECT COALESCE(sum(stock),0)::float n FROM sack_inventory WHERE categoria='MARCA' AND upper(marca)='OSO' AND peso_lb=25"))[0]?.n ?? 0);
  const arDe = async (id) => (await q("SELECT a.* FROM accounts_receivable a JOIN sales_orders o ON o.receivable_id=a.id WHERE o.id=$1", [id]))[0];

  // ── A. Editar un pedido ──────────────────────────────────────────────────
  const pA = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [item(10)] }, stalyn), "A1. pedido de 10 QQ a $30");
  check(r2((await arDe(pA.id)).amount) === 300, "A2. nace su cuenta por cobrar por $300");
  exigir(await api("PUT", `/orders/${pA.id}`, { items: [item(8, 31)] }, stalyn), "A3. editar a 8 QQ a $31");
  const arA = await arDe(pA.id);
  check(r2(arA.amount) === 248 && r2(arA.balance) === 248, "A4. la cuenta por cobrar sigue al pedido ($248)", { monto: arA.amount, saldo: arA.balance });
  check((await api("POST", "/orders", { customer_id: cli.id, items: [item(0)] }, stalyn)).status === 400, "A5. cantidad 0 → 400");
  check((await api("POST", "/orders", { customer_id: cli.id, items: [item(5, -1)] }, stalyn)).status === 400, "A6. precio negativo → 400");
  const sinRespaldo = await api("POST", "/orders", { customer_id: cli.id, items: [item(100000)] }, stalyn);
  check(sinRespaldo.status === 409, "A7. pedir más de lo que hay (ni terminado ni cáscara) → 409 «respaldo insuficiente»", mostrar(sinRespaldo));

  // ── B. Preparar y revertir ───────────────────────────────────────────────
  const st0 = await stock(), sc0 = await sacos();
  const [b1, b2] = await Promise.all([1, 2].map(() => api("PATCH", `/orders/${pA.id}/prepare`, { prepared: true, warehouse_id: bodPT }, stalyn)));
  check(b1.ok && b2.ok && r2(st0 - await stock()) === 8, "B1. preparar dos veces a la vez descuenta UNA sola vez (8 QQ)", { antes: st0, ahora: await stock() });
  check(r2(sc0 - await sacos()) === 32, "B2. salen 32 sacos de 25 lb (8 QQ × 100 / 25)", { antes: sc0, ahora: await sacos() });
  check((await api("PUT", `/orders/${pA.id}`, { items: [item(9)] }, stalyn)).status === 409, "B3. un pedido preparado no se edita (hay que revertir) → 409");
  exigir(await api("PATCH", `/orders/${pA.id}/prepare`, { prepared: false }, stalyn), "B4. revertir la preparación");
  check(await stock() === st0 && await sacos() === sc0, "B5. vuelven el arroz y los sacos exactos", { stock: await stock(), sacos: await sacos() });

  // ── C. Cancelar ──────────────────────────────────────────────────────────
  exigir(await api("PATCH", `/orders/${pA.id}/prepare`, { prepared: true, warehouse_id: bodPT }, stalyn), "C0. preparar de nuevo");
  exigir(await api("POST", `/receivable/${arA.id}/pay`, { amount: 50, cash_register_id: caja.id }, stalyn), "C1. el cliente deja $50 de adelanto");
  check((await api("POST", `/orders/${pA.id}/cancel`, {}, stalyn)).status === 409, "C2. con adelanto cobrado no se cancela → 409");
  const movAde = (await q("SELECT id FROM cash_movements WHERE reference_type='accounts_receivable' AND reference_id=$1 AND reversed_at IS NULL", [arA.id]))[0];
  const cAntes = await saldoCaja();
  exigir(await api("POST", `/cash/movements/${movAde.id}/reverse`, { reason: "adelanto devuelto" }, stalyn), "C3. se anula en Caja el adelanto de $50");
  const arC3 = await arDe(pA.id);
  check(r2(cAntes - await saldoCaja()) === 50 && r2(arC3.balance) === 248 && arC3.status === "CONFIRMED", "C3b. salen los $50 de la caja Y el cliente vuelve a deber $248 (antes quedaba debiendo $198)", { caja: r2(cAntes - await saldoCaja()), saldo: arC3.balance, estado: arC3.status });
  exigir(await api("POST", `/orders/${pA.id}/cancel`, {}, stalyn), "C4. ahora sí se cancela");
  const arC = await arDe(pA.id);
  check(arC.status === "CANCELLED" && r2(arC.balance) === 0 && await stock() === st0 && await sacos() === sc0, "C5. cuenta anulada y vuelven arroz y sacos", { ar: arC.status, stock: await stock(), sacos: await sacos() });

  // ── D. Venta a crédito: abonos y estado ──────────────────────────────────
  const pD = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [item(5)] }, stalyn), "D0. pedido de 5 QQ ($150)");
  exigir(await api("PATCH", `/orders/${pD.id}/prepare`, { prepared: true, warehouse_id: bodPT }, stalyn), "D0b. preparar");
  const dD = exigir(await api("POST", `/orders/${pD.id}/deliver`, { payment_method: "CREDIT", warehouse_id: bodPT }, stalyn), "D1. despachar a crédito");
  const estado = async () => (await api("GET", "/sales", undefined, stalyn)).data.find((x) => x.sale_number === dD.sale.sale_number);
  check((await estado())?.payment_status === "PENDING", "D2. la venta figura pendiente de cobro", (await estado())?.payment_status);
  const arD = await arDe(pD.id);
  check((await api("POST", `/receivable/${arD.id}/pay`, { amount: 10 }, stalyn)).status === 400, "D3. un abono sin caja se rechaza (el dinero tiene que entrar a una caja) → 400");
  const c0 = await saldoCaja();
  exigir(await api("POST", `/receivable/${arD.id}/pay`, { amount: 60, cash_register_id: caja.id }, stalyn), "D4. abono de $60 a caja");
  check(r2(await saldoCaja() - c0) === 60 && (await estado())?.payment_status === "PARTIAL" && r2((await estado()).saldo_pendiente) === 90, "D5. entra $60 a la caja y la venta pasa a PARCIAL (saldo $90)", await estado());
  check((await api("POST", `/receivable/${arD.id}/pay`, { amount: 91, cash_register_id: caja.id }, stalyn)).status === 409, "D6. abonar más del saldo → 409");
  exigir(await api("POST", `/receivable/${arD.id}/pay`, { amount: 90, cash_register_id: caja.id }, stalyn), "D7. paga el resto");
  check((await estado())?.payment_status === "PAID", "D8. la venta queda PAGADA", (await estado())?.payment_status);

  // ── E. Guía de remisión y cuadrilla del despacho ─────────────────────────
  check((await api("PUT", `/orders/${pA.id}/guia`, { transportista_nombre: "X" }, stalyn)).status === 409, "E1. un pedido no despachado no lleva guía → 409");
  const g1 = exigir(await api("PUT", `/orders/${pD.id}/guia`, { transportista_nombre: "CHOFER UNO", vehiculo_placa: "ABC-123" }, stalyn), "E2. emitir la guía");
  const g2 = exigir(await api("PUT", `/orders/${pD.id}/guia`, { transportista_nombre: "CHOFER DOS" }, stalyn), "E3. corregir el chofer");
  check(g1.guia_number && g1.guia_number === g2.guia_number && g2.transportista_nombre === "CHOFER DOS", "E4. la guía conserva su número al corregirla", { g1: g1.guia_number, g2: g2.guia_number });
  const cuad = (await q("SELECT quantity::float qq FROM cuadrilla_entries WHERE origen='VENTA' AND referencia_id=$1", [pD.id]))[0];
  check(!cuad || r2(cuad.qq) === 5, "E5. la cuadrilla del despacho registra los 5 QQ (si hay tarifa de despacho)", cuad);

  // ── E2. Pago ENTRE SOCIOS (cargo de empaque) anulado en Caja: se deshace en los dos lados ──
  const ch = (await q("SELECT * FROM matriz_packaging_charges WHERE order_id=$1", [pD.id]))[0];
  if (ch) {
    const cajaM = await abrir(matriz, "Caja CEYRO");
    const saldoM = async () => r2((await api("GET", `/cash/registers/${cajaM.id}/summary`)).data.current_balance);
    const m0 = await saldoM(), s0 = await saldoCaja();
    exigir(await api("POST", `/cash/payables/${ch.payable_id}/pay`, { cash_register_id: caja.id, amount: Number(ch.monto) }, stalyn, { "x-confirmar": "SOBREGIRO" }), "E6. STALYN paga el cargo de empaque a CEYRO");
    const mov = (await q("SELECT id FROM cash_movements WHERE reference_type='accounts_payable' AND reference_id=$1 AND reversed_at IS NULL", [ch.payable_id]))[0];
    exigir(await api("POST", `/cash/movements/${mov.id}/reverse`, { reason: "pago equivocado" }, stalyn), "E7. STALYN anula ese pago en su Caja");
    const ap = (await q("SELECT balance::float b, status FROM accounts_payable WHERE id=$1", [ch.payable_id]))[0];
    const ar = (await q("SELECT balance::float b, status FROM accounts_receivable WHERE id=$1", [ch.receivable_id]))[0];
    check(r2(ap.b) === r2(ch.monto) && r2(ar.b) === r2(ch.monto), "E8. STALYN vuelve a deber y CEYRO vuelve a tener por cobrar el cargo completo", { ap, ar, monto: ch.monto });
    check(await saldoCaja() === s0 && await saldoM() === m0, "E9. las DOS cajas quedan como antes (también se anuló el ingreso en la caja de CEYRO)", { stalyn: [s0, await saldoCaja()], ceyro: [m0, await saldoM()] });
  } else console.log("   (info) sin cargo de empaque para probar el espejo");

  // ── F. Pedido de otro socio desde la cola global ─────────────────────────
  const ajeno = await api("POST", `/orders/${pD.id}/cancel`, {}, matriz);
  check(ajeno.status === 404, "F1. CEYRO no puede tocar un pedido de STALYN con su propia sesión → 404", mostrar(ajeno));
  const cola = (await api("GET", "/orders/cola-global")).data;
  check(Array.isArray(cola), "F2. la cola global de despachos responde", typeof cola);

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
