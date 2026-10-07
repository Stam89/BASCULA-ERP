// Puntos donde se mueve dinero o inventario: doble clic, cajas cerradas/ajenas, sobregiros y exceso de stock.
// Sobre una COPIA de la base (servidor real en :4001). Cada FAIL es un hueco real.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 220)}`;
const dos = (f) => Promise.all([f(), f()]);
const unico = (rs, ok = [200, 201]) => rs.filter((r) => ok.includes(r.status)).length === 1;

try {
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const bodPT = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS'"))[0].id;
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const stock = async (acc = matriz) => Number((await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_movements WHERE product_id=$1 AND warehouse_id=$2 AND accionista_id=$3", [prod, bodPT, acc]))[0].n);
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',100,'simulacro','OWNED',$3)", [prod, bodPT, matriz]);
  const caja = (await api("POST", "/cash/registers/open", { name: "Caja A", tipo: "EFECTIVO", opening_balance_cash: 1000 })).data;
  const cajaSocio = (await api("POST", "/cash/registers/open", { name: "Caja STALYN", tipo: "EFECTIVO", opening_balance_cash: 500 }, stalyn)).data;
  const cli = (await api("POST", "/customers", { full_name: "CLIENTE DINERO" })).data;
  const saldoCaja = async (id = caja.id, acc = matriz) => r2((await api("GET", `/cash/registers/${id}/summary`, undefined, acc)).data.current_balance);
  const pedido = async (qq, precio = 10) => (await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: prod, inventory_product_id: prod, quantity: qq, unit_price: precio }] })).data;

  // ── Inventario ──────────────────────────────────────────────────────────
  const gordo = await pedido(5000);
  const prepGordo = await api("PATCH", `/orders/${gordo.id}/prepare`, { prepared: true, warehouse_id: bodPT });
  check(!prepGordo.ok || (await stock()) >= -0.001, "INV1. preparar un pedido de 5000 QQ con solo 100 en bodega NO deja el inventario en negativo", { status: prepGordo.status, stock: await stock() });
  if (prepGordo.ok) await api("PATCH", `/orders/${gordo.id}/prepare`, { prepared: false });

  const p1 = await pedido(10);
  const [pa, pb] = await dos(() => api("PATCH", `/orders/${p1.id}/prepare`, { prepared: true, warehouse_id: bodPT }));
  check(r2(100 - (await stock())) === 10, "INV2. preparar el mismo pedido dos veces a la vez descuenta UNA sola vez", { descontado: r2(100 - (await stock())), r: [pa.status, pb.status] });
  const [ca, cb] = await dos(() => api("PATCH", `/orders/${p1.id}/prepare`, { prepared: false }));
  check(r2(await stock()) === 100, "INV3. revertir la preparación dos veces a la vez devuelve UNA sola vez", { stock: await stock(), r: [ca.status, cb.status] });

  // ── Despacho y cobro ────────────────────────────────────────────────────
  await api("PATCH", `/orders/${p1.id}/prepare`, { prepared: true, warehouse_id: bodPT });
  const [da, db] = await dos(() => api("POST", `/orders/${p1.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: bodPT }));
  check(unico([da, db]), "DESP1. despachar el mismo pedido dos veces a la vez cobra UNA sola vez", [da.status, db.status]);
  check((await saldoCaja()) === 1100, "DESP2. la caja recibió $100 una sola vez", { saldo: await saldoCaja() });

  // despachar al contado hacia una caja AJENA o cerrada
  const p2 = await pedido(5);
  await api("PATCH", `/orders/${p2.id}/prepare`, { prepared: true, warehouse_id: bodPT });
  const ajena = await api("POST", `/orders/${p2.id}/deliver`, { payment_method: "CASH", cash_register_id: cajaSocio.id, warehouse_id: bodPT });
  check(!ajena.ok, "DESP3. despachar cobrando en la caja de OTRO socio se rechaza", mostrar(ajena));
  await api("POST", `/cash/registers/${cajaSocio.id}/close`, {}, stalyn);

  // ── Cuentas por cobrar ──────────────────────────────────────────────────
  const p3 = await pedido(8);
  await api("PATCH", `/orders/${p3.id}/prepare`, { prepared: true, warehouse_id: bodPT });
  await api("POST", `/orders/${p3.id}/deliver`, { payment_method: "CREDIT", warehouse_id: bodPT });
  const cuentas = (await api("GET", "/receivable")).data;
  const lista = Array.isArray(cuentas) ? cuentas : cuentas.rows ?? [];
  const cxc = lista.find((a) => Number(a.balance) > 0 && /CLIENTE DINERO/.test(a.customer_name ?? ""));
  const saldo0 = await saldoCaja();
  const [xa, xb] = await dos(() => api("POST", `/receivable/${cxc.id}/pay`, { amount: Number(cxc.balance), cash_register_id: caja.id }));
  check(unico([xa, xb]) && r2((await saldoCaja()) - saldo0) === r2(cxc.balance), "CXC1. cobrar la misma cuenta completa dos veces a la vez cobra UNA sola vez", { r: [xa.status, xb.status], entro: r2((await saldoCaja()) - saldo0), cuenta: cxc.balance });
  const p4 = await pedido(4);
  await api("PATCH", `/orders/${p4.id}/prepare`, { prepared: true, warehouse_id: bodPT });
  await api("POST", `/orders/${p4.id}/deliver`, { payment_method: "CREDIT", warehouse_id: bodPT });
  const cxc2 = ((await api("GET", "/receivable")).data).find?.((a) => Number(a.balance) > 0 && /CLIENTE DINERO/.test(a.customer_name ?? "")) ?? null;
  const exceso = await api("POST", `/receivable/${cxc2.id}/pay`, { amount: Number(cxc2.balance) + 50, cash_register_id: caja.id });
  check(!exceso.ok, "CXC2. cobrar $50 más de lo que debe el cliente se rechaza", mostrar(exceso));
  const cerrada = await api("POST", "/cash/registers/open", { name: "Caja B", tipo: "EFECTIVO", opening_balance_cash: 0 }, stalyn);
  await api("POST", `/cash/registers/${cerrada.data.id}/close`, {}, stalyn);
  const aCerrada = await api("POST", `/receivable/${cxc2.id}/pay`, { amount: 1, cash_register_id: cerrada.data.id });
  check(!aCerrada.ok, "CXC3. cobrar hacia una caja AJENA o CERRADA se rechaza", mostrar(aCerrada));

  // ── Cuentas por pagar ───────────────────────────────────────────────────
  const ap = (await q("INSERT INTO accounts_payable (accionista_id, amount, balance, status, reference_type, description) VALUES ($1, 200, 200, 'CONFIRMED', 'purchase', 'Proveedor simulacro') RETURNING id", [matriz]))[0];
  const s1 = await saldoCaja();
  const [qa, qb] = await dos(() => api("POST", `/cash/payables/${ap.id}/pay`, { cash_register_id: caja.id, amount: 200 }));
  check(unico([qa, qb]) && r2(s1 - (await saldoCaja())) === 200, "CXP1. pagar la misma cuenta completa dos veces a la vez paga UNA sola vez", { r: [qa.status, qb.status], salio: r2(s1 - (await saldoCaja())) });
  const ap2 = (await q("INSERT INTO accounts_payable (accionista_id, amount, balance, status, reference_type, description) VALUES ($1, 100, 100, 'CONFIRMED', 'purchase', 'Proveedor 2') RETURNING id", [matriz]))[0];
  const aPagarCerrada = await api("POST", `/cash/payables/${ap2.id}/pay`, { cash_register_id: cerrada.data.id, amount: 10 });
  check(!aPagarCerrada.ok, "CXP2. pagar desde una caja AJENA o CERRADA se rechaza", mostrar(aPagarCerrada));
  const sobre = await api("POST", `/cash/payables/${ap2.id}/pay`, { cash_register_id: caja.id, amount: 5000 });
  check(!sobre.ok, "CXP3. pagar más de lo que se debe se rechaza", mostrar(sobre));

  // ── Otros egresos con una caja AJENA/CERRADA (no deben aceptarse) ─────────
  const agri = (await q("SELECT id FROM farmers LIMIT 1"))[0].id;
  const rechazo = async (nombre, r) => check(!r.ok && r.status !== 500, `AJENA. ${nombre} con la caja de otro socio / cerrada se rechaza`, mostrar(r));
  await rechazo("anticipo a un agricultor", await api("POST", "/advances", { farmer_id: agri, amount: 10, concept: "prueba", cash_register_id: cerrada.data.id }));
  await rechazo("gasto operativo", await api("POST", "/expenses", { amount: 10, description: "prueba gasto", cash_register_id: cerrada.data.id }));
  await rechazo("anticipo a un trabajador de planta", await api("POST", "/labor/advances", { worker_role: "PILADOR", worker_name: "PRUEBA", amount: 10, cash_register_id: cerrada.data.id }));
  await rechazo("pago a un trabajador de planta", await api("POST", "/labor/pay-worker", { worker_role: "PILADOR", worker_name: "PRUEBA", from: "2026-01-01", to: "2026-12-31", cash_register_id: cerrada.data.id }));
  await rechazo("pago de bajada de carro", await api("POST", "/cuadrilla/bajadas/pagar", { cash_register_id: cerrada.data.id }));
  // Y con la caja correcta y abierta, lo normal sigue funcionando
  const bien = await api("POST", "/expenses", { amount: 12, description: "gasto normal", cash_register_id: caja.id });
  check(bien.status === 201, "AJENA2. un gasto con la caja correcta sigue funcionando", mostrar(bien));
  const bienAnt = await api("POST", "/advances", { farmer_id: agri, amount: 20, concept: "anticipo normal", cash_register_id: caja.id });
  check(bienAnt.status === 201, "AJENA3. un anticipo con la caja correcta sigue funcionando", mostrar(bienAnt));

  // ── Caja ────────────────────────────────────────────────────────────────
  const sg = await saldoCaja();
  const gasto = await api("POST", "/cash/movements", { cash_register_id: caja.id, movement: "EXPENSE", category: "OTROS", amount: sg + 5000, description: "Sobregiro simulacro" });
  check(!gasto.ok, "CAJA1. un egreso mayor al dinero que hay en la caja se rechaza (no queda saldo negativo)", { status: gasto.status, saldo: await saldoCaja() });
  const mov = (await api("POST", "/cash/movements", { cash_register_id: caja.id, movement: "EXPENSE", category: "OTROS", amount: 15, description: "Para reversar" })).data;
  const [ra, rb] = await dos(() => api("POST", `/cash/movements/${mov.id}/reverse`, { reason: "doble clic" }));
  check(unico([ra, rb]) && (await q("SELECT count(*)::int n FROM cash_movements WHERE reversal_of=$1", [mov.id]))[0].n === 1, "CAJA2. reversar el mismo movimiento dos veces a la vez lo reversa UNA sola vez", [ra.status, rb.status]);
  const [ka, kb] = await dos(() => api("POST", `/cash/registers/${caja.id}/close`, {}));
  check(unico([ka, kb]), "CAJA3. cerrar la caja dos veces a la vez responde bien (una cierra, la otra avisa)", [ka.status, kb.status]);
  const trasCierre = await api("POST", "/cash/movements", { cash_register_id: caja.id, movement: "INCOME", category: "OTROS", amount: 10 });
  check(!trasCierre.ok, "CAJA4. no se puede registrar movimientos en una caja ya cerrada", mostrar(trasCierre));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
