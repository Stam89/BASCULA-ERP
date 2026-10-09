// 📅 Ensayo del CIERRE DE MES sobre la COPIA: se registran operaciones con montos conocidos y se comprueba que
// Estado de Resultados, Balance, Flujo de caja y Resultado mensual las reflejan IGUAL (y cuadran entre sí).
// SOLO contra la copia (sim_base aborta si no).
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const SOBRE = { "x-confirmar": "SOBREGIRO" };
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const ayer = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const [anio, mes] = hoy.split("-").map(Number);

try {
  const er = async () => exigir(await api("GET", `/finance/income-statement?desde=${hoy}&hasta=${hoy}`), "estado de resultados");
  const bal = async (h = hoy) => exigir(await api("GET", `/finance/balance?hasta=${h}`), `balance al ${h}`);
  const flujo = async () => exigir(await api("GET", `/finance/cash-flow?desde=${hoy}&hasta=${hoy}`), "flujo de caja");
  const rm = async () => exigir(await api("GET", `/resultado-mensual?year=${anio}&month=${mes}`), "resultado mensual");
  const er0 = await er(), bAyer0 = await bal(ayer), f0 = await flujo(), rm0 = await rm();
  const costoPt = (await bal()).activo.corriente.inventario_detalle.costo_qq_terminado;

  // ── Operaciones del día con montos conocidos ──
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja cierre de mes", tipo: "MIXTO", opening_balance_cash: 1000, opening_balance_bank: 0 }), "0. abrir caja");
  const saldoCaja = async () => r2((await api("GET", `/cash/registers/${caja.id}/summary`)).data.current_balance);
  const mov = async (movement, category, amount, txt) => exigir(await api("POST", "/cash/movements", { cash_register_id: caja.id, movement, category, amount, description: txt }, matriz, SOBRE), txt);
  const catGasto = "GAS";
  await mov("EXPENSE", catGasto, 100, `1. gasto operativo $100 (${catGasto})`);
  await mov("EXPENSE", "PAGO_MANO_OBRA", 50, "2. pago de mano de obra $50");
  await mov("EXPENSE", "PAGO_ENTRE_SOCIOS", 40, "3. pago entre socios $40 (no es gasto)");
  const errado = await mov("EXPENSE", catGasto, 30, "4. gasto registrado por error $30");
  exigir(await api("POST", `/cash/movements/${errado.id}/reverse`, { reason: "registrado por error" }), "4b. se anula el gasto de $30");

  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-OSO'"))[0].id;
  const bodPT = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS'"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',20,'simulacro','OWNED',$3)", [prod, bodPT, matriz]);
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE CIERRE DE MES" }), "5a. cliente");
  const ped = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: prod, inventory_product_id: prod, quantity: 2, unit_price: 30 }] }), "5b. pedido 2 QQ × $30");
  exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true, warehouse_id: bodPT }), "5c. preparar");
  exigir(await api("POST", `/orders/${ped.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: bodPT }, matriz, SOBRE), "5d. despachar al contado ($60)");
  exigir(await api("POST", "/inventory/adjustments", { product_id: prod, warehouse_id: bodPT, quantity: -0.5, ownership: "OWNED", notes: "Venta al detalle: 0.5 QQ simulacro" }), "6a. venta al detalle: sale 0.5 QQ");
  await mov("INCOME", "VENTA", 20, "6b. venta al detalle: entran $20");
  exigir(await api("POST", "/inventory/adjustments", { product_id: prod, warehouse_id: bodPT, quantity: -1, ownership: "OWNED", notes: "Merma por humedad (simulacro)" }), "7. merma de 1 QQ (no es venta)");
  await q("INSERT INTO accounts_receivable (accionista_id, reference_type, description, amount, balance, status) VALUES ($1,'secado_service','simulacro secado',25,25,'CONFIRMED')", [matriz]);

  // ── Estado de resultados del día ──
  const er1 = await er();
  const d = (a, b) => r2(a - b);
  check(d(er1.gastos_operativos.gastos_generales, er0.gastos_operativos.gastos_generales) === 100,
    "A1. gastos generales +$100 (sin el anulado ni el pago entre socios)", { antes: er0.gastos_operativos.gastos_generales, ahora: er1.gastos_operativos.gastos_generales });
  check(d(er1.gastos_operativos.mano_obra, er0.gastos_operativos.mano_obra) === 50, "A2. mano de obra +$50 (antes salía siempre $0)", er1.gastos_operativos.mano_obra);
  check(d(er1.ingresos.ventas, er0.ingresos.ventas) === 80 && d(er1.ingresos.ventas_detalle, er0.ingresos.ventas_detalle ?? 0) === 20,
    "A3. ventas +$80 = pedido $60 + venta al detalle $20 (antes el detalle no contaba)", er1.ingresos);
  check(d(er1.ingresos.servicio_pilado, er0.ingresos.servicio_pilado) === 25, "A4. servicios +$25 (el secado ya cuenta, no solo el pilado)", er1.ingresos.servicio_pilado);
  check(d(er1.costo_ventas.mercaderia_vendida, er0.costo_ventas.mercaderia_vendida) === r2(2.5 * costoPt),
    `A5. costo de ventas = 2.5 QQ vendidos × $${costoPt} (la merma y la cáscara al molino NO son venta)`, { delta: d(er1.costo_ventas.mercaderia_vendida, er0.costo_ventas.mercaderia_vendida), esperado: r2(2.5 * costoPt) });

  // ── Resultado mensual (Costos Operativos) cuadra con el Estado de Resultados ──
  const rm1 = await rm();
  check(d(rm1.total_costos, rm0.total_costos) === 150, "B1. el Resultado mensual sube los mismos $150 de costos (gasto + mano de obra)", { antes: rm0.total_costos, ahora: rm1.total_costos });

  // ── Flujo de caja y balance ──
  const f1 = await flujo();
  const neto = r2(60 + 20 + 30 - 100 - 50 - 40 - 30);
  check(d(f1.flujo_neto, f0.flujo_neto) === neto, `B2. flujo de caja del día: ${neto} (incluye el gasto anulado y su reverso)`, { antes: f0.flujo_neto, ahora: f1.flujo_neto });
  const sCaja = await saldoCaja();
  const b1 = await bal();
  check(r2(b1.activo.corriente.efectivo + b1.activo.corriente.bancos) === sCaja && sCaja === r2(1000 + neto), "B3. caja y bancos del balance = saldo de la caja", { balance: b1.activo.corriente, caja: sCaja });
  check(b1.cuadre === 0, "B4. balance cuadrado (activo = pasivo + patrimonio)", b1.cuadre);
  const cxc = r2((await q("SELECT COALESCE(sum(balance),0)::float v FROM accounts_receivable WHERE accionista_id=$1 AND status IN ('CONFIRMED','PARTIAL') AND balance>0", [matriz]))[0].v);
  check(b1.activo.corriente.cuentas_por_cobrar === cxc, "B5. cuentas por cobrar del balance = suma de Por Cobrar", { balance: b1.activo.corriente.cuentas_por_cobrar, cxc });

  // ── Cerrar la caja (fin de mes) ──
  exigir(await api("POST", `/cash/registers/${caja.id}/close`, { closing_balance: sCaja }), "C1. cerrar la caja a fin de mes");
  const b2 = await bal();
  check(r2(b2.activo.corriente.efectivo + b2.activo.corriente.bancos) === sCaja, "C2. con la caja CERRADA el dinero sigue en el balance (antes quedaba en $0)", b2.activo.corriente);
  const bAyer1 = await bal(ayer);
  check(bAyer1.activo.corriente.inventario === bAyer0.activo.corriente.inventario && r2(bAyer1.activo.corriente.efectivo + bAyer1.activo.corriente.bancos) === r2(bAyer0.activo.corriente.efectivo + bAyer0.activo.corriente.bancos),
    "C3. el balance de AYER no cambia por lo de hoy (caja e inventario a la fecha del corte)", { ayer_antes: bAyer0.activo.corriente.inventario, ayer_ahora: bAyer1.activo.corriente.inventario });
  check(bAyer1.cuentas_al_dia_de_hoy === true && b2.cuentas_al_dia_de_hoy === false, "C4. un balance a fecha pasada avisa que las cuentas son al día de hoy");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
