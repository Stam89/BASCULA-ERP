// 🚫 Anular una venta YA despachada: arroz y sacos vuelven, dinero (contado/crédito), flete y cargo de
// empaque, cuadrilla, protecciones. SOLO contra la copia (sim_base aborta si no). Aplica la migración si falta.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const SOBRE = { "x-confirmar": "SOBREGIRO" };

try {
  if (!(await q("SELECT 1 FROM information_schema.columns WHERE table_name='sales_orders' AND column_name='anulado_at'")).length) {
    await q(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261079_anular_venta.sql"), "utf8"));
    console.log("   (info) migración 20261079 aplicada en la COPIA");
  }
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-OSO'"))[0].id;
  const bodPT = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS'"))[0].id;
  const p25 = (await q("SELECT id, name FROM product_presentations WHERE product_id=$1 AND weight_lb=25 LIMIT 1", [prod]))[0];
  const p100 = (await q("SELECT id, name FROM product_presentations WHERE product_id=$1 AND weight_lb=100 LIMIT 1", [prod]))[0];
  const carro = (await q("SELECT id FROM campo_activos WHERE activo AND tipo <> 'cosechadora' ORDER BY nombre LIMIT 1"))[0].id;
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',200,'simulacro','OWNED',$3)", [prod, bodPT, stalyn]);
  const abrir = async (n) => exigir(await api("POST", "/cash/registers/open", { name: n, tipo: "EFECTIVO", opening_balance_cash: 2000 }, stalyn), `abrir ${n}`);
  let caja = await abrir("Caja STALYN 1");
  const saldo = async (c = caja) => r2((await api("GET", `/cash/registers/${c.id}/summary`, undefined, stalyn)).data.current_balance);
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE ANULAR VENTA" }, stalyn), "0. cliente");
  const stock = async () => r2((await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_movements WHERE product_id=$1 AND accionista_id=$2", [prod, stalyn]))[0].n);
  const sacos = async (peso) => r2((await q("SELECT COALESCE(sum(stock),0)::float n FROM sack_inventory WHERE categoria='MARCA' AND upper(marca)='OSO' AND peso_lb=$1", [peso]))[0]?.n ?? 0);
  const vender = async (qq, pres, metodo = "CASH", extra = {}) => {
    const p = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: prod, inventory_product_id: prod, presentation_id: pres?.id, presentation_name: pres?.name, quantity: qq, unit_price: 30 }] }, stalyn), `pedido ${qq} QQ`);
    exigir(await api("PATCH", `/orders/${p.id}/prepare`, { prepared: true, warehouse_id: bodPT }, stalyn), "preparar");
    const d = exigir(await api("POST", `/orders/${p.id}/deliver`, { payment_method: metodo, cash_register_id: metodo === "CREDIT" ? undefined : caja.id, warehouse_id: bodPT, ...extra }, stalyn, SOBRE), `despachar (${metodo})`);
    return { ...p, sale: d.sale };
  };
  const anular = (p, extra = {}) => api("POST", `/orders/${p.id}/anular-despacho`, { motivo: "El cliente devolvió la carga", ...extra }, stalyn, SOBRE);

  // ── A. Contado con flete de Transporte y cargo de empaque (sacos de 25 lb) ──
  const st0 = await stock(), sa0 = await sacos(25), c0 = await saldo();
  const A = await vender(4, p25, "CASH", { flete: { activo_id: carro, monto: 12 } });
  const cargo = (await q("SELECT * FROM matriz_packaging_charges WHERE order_id=$1", [A.id]))[0];
  check(r2(st0 - await stock()) === 4 && r2(sa0 - await sacos(25)) === 16 && r2(await saldo() - c0) === 120, "A0. vendido: salen 4 QQ, 16 sacos y entran $120 a la caja");
  check((await api("POST", `/orders/${A.id}/anular-despacho`, { motivo: "no" }, stalyn)).status === 400, "A1. sin motivo (≥5 letras) → 400");
  const rA = exigir(await anular(A), "A2. anular la venta al contado");
  check(rA.devolucion?.tipo === "anulado_en_caja", "A3. el ingreso se anula en la misma caja (sigue abierta)", rA.devolucion);
  check(await stock() === st0 && await sacos(25) === sa0 && await saldo() === c0, "A4. vuelven el arroz, los sacos y el dinero (la caja queda como antes)", { stock: [st0, await stock()], sacos: [sa0, await sacos(25)], caja: [c0, await saldo()] });
  const ordA = (await q("SELECT status, anulado_motivo, anulado_at, flete_servicio_id FROM sales_orders WHERE id=$1", [A.id]))[0];
  const venA = (await q("SELECT sale_status FROM sales WHERE id=$1", [A.sale.id]))[0];
  check(ordA.status === "CANCELLED" && ordA.anulado_motivo && ordA.anulado_at && venA.sale_status === "CANCELLED", "A5. pedido y venta quedan ANULADOS con motivo y fecha (no se borran)", { ordA, venA });
  check(!ordA.flete_servicio_id && !(await q("SELECT 1 FROM campo_servicios WHERE origen_tipo='venta_flete' AND origen_id=$1", [A.id])).length, "A6. el flete de Transporte se quitó");
  if (cargo) {
    const ar = (await q("SELECT status, balance::float b FROM accounts_receivable WHERE id=$1", [cargo.receivable_id]))[0];
    const ap = (await q("SELECT status, balance::float b FROM accounts_payable WHERE id=$1", [cargo.payable_id]))[0];
    check(ar.status === "CANCELLED" && ap.status === "CANCELLED" && ar.b === 0 && ap.b === 0, "A7. el cargo de empaque se anula en los dos lados (CEYRO y STALYN)", { ar, ap });
  }
  const lista = (await api("GET", "/sales", undefined, stalyn)).data.find((x) => x.id === A.sale.id);
  check(lista?.sale_status === "CANCELLED", "A8. «Ventas realizadas» la muestra anulada", lista?.sale_status);
  check((await anular(A)).status === 409, "A9. anularla otra vez → 409");

  // ── B. Crédito sin abonos ────────────────────────────────────────────────
  const cB = await saldo();
  const B = await vender(3, p100, "CREDIT");
  exigir(await anular(B), "B1. anular venta a crédito");
  const arB = (await q("SELECT a.status, a.balance::float b FROM accounts_receivable a JOIN sales_orders o ON o.receivable_id=a.id WHERE o.id=$1", [B.id]))[0];
  check(arB.status === "CANCELLED" && arB.b === 0 && await saldo() === cB, "B2. su cuenta por cobrar se anula y la caja no se mueve", { arB, caja: [cB, await saldo()] });

  // ── C. Crédito con abono: primero se anula el abono ──────────────────────
  const C = await vender(2, p100, "CREDIT");
  const arC = (await q("SELECT a.id FROM accounts_receivable a JOIN sales_orders o ON o.receivable_id=a.id WHERE o.id=$1", [C.id]))[0];
  exigir(await api("POST", `/receivable/${arC.id}/pay`, { amount: 20, cash_register_id: caja.id }, stalyn), "C0. el cliente abona $20");
  check((await anular(C)).status === 409, "C1. con abonos no se anula (primero se anulan los abonos) → 409");
  const movAbono = (await q("SELECT id FROM cash_movements WHERE reference_type='accounts_receivable' AND reference_id=$1 AND reversed_at IS NULL", [arC.id]))[0];
  exigir(await api("POST", `/cash/movements/${movAbono.id}/reverse`, { reason: "abono de venta que se anula" }, stalyn), "C2. se anula el abono en Caja");
  exigir(await anular(C), "C3. ahora sí se anula la venta");

  // ── D. Contado cuya caja ya se cerró: la devolución sale de la caja abierta ──
  const D = await vender(2, p100, "CASH");
  const cajaVieja = caja;
  await q("UPDATE cash_registers SET status='CLOSED', closed_at=now() WHERE id=$1", [cajaVieja.id]);
  caja = await abrir("Caja STALYN 2");
  check((await api("POST", `/orders/${D.id}/anular-despacho`, { motivo: "El cliente devolvió la carga" }, stalyn)).status === 409, "D1. con la caja de la venta cerrada y sin elegir otra → 409 (pide la caja)");
  const cD = await saldo();
  const rD = exigir(await anular(D, { cash_register_id: caja.id }), "D2. anular eligiendo la caja abierta");
  const devol = (await q("SELECT category, amount::float a FROM cash_movements WHERE cash_register_id=$1 AND reference_type='sales' AND reference_id=$2", [caja.id, D.sale.id]))[0];
  check(rD.devolucion?.tipo === "devuelto_en_otra_caja" && r2(cD - await saldo()) === 60 && devol?.category === "DEVOLUCION_VENTA", "D3. salen $60 de la caja abierta como DEVOLUCIÓN DE VENTA", { tipo: rD.devolucion?.tipo, mov: devol });

  // ── E. Protecciones ──────────────────────────────────────────────────────
  const E = await vender(2, p100, "CASH", { flete: { activo_id: carro, monto: 8 } });
  const sv = (await q("SELECT id FROM campo_servicios WHERE origen_tipo='venta_flete' AND origen_id=$1", [E.id]))[0];
  const cuenta = (await q("SELECT id FROM campo_cuentas LIMIT 1"))[0].id;
  await q("INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, servicio_id, naturaleza) VALUES (CURRENT_DATE,$1,'entrada',8,'cobro flete simulacro',$2,'cobro')", [cuenta, sv.id])
    .catch(async () => { await q("INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, servicio_id) VALUES (CURRENT_DATE,$1,'entrada',8,'cobro flete simulacro',$2)", [cuenta, sv.id]); });
  const stE = await stock();
  check((await anular(E)).status === 409 && await stock() === stE && (await q("SELECT status FROM sales_orders WHERE id=$1", [E.id]))[0].status === "DELIVERED", "E1. con el flete ya cobrado por Transporte NO se anula y no cambia nada (todo o nada)");
  const pend = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: prod, inventory_product_id: prod, quantity: 1, unit_price: 30 }] }, stalyn), "E2. pedido pendiente");
  check((await anular(pend)).status === 409, "E3. un pedido no despachado no se anula así (se cancela normal) → 409");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
