// Venta de un SOCIO (STALYN) con cargo de empaque de la matriz (CEYRO): pedido → despacho → deuda en espejo → pago.
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
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-OSO'"))[0].id;
  const bodPT = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS'"))[0].id;
  const pres = (await q("SELECT id, weight_lb::float w, name FROM product_presentations WHERE product_id=$1 ORDER BY weight_lb", [prod]));
  const p10 = pres.find((p) => p.w === 10), p25 = pres.find((p) => p.w === 25), p100 = pres.find((p) => p.w === 100);
  // Arroz terminado de STALYN (solo en la copia) y su caja
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',200,'simulacro','OWNED',$3)", [prod, bodPT, stalyn]);
  const cajaS = exigir(await api("POST", "/cash/registers/open", { name: "Caja STALYN", tipo: "EFECTIVO", opening_balance_cash: 800 }, stalyn), "0a. STALYN abre su caja con $800");
  // Si la base real ya tiene la caja de CEYRO abierta (operación del día), se usa esa.
  const abiertaM = await api("POST", "/cash/registers/open", { name: "Caja CEYRO", tipo: "EFECTIVO", opening_balance_cash: 300 });
  const cajaM = abiertaM.ok ? abiertaM.data : (await api("GET", "/cash/registers/current")).data;
  check(!!cajaM?.id, "0b. CEYRO tiene caja abierta");
  const saldo = async (id, acc) => r2((await api("GET", `/cash/registers/${id}/summary`, undefined, acc)).data.current_balance);
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE DE STALYN" }, stalyn), "0c. Cliente de STALYN");
  const tarifa = (await q("SELECT precio_saco_10lb::float a, precio_saco_25lb::float b, precio_saco_50lb::float c FROM matriz_packaging_rates WHERE accionista_id=$1", [matriz]))[0];

  const pedido = async (items) => (await api("POST", "/orders", { customer_id: cli.id, items: items.map((i) => ({ product_id: prod, inventory_product_id: prod, presentation_id: i.p?.id, presentation_name: i.p?.name, quantity: i.qq, unit_price: 30 })) }, stalyn));
  const despachar = async (ped, metodo = "CASH") => {
    await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true, warehouse_id: bodPT }, stalyn);
    return api("POST", `/orders/${ped.id}/deliver`, { payment_method: metodo, cash_register_id: metodo === "CREDIT" ? undefined : cajaS.id, warehouse_id: bodPT }, stalyn);
  };

  // ── A. Cargo por empaque: 10 QQ en 25 lb = 40 bultos × tarifa de 25 lb ──
  const p1 = exigir(await pedido([{ p: p25, qq: 10 }]), "A1. STALYN toma un pedido de 10 QQ en sacos de 25 lb");
  const d1 = exigir(await despachar(p1.data ?? p1), "A2. lo despacha al contado");
  void d1;
  const ch = (await q("SELECT * FROM matriz_packaging_charges WHERE order_id=$1", [p1.id]))[0];
  const esperado = r2(40 * tarifa.b);
  check(!!ch && r2(ch.monto) === esperado, `A3. CEYRO le cobra a STALYN 40 bultos × $${tarifa.b} = $${esperado}`, ch && { monto: ch.monto, esperado });
  const arC = (await q("SELECT * FROM accounts_receivable WHERE id=$1", [ch.receivable_id]))[0];
  const apC = (await q("SELECT * FROM accounts_payable WHERE id=$1", [ch.payable_id]))[0];
  check(arC.accionista_id === matriz && apC.accionista_id === stalyn && r2(arC.amount) === esperado && r2(apC.amount) === esperado, "A4. nace por cobrar de CEYRO y por pagar de STALYN (espejo), por el mismo monto");

  // ── B. Tramos y casos sin cargo ────────────────────────────────────────
  const cant0 = (await q("SELECT count(*)::int n FROM matriz_packaging_charges"))[0].n;
  const p2 = exigir(await pedido([{ p: p100, qq: 5 }]), "B1. Pedido de 5 QQ en sacos de 100 lb (saco estándar)");
  await despachar(p2);
  check((await q("SELECT count(*)::int n FROM matriz_packaging_charges"))[0].n === cant0, "B2. el saco de 100 lb NO genera cargo de empaque");
  const p3 = exigir(await pedido([{ p: p10, qq: 2 }, { p: p25, qq: 3 }]), "B3. Pedido mixto: 2 QQ en 10 lb + 3 QQ en 25 lb");
  await despachar(p3);
  const ch3 = (await q("SELECT * FROM matriz_packaging_charges WHERE order_id=$1", [p3.id]))[0];
  const esp3 = r2(20 * tarifa.a + 12 * tarifa.b);
  check(ch3 && r2(ch3.monto) === esp3, `B4. cargo mixto = 20 bultos × $${tarifa.a} + 12 bultos × $${tarifa.b} = $${esp3}`, ch3 && ch3.monto);
  // La MATRIZ vendiendo no se cobra a sí misma
  const stockM = (await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_stock WHERE product_id=$1 AND accionista_id=$2", [prod, matriz]))[0].n;
  void stockM;

  // ── C. Doble despacho: un solo cargo ───────────────────────────────────
  const p4 = exigir(await pedido([{ p: p25, qq: 4 }]), "C1. Otro pedido de 4 QQ en 25 lb");
  await api("PATCH", `/orders/${p4.id}/prepare`, { prepared: true, warehouse_id: bodPT }, stalyn);
  const [x1, x2] = await dos(() => api("POST", `/orders/${p4.id}/deliver`, { payment_method: "CASH", cash_register_id: cajaS.id, warehouse_id: bodPT }, stalyn));
  check([x1, x2].filter((r) => r.ok).length === 1 && (await q("SELECT count(*)::int n FROM matriz_packaging_charges WHERE order_id=$1", [p4.id]))[0].n === 1, "C2. despachar dos veces a la vez crea UN solo cargo", [x1.status, x2.status]);

  // ── D. STALYN paga el cargo: se refleja en los dos lados ───────────────
  const sS0 = await saldo(cajaS.id, stalyn), sM0 = await saldo(cajaM.id, matriz);
  const pago = await api("POST", `/cash/payables/${ch.payable_id}/pay`, { cash_register_id: cajaS.id, amount: esperado }, stalyn);
  check(pago.ok, "D1. STALYN paga el cargo de empaque desde su caja", mostrar(pago));
  const arD = (await q("SELECT balance::float b, status FROM accounts_receivable WHERE id=$1", [ch.receivable_id]))[0];
  const apD = (await q("SELECT balance::float b, status FROM accounts_payable WHERE id=$1", [ch.payable_id]))[0];
  check(arD.b === 0 && apD.b === 0 && arD.status === "PAID" && apD.status === "PAID", "D2. quedan saldadas las DOS cuentas (por cobrar de CEYRO y por pagar de STALYN)", { cxc: arD, cxp: apD });
  check(r2(sS0 - (await saldo(cajaS.id, stalyn))) === esperado, "D3. el dinero sale de la caja de STALYN", r2(sS0 - (await saldo(cajaS.id, stalyn))));
  check(r2((await saldo(cajaM.id, matriz)) - sM0) === esperado, "D4. y ENTRA a la caja de CEYRO (mismo monto)", r2((await saldo(cajaM.id, matriz)) - sM0));
  const doblePago = await api("POST", `/cash/payables/${ch.payable_id}/pay`, { cash_register_id: cajaS.id, amount: 1 }, stalyn);
  check(!doblePago.ok, "D5. pagar de nuevo un cargo ya saldado se rechaza", doblePago.status);

  // ── E. Cobro desde el lado de CEYRO (por cobrar) refleja en el socio ───
  const arE = (await q("SELECT id, balance::float b FROM accounts_receivable WHERE id=$1", [ch3.receivable_id]))[0];
  const apE = (await q("SELECT id FROM accounts_payable WHERE id=$1", [ch3.payable_id]))[0];
  const cobro = await api("POST", `/receivable/${arE.id}/pay`, { amount: 1, cash_register_id: cajaM.id });
  const apE2 = (await q("SELECT balance::float b FROM accounts_payable WHERE id=$1", [apE.id]))[0].b;
  check(cobro.ok && apE2 === r2(arE.b - 1), "E1. si CEYRO cobra $1, la deuda por pagar de STALYN baja también", { cobro: cobro.status, suPorPagar: apE2, esperado: r2(arE.b - 1) });

  // ── F. La matriz vende: no se cobra empaque a sí misma ─────────────────
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',50,'simulacro','OWNED',$3)", [prod, bodPT, matriz]);
  const cliM = exigir(await api("POST", "/customers", { full_name: "CLIENTE DE CEYRO" }), "F0. Cliente de CEYRO");
  const pm = exigir(await api("POST", "/orders", { customer_id: cliM.id, items: [{ product_id: prod, inventory_product_id: prod, presentation_id: p25.id, presentation_name: p25.name, quantity: 5, unit_price: 30 }] }), "F1. CEYRO toma un pedido de 5 QQ en 25 lb");
  await api("PATCH", `/orders/${pm.id}/prepare`, { prepared: true, warehouse_id: bodPT });
  const dm = await api("POST", `/orders/${pm.id}/deliver`, { payment_method: "CASH", cash_register_id: cajaM.id, warehouse_id: bodPT });
  check(dm.ok && (await q("SELECT count(*)::int n FROM matriz_packaging_charges WHERE order_id=$1", [pm.id]))[0].n === 0, "F2. CEYRO no se cobra empaque a sí misma", mostrar(dm));

  // ── Consistencia global ────────────────────────────────────────────────
  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. las ${TOTAL_REGLAS} reglas de consistencia se cumplen después de todo esto`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
