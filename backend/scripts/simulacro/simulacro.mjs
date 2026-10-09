// SIMULACRO de un día completo sobre una COPIA de la base (servidor Express real en :4001).
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(Number(n) * 100) / 100;

try {
  // ── 0. Punto de partida ──────────────────────────────────────────────────
  const antes = (await api("GET", "/tickets/por-ingresar")).data;
  console.log("Tickets por ingresar al inicio:", antes);
  const stockAntes = await q("SELECT COALESCE(sum(quantity),0)::float AS qq FROM inventory_movements");
  void stockAntes;

  // ── 1. Abrir la caja del día ─────────────────────────────────────────────
  let actual = (await api("GET", "/cash/registers/current")).data;
  check(!actual || !actual.id, "al empezar no hay caja abierta", actual);
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja Principal", tipo: "MIXTO", opening_balance_cash: 500, opening_balance_bank: 1000 }), "1. Abrir caja con $500 efectivo + $1000 banco");
  const sumA = (await api("GET", `/cash/registers/${caja.id}/summary`)).data;
  console.log("   resumen al abrir:", JSON.stringify(sumA).slice(0, 300));

  // ── 2. Báscula: un ticket pendiente → vincular agricultor → ingresar materia prima ──
  const lista = (await api("GET", "/tickets")).data;
  const filas = Array.isArray(lista) ? lista : lista.tickets ?? lista.rows ?? [];
  const pendiente = filas.find((t) => !t.weighing_ticket_id && !t.liquidated_at && Number(t.quintals) > 0);
  check(!!pendiente, "2. hay un ticket pendiente con quintales", pendiente && { id: pendiente.id, qq: pendiente.quintals, farmer: pendiente.farmer_id, nombre: pendiente.farmer_name });
  const farmer = (await q("SELECT id, full_name FROM farmers ORDER BY full_name LIMIT 1"))[0];
  if (!pendiente.farmer_id) exigir(await api("POST", `/tickets/${pendiente.id}/link-farmer`, { farmer_id: farmer.id }), "2a. Vincular el ticket a un agricultor");
  const ingreso = exigir(await api("POST", `/tickets/${pendiente.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" }), "2b. Ingresar materia prima (COMPRA, 0.11)");
  const despues = (await api("GET", "/tickets/por-ingresar")).data;
  check(despues.n === antes.n - 1, "2c. «por ingresar» bajó en 1", { antes: antes.n, despues: despues.n });
  const entryId = ingreso.ingreso.id;
  console.log("   ingreso:", JSON.stringify(ingreso).slice(0, 300));
  const qq = Number(pendiente.quintals);
  const stockMP = (await q("SELECT COALESCE(sum(quantity),0)::float AS n FROM inventory_movements im JOIN products p ON p.id=im.product_id WHERE p.code='CASCARA-011'"))[0].n;
  console.log("   stock cáscara 0.11 en movimientos (copia):", stockMP);

  // ── 3. Secadoras: formar el lote en un túnel y finalizarlo ───────────────
  const disp = (await api("GET", "/process-flow/drying/available-lots")).data;
  check(Array.isArray(disp) && disp.some((d) => (d.id ?? d.entry_id) === entryId), "3a. el ingreso aparece disponible en Secadoras", disp?.length);
  const lote = exigir(await api("POST", "/process-flow/drying", {
    entry_ids: [entryId], tunnel_number: 1, dryer_name: "Secadora 1", rice_type: "0.11", moisture_before: 22,
    filled_at: new Date(Date.now() - 20 * 3600e3).toISOString(), finalize: false
  }), "3b. Llenar túnel 1 (lote nace)");
  const rep = lote.id ? lote : lote.report ?? lote;
  console.log("   secado:", JSON.stringify(rep).slice(0, 300));
  const hoy1 = (await api("GET", "/dashboard/hoy")).data;
  console.log("   Hoy (túnel >18 h):", JSON.stringify((hoy1.tareas ?? hoy1).map?.((t) => t.titulo ?? t.id)));
  const fin = exigir(await api("PUT", `/process-flow/drying/${rep.id}`, {
    rice_type: "0.11", moisture_before: 22, moisture_after: 13, filled_at: new Date(Date.now() - 20 * 3600e3).toISOString(), dry_start_at: new Date(Date.now() - 19 * 3600e3).toISOString(), dry_end_at: new Date().toISOString(), finalize: true, dryer_name: "Secadora 1", entry_ids: [entryId]
  }), "3c. Finalizar el secado (túnel 1)");
  console.log("   finalizado:", fin.status);
  const tareasHoy = async () => { const h = (await api("GET", "/dashboard/hoy")).data; return h.tareas ?? h; };
  check((await tareasHoy()).some((t) => t.key === "combustible-motor-1"), "3d. Hoy avisa (urgente) que falta el combustible del Motor 1", (await tareasHoy()).filter((t) => t.nivel === "urgente").map((t) => t.titulo));
  const fuel = exigir(await api("POST", "/process-flow/drying/motor-fuel", { motor_number: 1, gas_bombona_inicio: 130, gas_bombona_fin: 100, finalize: false }), "3e. Registrar el combustible del Motor 1");
  console.log("   combustible:", JSON.stringify(fuel).slice(0, 250));
  check(!(await tareasHoy()).some((t) => t.key === "combustible-motor-1"), "3f. al registrarlo, la alerta de combustible desaparece de Hoy");

  // ── 4. Producción: pilar el lote ─────────────────────────────────────────
  const prods = await q("SELECT id, code, name FROM products");
  const P = (code) => prods.find((p) => p.code === code)?.id;
  const bodegas = await q("SELECT id, type FROM warehouses");
  const bodMP = bodegas.find((b) => b.type === "RAW_MATERIAL").id, bodPT = bodegas.find((b) => b.type === "FINISHED_GOODS").id;
  console.log("   códigos de producto:", prods.map((p) => p.code).join(","));
  const loteId = rep.lot_id ?? rep.lots?.[0]?.lot_id;
  const batch = exigir(await api("POST", "/processing-batches", {
    lot_id: loteId, drying_report_id: rep.id, process_type: "PILADO", ownership: "OWNED",
    input_product_id: P("CASCARA-011"), input_warehouse_id: bodMP, input_quantity: Number(rep.input_weight_kg ?? 0) || undefined
  }), "4a. Crear lote de producción");
  console.log("   batch:", JSON.stringify(batch).slice(0, 200));
  const blanco = r2(qq * 0.64), quebrado = r2(qq * 0.04), fino = r2(qq * 0.03), polvillo = r2(qq * 0.08);
  const pr = exigir(await api("POST", `/processing-batches/${batch.id}/finish-production`, {
    lot_id: loteId, is_maquila: false, input_paddy_kg: Number(rep.input_weight_kg ?? 0) || undefined,
    white_rice: { product_id: P("ARROZ-PILADO-011"), warehouse_id: bodPT, quantity: blanco, unit: "QQ" },
    broken_rice: { product_id: P("ARROCILLO-34"), warehouse_id: bodPT, quantity: quebrado, unit: "QQ" },
    fine_broken_rice: { product_id: P("ARROCILLO-FINO"), warehouse_id: bodPT, quantity: fino, unit: "QQ" },
    bran: { product_id: P("POLVILLO"), warehouse_id: bodPT, quantity: polvillo, unit: "QQ" },
    sacks_used: 0
  }), "4b. Terminar producción");
  console.log("   producción:", JSON.stringify(pr).slice(0, 300));
  const stockBlanco = async () => Number((await q("SELECT COALESCE(sum(CASE WHEN movement_type IN ('IN','PRODUCTION_OUTPUT','PURCHASE','ADJUSTMENT_IN') THEN quantity ELSE -quantity END),0) AS n FROM inventory_movements im JOIN products p ON p.id=im.product_id WHERE p.code='ARROZ-PILADO-011'"))[0]?.n ?? 0);
  void stockBlanco;
  const st = (await api("GET", "/inventory/stock")).data;
  const filaBlanco = (Array.isArray(st) ? st : st.rows ?? []).find((x) => /ARROZ-PILADO-011$/.test(x.code ?? "") || x.product_code === "ARROZ-PILADO-011");
  check(!!filaBlanco && Number(filaBlanco.quantity ?? filaBlanco.stock ?? filaBlanco.qty) >= blanco - 0.01, "4c. el arroz pilado aparece en inventario", filaBlanco);

  // ── 5. Ventas: cliente → pedido → despacho con cobro en caja ─────────────
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE SIMULACRO", phone: "0990000000" }), "5a. Crear cliente");
  const precio = 40, venderQQ = r2(blanco / 2);
  const ped = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: P("ARROZ-PILADO-011"), inventory_product_id: P("ARROZ-PILADO-011"), quantity: venderQQ, unit_price: precio }] }), "5b. Tomar pedido");
  check(r2(ped.total_amount) === r2(venderQQ * precio), "5c. total del pedido = QQ × precio", { total: ped.total_amount, esperado: r2(venderQQ * precio) });
  const stBlanco = async () => { const x = (await api("GET", "/inventory/stock")).data; const f = (Array.isArray(x) ? x : x.rows ?? []).find((r) => r.code === "ARROZ-PILADO-011"); return Number(f?.quantity ?? 0); };
  const antesPrep = await stBlanco();
  exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true, warehouse_id: bodPT }), "5d. Confirmar preparación del pedido");
  const trasPrep = await stBlanco();
  check(r2(antesPrep - trasPrep) === venderQQ, "5e. al preparar, el inventario baja lo vendido", { antes: antesPrep, despues: trasPrep, vendido: venderQQ });
  const entrega = exigir(await api("POST", `/orders/${ped.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: bodPT }), "5f. Despachar al contado");
  console.log("   venta:", JSON.stringify(entrega).slice(0, 250));
  const sum1 = (await api("GET", `/cash/registers/${caja.id}/summary`)).data;
  console.log("   caja tras la venta:", JSON.stringify(sum1));
  check(r2(await stBlanco()) === r2(trasPrep), "5g. despachar NO vuelve a bajar el inventario", { trasPrep, ahora: await stBlanco() });

  // ── 6. Venta a crédito → cuenta por cobrar → cobro en caja ───────────────
  const venderQQ2 = r2(blanco / 4);
  const ped2 = exigir(await api("POST", "/orders", { customer_id: cli.id, items: [{ product_id: P("ARROZ-PILADO-011"), inventory_product_id: P("ARROZ-PILADO-011"), quantity: venderQQ2, unit_price: precio }] }), "6a. Segundo pedido");
  exigir(await api("PATCH", `/orders/${ped2.id}/prepare`, { prepared: true, warehouse_id: bodPT }), "6b. Preparar segundo pedido");
  exigir(await api("POST", `/orders/${ped2.id}/deliver`, { payment_method: "CREDIT", warehouse_id: bodPT }), "6c. Despachar a crédito");
  const cxc = (await api("GET", "/receivable")).data;
  const cuenta = (Array.isArray(cxc) ? cxc : cxc.rows ?? []).find((a) => /SIMULACRO/.test(a.customer_name ?? a.full_name ?? "") );
  check(!!cuenta && r2(cuenta.balance ?? cuenta.amount_due ?? cuenta.total_amount) === r2(venderQQ2 * precio), "6d. nace la cuenta por cobrar por el valor del crédito", cuenta && { saldo: cuenta.balance ?? cuenta.amount_due, total: cuenta.total_amount });
  const cobro = exigir(await api("POST", `/receivable/${cuenta.id}/pay`, { amount: r2(venderQQ2 * precio), cash_register_id: caja.id }), "6e. Cobrar la cuenta en caja");
  const cxc2 = (await api("GET", "/receivable")).data;
  const quedaCuenta = (Array.isArray(cxc2) ? cxc2 : cxc2.rows ?? []).find((a) => a.id === cuenta.id && a.status !== "PAID" && r2(a.balance ?? a.amount_due ?? 1) > 0);
  check(!quedaCuenta, "6f. la cuenta queda saldada", quedaCuenta);

  // ── 7. Un egreso y el cierre de caja ─────────────────────────────────────
  exigir(await api("POST", "/cash/movements", { cash_register_id: caja.id, movement: "EXPENSE", category: "GASTO_OPERATIVO", amount: 20, description: "Simulacro: gasto menor" }), "7a. Egreso de $20 en caja");
  const sum2 = (await api("GET", `/cash/registers/${caja.id}/summary`)).data;
  console.log("   caja antes de cerrar:", JSON.stringify(sum2));
  const finalEsperado = r2(sum2.current_balance);
  check(finalEsperado === r2(1500 + venderQQ * precio + venderQQ2 * precio - 20), "7b. saldo antes de cerrar = apertura + cobros − egreso", { saldo: finalEsperado });
  exigir(await api("POST", `/cash/registers/${caja.id}/close`, {}), "7c. Cerrar caja");
  const prev = (await api("GET", "/cash/registers/previous-balance?tipo=MIXTO")).data;
  check(r2(prev.final_balance) === finalEsperado, "7d. al día siguiente, la caja sugiere abrir con el saldo con que cerró", prev);
  const cur2 = (await api("GET", "/cash/registers/current")).data;
  check(!cur2 || !cur2.id, "7e. ya no hay caja abierta", cur2);

  // ── 7bis. Día siguiente: abrir con ese saldo, liquidar un ticket a un agricultor, pagar la semana de nómina ──
  const caja2 = exigir(await api("POST", "/cash/registers/open", { name: "Caja Principal", tipo: "MIXTO", opening_balance_cash: 1489.6, opening_balance_bank: 1000 }), "9a. Abrir caja del día siguiente con el saldo anterior");
  const lista2 = (await api("GET", "/tickets")).data;
  const filas2 = Array.isArray(lista2) ? lista2 : lista2.tickets ?? [];
  const t2 = filas2.find((t) => !t.weighing_ticket_id && !t.liquidated_at && Number(t.quintals) > 0 && t.id !== pendiente.id);
  if (!t2.farmer_id) exigir(await api("POST", `/tickets/${t2.id}/link-farmer`, { farmer_id: farmer.id }), "10a. Vincular otro ticket");
  const vista = exigir(await api("POST", `/tickets/${t2.id}/liquidation-preview`, { precioQQ: 30 }), "10b. Vista previa de liquidación a $30/QQ");
  console.log("   preview:", JSON.stringify(vista));
  check(r2(vista.grossPayable) === r2(Number(t2.quintals) * 30), "10c. bruto = QQ × precio", { bruto: vista.grossPayable, esperado: r2(Number(t2.quintals) * 30) });
  const antesCaja = (await api("GET", `/cash/registers/${caja2.id}/summary`)).data.total_expense;
  exigir(await api("POST", `/tickets/${t2.id}/liquidate`, { precioQQ: 30, cash_register_id: caja2.id }), "10d. Liquidar el ticket pagando desde caja");
  const despCaja = (await api("GET", `/cash/registers/${caja2.id}/summary`)).data.total_expense;
  check(r2(despCaja - antesCaja) === r2(vista.netPayable), "10e. caja pagó exactamente el neto de la liquidación", { pagado: r2(despCaja - antesCaja), neto: vista.netPayable });
  const por3 = (await api("GET", "/tickets/por-ingresar")).data;
  check(por3.n === despues.n - 1, "10f. el ticket liquidado sale de «por ingresar»", { antes: despues.n, ahora: por3.n });
  const dobles = await api("POST", `/tickets/${t2.id}/liquidate`, { precioQQ: 30, cash_register_id: caja2.id });
  check(!dobles.ok, "10g. liquidar dos veces el mismo ticket se rechaza (no paga doble)", dobles.status);

  const nv = exigir(await api("GET", "/nomina-semanal/vista"), "11a. Ver la nómina de la semana");
  console.log("   nómina semanal:", JSON.stringify({ hasta: nv.hasta, totales: nv.totales }));
  const neto = Number(nv.totales.neto);
  if (neto > 0) {
    const e0 = (await api("GET", `/cash/registers/${caja2.id}/summary`)).data.total_expense;
    const pg = exigir(await api("POST", "/nomina-semanal/pagar", { hasta: nv.hasta, cash_register_id: caja2.id, confirmar_neto: neto }), "11b. Pagar la semana");
    const e1 = (await api("GET", `/cash/registers/${caja2.id}/summary`)).data.total_expense;
    check(r2(e1 - e0) === r2(neto), "11c. la caja pagó exactamente el neto de la nómina", { pagado: r2(e1 - e0), neto });
    const nv2 = (await api("GET", "/nomina-semanal/vista")).data;
    check(Number(nv2.totales.neto) === 0, "11d. después de pagar no queda nada pendiente", nv2.totales.neto);
    const rep = await api("POST", "/nomina-semanal/pagar", { hasta: nv.hasta, cash_register_id: caja2.id, confirmar_neto: neto });
    check(!rep.ok || Number(rep.data?.totales?.neto ?? 0) === 0, "11e. repetir el pago no paga doble", mostrar(rep));
  } else console.log("   (la nómina de la semana está en 0, no hay nada que pagar)");
  exigir(await api("POST", `/cash/registers/${caja2.id}/close`, {}), "12. Cerrar la caja del día siguiente");

  // ── 8. Pantallas que resumen el día ─────────────────────────────────────
  for (const [nombre, ruta] of [["Hoy", "/dashboard/hoy"], ["Panel integral", "/dashboard/panel?month=2026-10"], ["Dashboard", "/dashboard"], ["Búsqueda", "/busqueda?q=SANCHEZ"], ["Por ingresar", "/tickets/por-ingresar"], ["Resumen diario (vista)", "/resumen-diario/vista"], ["Nómina semanal", "/nomina-semanal/vista"]]) {
    const r = await api("GET", ruta);
    check(r.status < 500, `8. ${nombre} responde sin error`, r.status >= 400 ? mostrar(r) : r.status);
  }
} catch (e) {
  console.log("⛔", e.message);
} finally {
  const f = resumen();
  await S.cerrar();
  process.exit(f ? 1 : 0);
}
