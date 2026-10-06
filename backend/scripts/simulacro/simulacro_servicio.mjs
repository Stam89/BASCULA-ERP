// SIMULACRO 2: servicio de pilado (arroz del cliente) con su cobro, sobre una COPIA de la base.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const stock = async (code) => Number((await q("SELECT COALESCE(sum(quantity),0)::float n FROM inventory_stock s JOIN products p ON p.id=s.product_id WHERE p.code=$1", [code]).catch(() => [{ n: 0 }]))[0].n);

try {
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja Servicio", tipo: "EFECTIVO", opening_balance_cash: 300 }), "1. Abrir caja con $300");
  const farmer = (await q("SELECT id, full_name FROM farmers ORDER BY full_name DESC LIMIT 1"))[0];
  const pend = (await q(`SELECT id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 0 ORDER BY id DESC LIMIT 1`))[0];
  await api("POST", `/tickets/${pend.id}/link-farmer`, { farmer_id: farmer.id });
  const qq = pend.qq;
  const prodBlancoAntes = await stock("ARROZ-PILADO-011"), cascaraAntes = await stock("CASCARA-011");

  const ing = exigir(await api("POST", `/tickets/${pend.id}/create-lot`, { rice_type: "0.11", operation_type: "SECADO_PILADO", ownership: "MAQUILA" }), "2. Ingresar como SERVICIO (secado + pilado) de un cliente");
  const entryId = ing.ingreso.id;
  check((await stock("CASCARA-011")) === cascaraAntes, "2b. el arroz de un servicio NO entra al inventario propio", { antes: cascaraAntes, despues: await stock("CASCARA-011") });
  check(ing.ingreso.is_maquila === true && ing.ingreso.operation_type === "SECADO_PILADO", "2c. queda marcado como servicio", { m: ing.ingreso.is_maquila, op: ing.ingreso.operation_type });

  const sec = exigir(await api("POST", "/process-flow/drying", { entry_ids: [entryId], tunnel_number: 2, dryer_name: "Secadora 2", rice_type: "0.11", moisture_before: 21, filled_at: new Date(Date.now() - 15 * 3600e3).toISOString() }), "3a. Llenar túnel 2");
  exigir(await api("PUT", `/process-flow/drying/${sec.id}`, { rice_type: "0.11", moisture_before: 21, moisture_after: 13, filled_at: new Date(Date.now() - 15 * 3600e3).toISOString(), dry_start_at: new Date(Date.now() - 14 * 3600e3).toISOString(), dry_end_at: new Date().toISOString(), finalize: true, dryer_name: "Secadora 2", entry_ids: [entryId] }), "3b. Finalizar secado");
  const motor = 2;
  const fuel = await api("POST", "/process-flow/drying/motor-fuel", { motor_number: motor, gas_bombona_inicio: 90, gas_bombona_fin: 60, finalize: false });
  check(fuel.ok || fuel.status === 409, "3c. registrar combustible del motor (o ya estaba cubierto)", fuel.ok ? undefined : mostrar(fuel));

  // Cobro del secado (servicio) — lo hace la matriz sobre el lote
  const cobSec = await api("POST", "/cobros/secado", { lot_id: sec.lot_id });
  console.log("   cobro de secado:", mostrar(cobSec));
  check(cobSec.ok, "4a. Registrar el cobro del secado del servicio (cuenta por cobrar)", cobSec.ok ? { monto: cobSec.data.amount ?? cobSec.data.monto ?? cobSec.data.total } : mostrar(cobSec));
  const dobleSec = await api("POST", "/cobros/secado", { lot_id: sec.lot_id });
  check(dobleSec.status === 409, "4b. cobrar el secado dos veces se rechaza", dobleSec.status);

  // Producción del servicio
  const prods = await q("SELECT id, code FROM products"); const P = (c) => prods.find((p) => p.code === c)?.id;
  const bod = await q("SELECT id, type FROM warehouses"); const bodMP = bod.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bod.find((b) => b.type === "FINISHED_GOODS").id;
  const batch = exigir(await api("POST", "/processing-batches", { lot_id: sec.lot_id, drying_report_id: sec.id, process_type: "PILADO", ownership: "MAQUILA", input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: Number(sec.input_weight_kg) }), "5a. Crear lote de producción (servicio)");
  const blanco = r2(qq * 0.64);
  const tarifa = 3.75;
  const pr = exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: sec.lot_id, is_maquila: true, input_paddy_kg: Number(sec.input_weight_kg),
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: blanco, unit: "QQ" },
    bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: r2(qq * 0.08), unit: "QQ" },
    sacks_used: 0, service_rate_per_qq: tarifa
  }), "5b. Terminar producción del servicio (tarifa $3.75/QQ)");
  console.log("   resultado:", JSON.stringify(pr).slice(0, 400));
  check(pr.custodyMode === true || pr.custodyMode === undefined, "5c. el arroz pilado queda en custodia del cliente", { custodyMode: pr.custodyMode });
  check(r2(await stock("ARROZ-PILADO-011")) === r2(prodBlancoAntes), "5d. el arroz pilado del cliente NO suma al inventario propio", { antes: prodBlancoAntes, despues: await stock("ARROZ-PILADO-011") });

  // Cuentas por cobrar del servicio y cobro en caja
  const cxc = (await api("GET", "/receivable")).data;
  const lista = Array.isArray(cxc) ? cxc : cxc.rows ?? [];
  const mias = lista.filter((a) => a.status !== "PAID" && Number(a.balance) > 0 && new Date(a.created_at) > new Date(Date.now() - 3600e3));
  console.log("   cuentas por cobrar nuevas:", JSON.stringify(mias.map((a) => ({ ref: a.reference_type, monto: a.amount, saldo: a.balance, cliente: a.customer_name ?? a.farmer_name }))));
  check(mias.length >= 1, "6a. el servicio genera cuenta(s) por cobrar", mias.length);
  const totalPorCobrar = r2(mias.reduce((s, a) => s + Number(a.balance), 0));
  const esperado = r2(qq * tarifa) + r2(qq * 1.75);
  console.log("   total por cobrar:", totalPorCobrar, "· esperado (pilado 3.75 + secado 1.75 por QQ, aprox.):", esperado);
  const ingresoAntes = (await api("GET", `/cash/registers/${caja.id}/summary`)).data.total_income;
  for (const a of mias) exigir(await api("POST", `/receivable/${a.id}/pay`, { amount: Number(a.balance), cash_register_id: caja.id }), `6b. Cobrar en caja (${a.reference_type ?? "cuenta"} $${a.balance})`);
  const ingresoDesp = (await api("GET", `/cash/registers/${caja.id}/summary`)).data.total_income;
  check(r2(ingresoDesp - ingresoAntes) === totalPorCobrar, "6c. la caja recibió exactamente lo cobrado", { recibido: r2(ingresoDesp - ingresoAntes), cobrado: totalPorCobrar });
  const otra = await api("POST", `/receivable/${mias[0].id}/pay`, { amount: 1, cash_register_id: caja.id });
  check(!otra.ok, "6d. cobrar de nuevo una cuenta ya saldada se rechaza", otra.status);
  exigir(await api("POST", `/cash/registers/${caja.id}/close`, {}), "7. Cerrar caja");
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
