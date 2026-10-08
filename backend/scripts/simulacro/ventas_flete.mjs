// Ventas y despachos + FLETE de venta con carro de Transporte y Cosechadora (se le cobra al que vende).
// SOLO contra la copia (sim_base aborta si no). Aplica la migración 20261078 en la copia si falta.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen, COPIA } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  if ((await q("SELECT current_database() AS d"))[0].d !== COPIA) throw new Error("no es la copia");
  if (!(await q("SELECT 1 FROM information_schema.columns WHERE table_name='sales_orders' AND column_name='flete_servicio_id'")).length) {
    await q(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261078_flete_venta.sql"), "utf8"));
    console.log("   (info) migración 20261078 aplicada en la COPIA");
  }
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const ceyro = (await q("SELECT name FROM accionistas WHERE id=$1", [matriz]))[0].name;
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-OSO'"))[0].id;
  const bodPT = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS'"))[0].id;
  const p100 = (await q("SELECT id, name FROM product_presentations WHERE product_id=$1 AND weight_lb=100 LIMIT 1", [prod]))[0];
  const carro = (await q("SELECT id, nombre, placa_codigo, operador FROM campo_activos WHERE activo AND tipo <> 'cosechadora' ORDER BY nombre LIMIT 1"))[0];
  const otroCarro = (await q("SELECT id, nombre FROM campo_activos WHERE activo AND tipo <> 'cosechadora' AND id <> $1 ORDER BY nombre LIMIT 1", [carro.id]))[0] ?? carro;
  const cosechadora = (await q("SELECT id FROM campo_activos WHERE tipo='cosechadora' LIMIT 1"))[0]?.id;
  for (const acc of [stalyn, matriz]) {
    await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id) VALUES ($1,$2,'IN',300,'simulacro','OWNED',$3)", [prod, bodPT, acc]);
  }
  const abrirCaja = async (acc, nombre) => {
    const r = await api("POST", "/cash/registers/open", { name: nombre, tipo: "EFECTIVO", opening_balance_cash: 500 }, acc);
    if (r.ok) return r.data;
    return (await api("GET", "/cash/registers/current", undefined, acc)).data;
  };
  const cajaS = await abrirCaja(stalyn, "Caja STALYN"), cajaM = await abrirCaja(matriz, "Caja CEYRO");
  check(!!cajaS?.id && !!cajaM?.id, "0. cajas abiertas de STALYN y CEYRO");
  const saldo = async (id, acc) => r2((await api("GET", `/cash/registers/${id}/summary`, undefined, acc)).data.current_balance);
  const cliS = exigir(await api("POST", "/customers", { full_name: "CLIENTE FLETE STALYN" }, stalyn), "0b. cliente de STALYN");
  const cliM = exigir(await api("POST", "/customers", { full_name: "CLIENTE FLETE CEYRO" }), "0c. cliente de CEYRO");
  const pedido = async (acc, cli, qq, precio = 30) => exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: prod, inventory_product_id: prod, presentation_id: p100?.id, presentation_name: p100?.name, quantity: qq, unit_price: precio }] }, acc), `pedido de ${qq} QQ`);
  const preparar = async (ped, acc) => exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true, warehouse_id: bodPT }, acc), "preparar");
  const despachar = (ped, acc, caja, extra = {}, metodo = "CASH") => api("POST", `/orders/${ped.id}/deliver`, { payment_method: metodo, cash_register_id: metodo === "CREDIT" ? undefined : caja?.id, warehouse_id: bodPT, ...extra }, acc);
  const servicioDe = async (orderId) => (await q("SELECT s.*, c.nombre cliente FROM campo_servicios s JOIN campo_clientes c ON c.id=s.cliente_id WHERE s.origen_tipo='venta_flete' AND s.origen_id=$1", [orderId]))[0];
  const espejoDe = async (servId) => (await q("SELECT * FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [servId]))[0];

  // ── A. Despacho de un SOCIO con flete de un carro de Transporte ─────────────
  const pA = await pedido(stalyn, cliS, 20);
  await preparar(pA, stalyn);
  const sS0 = await saldo(cajaS.id, stalyn);
  const dA = exigir(await despachar(pA, stalyn, cajaS, { flete: { activo_id: carro.id, monto: 40 } }), `A1. STALYN despacha 20 QQ al contado con flete de ${carro.nombre} ($40)`);
  check(dA.flete && r2(dA.flete.monto) === 40 && dA.flete.activo_nombre === carro.nombre, "A2. la respuesta trae el flete registrado", dA.flete);
  const svA = await servicioDe(pA.id);
  check(svA && svA.cliente === "STALYN" && r2(svA.valor) === 40 && svA.tipo === "flete" && svA.activo_id === carro.id && r2(svA.qq) === 20 && r2(svA.precio_unitario) === 2,
    "A3. Transporte y Cosechadora tiene la cuenta por cobrar contra STALYN (flete, 20 QQ × $2)", svA && { cliente: svA.cliente, valor: svA.valor, qq: svA.qq, pu: svA.precio_unitario });
  const apA = await espejoDe(svA.id);
  check(apA && apA.accionista_id === stalyn && r2(apA.amount) === 40 && r2(apA.balance) === 40 && apA.status === "CONFIRMED", "A4. STALYN tiene la cuenta por pagar espejo por $40", apA && { monto: apA.amount, saldo: apA.balance });
  check(r2((await saldo(cajaS.id, stalyn)) - sS0) === 600, "A5. la venta entra completa a la caja de STALYN ($600): el flete NO se descuenta de la venta", r2((await saldo(cajaS.id, stalyn)) - sS0));
  const ordA = (await q("SELECT flete_activo_id, flete_monto::float m, flete_servicio_id, vehiculo_placa, transportista_nombre, status FROM sales_orders WHERE id=$1", [pA.id]))[0];
  check(ordA.status === "DELIVERED" && ordA.flete_activo_id === carro.id && ordA.m === 40 && ordA.flete_servicio_id === svA.id, "A6. el pedido recuerda su flete", ordA);
  check(!carro.placa_codigo || ordA.vehiculo_placa === carro.placa_codigo, "A7. la guía toma la placa del carro", { placa: ordA.vehiculo_placa, carro: carro.placa_codigo });
  const listaA = (await api("GET", "/orders", undefined, stalyn)).data.find((o) => o.id === pA.id);
  check(listaA && listaA.flete_activo_nombre === carro.nombre && Number(listaA.flete_monto) === 40 && Number(listaA.flete_cobrado) === 0, "A8. la lista de pedidos muestra carro, valor y lo cobrado", listaA && { c: listaA.flete_activo_nombre, m: listaA.flete_monto, cob: listaA.flete_cobrado });

  // ── B. Validaciones: si el flete es inválido, el despacho completo NO ocurre ──
  const pB = await pedido(stalyn, cliS, 5);
  await preparar(pB, stalyn);
  const ventas0 = (await q("SELECT count(*)::int n FROM sales"))[0].n;
  check((await despachar(pB, stalyn, cajaS, { flete: { activo_id: carro.id, monto: 0 } })).status === 400, "B1. flete de $0 → 400");
  check((await despachar(pB, stalyn, cajaS, { flete: { monto: 10 } })).status === 400, "B2. flete sin carro → 400");
  if (cosechadora) check((await despachar(pB, stalyn, cajaS, { flete: { activo_id: cosechadora, monto: 10 } })).status === 400, "B3. una cosechadora no lleva fletes → 400");
  check((await despachar(pB, stalyn, cajaS, { flete: { activo_id: "00000000-0000-0000-0000-000000000000", monto: 10 } })).status === 404, "B4. carro inexistente → 404");
  const ordB = (await q("SELECT status FROM sales_orders WHERE id=$1", [pB.id]))[0];
  check(ordB.status !== "DELIVERED" && (await q("SELECT count(*)::int n FROM sales"))[0].n === ventas0, "B5. con flete inválido el pedido sigue sin despachar y no nace ninguna venta (todo o nada)", ordB);

  // ── C. Flete DESPUÉS del despacho: poner, cambiar, quitar ───────────────────
  exigir(await despachar(pB, stalyn, cajaS), "C0. despacho sin flete (como siempre)");
  check(!(await servicioDe(pB.id)), "C1. sin flete no nace nada en Transporte");
  exigir(await api("PUT", `/orders/${pB.id}/flete`, { activo_id: carro.id, monto: 12 }, stalyn), "C2. se registra el flete después ($12)");
  const svC = await servicioDe(pB.id);
  check(svC && r2(svC.valor) === 12 && (await espejoDe(svC.id)), "C3. nace el cobro de Transporte y la Por Pagar de STALYN");
  exigir(await api("PUT", `/orders/${pB.id}/flete`, { activo_id: otroCarro.id, monto: 15 }, stalyn), `C4. se corrige: ${otroCarro.nombre}, $15`);
  const svC2 = await servicioDe(pB.id);
  const quedanC = (await q("SELECT count(*)::int n FROM campo_servicios WHERE origen_tipo='venta_flete' AND origen_id=$1", [pB.id]))[0].n;
  check(svC2 && r2(svC2.valor) === 15 && svC2.activo_id === otroCarro.id && quedanC === 1 && !(await espejoDe(svC.id)) && r2((await espejoDe(svC2.id)).amount) === 15,
    "C5. queda UN solo flete ($15) y la Por Pagar vieja desaparece", { quedanC });
  exigir(await api("DELETE", `/orders/${pB.id}/flete`, undefined, stalyn), "C6. quitar el flete");
  const ordC = (await q("SELECT flete_servicio_id, flete_monto FROM sales_orders WHERE id=$1", [pB.id]))[0];
  check(!(await servicioDe(pB.id)) && !(await espejoDe(svC2.id)) && !ordC.flete_servicio_id && ordC.flete_monto === null, "C7. al quitarlo no queda cobro en Transporte ni Por Pagar");
  const pPend = await pedido(stalyn, cliS, 2);
  check((await api("PUT", `/orders/${pPend.id}/flete`, { activo_id: carro.id, monto: 5 }, stalyn)).status === 409, "C8. a un pedido sin despachar no se le pone flete aparte (va en el despacho) → 409");
  check((await api("PUT", `/orders/${pA.id}/flete`, { activo_id: carro.id, monto: 5 }, matriz)).status === 404, "C9. otro accionista no puede tocar el flete de STALYN → 404");

  // ── D. Transporte ya cobró: el flete queda protegido; el espejo baja solo ───
  const cuenta = (await q("SELECT id FROM campo_cuentas LIMIT 1"))[0].id;
  await q("INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, servicio_id, naturaleza) VALUES (CURRENT_DATE,$1,'entrada',15,'Abono simulacro flete venta',$2,'cobro')", [cuenta, svA.id])
    .catch(async () => { await q("INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, servicio_id) VALUES (CURRENT_DATE,$1,'entrada',15,'Abono simulacro flete venta',$2)", [cuenta, svA.id]); });
  const apD = await espejoDe(svA.id);
  check(r2(apD.balance) === 25, "D1. con $15 cobrados en Transporte, la Por Pagar de STALYN baja a $25 (espejo)", { saldo: apD.balance });
  check((await api("PUT", `/orders/${pA.id}/flete`, { activo_id: carro.id, monto: 50 }, stalyn)).status === 409, "D2. con cobros ya no se puede cambiar el flete → 409");
  check((await api("DELETE", `/orders/${pA.id}/flete`, undefined, stalyn)).status === 409, "D3. ni quitarlo → 409");
  const listaD = (await api("GET", "/orders", undefined, stalyn)).data.find((o) => o.id === pA.id);
  check(Number(listaD?.flete_cobrado) === 15, "D4. la lista muestra lo ya cobrado ($15)", listaD?.flete_cobrado);

  // ── E. La MATRIZ también paga el flete a Transporte (como en liquidaciones) ─
  const pE = await pedido(matriz, cliM, 10);
  await preparar(pE, matriz);
  exigir(await despachar(pE, matriz, cajaM, { flete: { activo_id: carro.id, monto: 18 } }, "CREDIT"), "E1. CEYRO despacha a crédito con flete ($18)");
  const svE = await servicioDe(pE.id);
  const apE = svE && await espejoDe(svE.id);
  check(svE && svE.cliente === ceyro && apE && apE.accionista_id === matriz && r2(apE.amount) === 18, `E2. Transporte le cobra a ${ceyro} y ${ceyro} tiene su Por Pagar`, svE && { cliente: svE.cliente });
  const arE = (await q("SELECT r.balance::float b FROM accounts_receivable r JOIN sales_orders o ON o.receivable_id = r.id WHERE o.id=$1", [pE.id]))[0];
  check(arE && r2(arE.b) === 300, "E3. la venta a crédito queda por cobrar al cliente por $300 (el flete aparte)", arE);

  // ── F. Doble clic: un solo despacho y un solo flete ─────────────────────────
  const pF = await pedido(stalyn, cliS, 4);
  await preparar(pF, stalyn);
  const [f1, f2] = await Promise.all([1, 2].map(() => despachar(pF, stalyn, cajaS, { flete: { activo_id: carro.id, monto: 8 } })));
  const nF = (await q("SELECT count(*)::int n FROM campo_servicios WHERE origen_tipo='venta_flete' AND origen_id=$1", [pF.id]))[0].n;
  const ventasF = (await q("SELECT count(*)::int n FROM sales_orders o JOIN sales s ON s.id = o.sale_id WHERE o.id=$1", [pF.id]))[0].n;
  check([f1, f2].filter((r) => r.ok).length === 1 && nF === 1 && ventasF === 1, "F1. despachar dos veces a la vez: UNA venta y UN flete", [f1.status, f2.status, nF]);
  check((await despachar(pF, stalyn, cajaS)).status === 409, "F2. volver a despachar un pedido despachado → 409");
  check((await api("POST", `/orders/${pF.id}/cancel`, {}, stalyn)).status === 409, "F3. no se cancela un pedido ya despachado → 409");

  // ── G. Ventas generales ─────────────────────────────────────────────────────
  const pG = await pedido(stalyn, cliS, 3, 32);
  const sinPrep = await despachar(pG, stalyn, cajaS);
  check(sinPrep.status === 409, "G1. sin confirmar la preparación no se despacha → 409", mostrar(sinPrep));
  await preparar(pG, stalyn);
  check((await despachar(pG, stalyn, undefined)).status === 400, "G2. al contado sin caja → 400");
  const sG0 = await saldo(cajaS.id, stalyn);
  exigir(await despachar(pG, stalyn, cajaS), "G3. despacho al contado");
  check(r2((await saldo(cajaS.id, stalyn)) - sG0) === 96, "G4. entran a la caja exactamente 3 QQ × $32 = $96", r2((await saldo(cajaS.id, stalyn)) - sG0));
  const arG = (await q("SELECT r.balance::float b, r.status FROM accounts_receivable r JOIN sales_orders o ON o.receivable_id = r.id WHERE o.id=$1", [pG.id]))[0];
  check(!arG || (arG.b === 0 && arG.status === "PAID"), "G5. su cuenta por cobrar del pedido queda saldada", arG);

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
