// 🧰 Arreglos pedidos por el dueño el 2026-11-12. SOLO copia.
//  A. El pago de una compra a contado no se anula suelto; «Pasar a crédito» devuelve el dinero y crea la Por Pagar.
//  B. Un pago por BANCO a Transporte entra al BANCO de Transporte (antes iba a su gaveta).
//  C. Despachar con fecha de ayer: venta, cobro e inventario quedan ese día.
//  D. Preparar «sale de aquí (se está pilando)»: todo de la piladora aunque haya allá, sin frenar por stock.
//  E. Liquidar y pagar (todo o un abono) en el mismo momento.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const diaEc = async (ts) => (await q("SELECT ($1::timestamptz AT TIME ZONE 'America/Guayaquil')::date::text d", [ts]))[0].d;
try {
  const hoy = (await q("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text d"))[0].d;
  const ayer = (await q("SELECT ((now() AT TIME ZONE 'America/Guayaquil')::date - 1)::text d"))[0].d;
  const farmer = (await q("SELECT id, full_name FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const p011 = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const flor = (await q("SELECT id FROM products WHERE name='Flor'"))[0].id;
  const wh = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  // La caja de la Matriz se abre AYER (para poder cobrar con fecha de ayer) y MIXTA (efectivo y banco).
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim 1112", tipo: "MIXTO", opening_balance_cash: 5000, opening_balance_bank: 5000 }, matriz), "0. caja mixta");
  await q("UPDATE cash_registers SET opened_at = opened_at - interval '1 day' WHERE id=$1", [caja.id]);
  const saldoCaja = async () => Number((await api("GET", `/cash/registers/${caja.id}/summary`, undefined, matriz)).data.current_balance);

  // ── A. Compra a contado que fue a crédito ──
  const item = { item_type: "PRODUCT", product_id: p011, warehouse_id: wh, quantity: 35.3, unit_price: 40 };
  const s0 = await saldoCaja();
  const comp = exigir(await api("POST", "/purchases", { farmer_id: farmer.id, payment_type: "CASH", cash_register_id: caja.id, items: [item] }, matriz), "A1. compra a contado de 35.3 QQ");
  const pago = (await q("SELECT id FROM cash_movements WHERE reference_type='purchase' AND reference_id=$1", [comp.id]))[0];
  const rev = await api("POST", `/cash/movements/${pago.id}/reverse`, { reason: "FUE A CREDITO" }, matriz);
  check(rev.status === 409, "A2. el pago de una compra ya no se anula suelto en Caja", mostrar(rev));
  const ac = exigir(await api("POST", `/purchases/${comp.id}/a-credito`, { reason: "SIM fue a crédito" }, matriz), "A3. pasar la compra a crédito");
  check(r2(ac.devuelto_a_caja) === 1412 && r2(await saldoCaja()) === r2(s0), "A4. vuelven $1,412 a la caja", { devuelto: ac.devuelto_a_caja, caja: await saldoCaja(), antes: s0 });
  const apC = (await q("SELECT farmer_id, amount::float a, balance::float b FROM accounts_payable WHERE reference_type='purchase' AND reference_id=$1 AND status<>'CANCELLED'", [comp.id]))[0];
  check(apC && apC.farmer_id === farmer.id && apC.a === 1412 && apC.b === 1412, "A5. queda la Por Pagar de $1,412 al agricultor", apC);
  check((await q("SELECT payment_type FROM purchases WHERE id=$1", [comp.id]))[0].payment_type === "CREDIT", "A6. la compra queda a crédito");
  const otra = await api("POST", `/purchases/${comp.id}/a-credito`, {}, matriz);
  check(otra.status === 409, "A7. no se pasa a crédito dos veces", mostrar(otra));
  // El caso real: pago anulado suelto (antes del arreglo) → «Pasar a crédito» solo crea la deuda.
  const comp2 = exigir(await api("POST", "/purchases", { farmer_id: farmer.id, payment_type: "CASH", cash_register_id: caja.id, items: [{ ...item, quantity: 2 }] }, matriz), "A8. otra compra a contado");
  const pago2 = (await q("SELECT id FROM cash_movements WHERE reference_type='purchase' AND reference_id=$1", [comp2.id]))[0];
  await q("UPDATE cash_movements SET reversed_at = now(), reversed_reason = 'SIM anulado suelto' WHERE id=$1", [pago2.id]);
  await q(`INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, reference_type, reference_id, reversal_of)
           VALUES ($1,'INCOME','COMPRA_GENERAL',80,'SIM anulación vieja','reversal',$2,$2)`, [caja.id, pago2.id]);
  const hall = (await revisar(q)).filter((x) => /compra a contado vigente/i.test(x.regla));
  check(hall.length === 1 && hall[0].filas.some((f) => f.purchase_number === comp2.purchase_number), "A9. la regla de integridad nueva detecta la compra sin pago ni deuda", hall.map((h) => h.filas));
  const ac2 = exigir(await api("POST", `/purchases/${comp2.id}/a-credito`, {}, matriz), "A10. pasarla a crédito");
  check(ac2.devuelto_a_caja === 0 && (await q("SELECT 1 FROM accounts_payable WHERE reference_type='purchase' AND reference_id=$1", [comp2.id])).length === 1, "A11. no devuelve dinero otra vez y crea la Por Pagar", ac2);

  // ── B. Pago por banco a Transporte ──
  const carro = (await q("SELECT id FROM campo_activos WHERE activo AND lower(coalesce(tipo,'')) <> 'cosechadora' ORDER BY nombre LIMIT 1"))[0]?.id;
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE 1112" }, matriz), "B0. cliente");
  await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',40,'QQ','OWNED',$3,'sim 1112')", [p011, wh, matriz]);
  const ped = exigir(await api("POST", "/orders", { customer_id: cli.id, payment_method: "CASH", items: [{ product_id: flor, inventory_product_id: p011, quantity: 5, unit_price: 46 }] }, matriz), "B1. pedido de 5 QQ");
  exigir(await api("PATCH", `/orders/${ped.id}/prepare`, { prepared: true }, matriz), "B2. preparar");
  // C va junto: se despacha con fecha de AYER y con flete de un carro de Transporte.
  const ventaAyer = exigir(await api("POST", `/orders/${ped.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh, fecha: ayer, ...(carro ? { flete: { activo_id: carro, monto: 25 } } : {}) }, matriz), "C1. despachar con fecha de ayer");
  const venta = (await q("SELECT created_at FROM sales WHERE id=$1", [ventaAyer.sale.id]))[0];
  const cobro = (await q("SELECT created_at FROM cash_movements WHERE reference_type='sales' AND reference_id=$1", [ventaAyer.sale.id]))[0];
  const salida = (await q("SELECT created_at FROM inventory_movements WHERE reference_type='sales_order' AND reference_id=$1 LIMIT 1", [ped.id]))[0];
  const pedRow = (await q("SELECT delivered_at FROM sales_orders WHERE id=$1", [ped.id]))[0];
  check(await diaEc(venta.created_at) === ayer && cobro && await diaEc(cobro.created_at) === ayer && await diaEc(pedRow.delivered_at) === ayer,
    "C2. la venta, el cobro y el pedido quedan con fecha de ayer", { venta: await diaEc(venta.created_at), cobro: cobro && await diaEc(cobro.created_at) });
  check(await diaEc(salida.created_at) === hoy, "C3. la salida de inventario sigue siendo la de la preparación (hoy)");
  const futuro = await api("POST", `/orders/${ped.id}/deliver`, { payment_method: "CASH", cash_register_id: caja.id, warehouse_id: wh, fecha: "2099-01-01" }, matriz);
  check(futuro.status === 400, "C4. no acepta fecha futura", mostrar(futuro));

  if (carro) {
    const fl = (await q("SELECT id, balance::float b FROM accounts_payable WHERE reference_type='campo_servicio' AND accionista_id=$1 AND balance>0 ORDER BY created_at DESC LIMIT 1", [matriz]))[0];
    check(!!fl && fl.b === 25, "B3. el flete queda en Por Pagar de la Matriz con Transporte", fl);
    const banco0 = Number((await q("SELECT COALESCE(SUM(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float s FROM campo_movimientos m JOIN campo_cuentas c ON c.id=m.cuenta_id WHERE c.nombre='BANCO'"))[0].s);
    const gav0 = Number((await q("SELECT COALESCE(SUM(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float s FROM campo_movimientos m JOIN campo_cuentas c ON c.id=m.cuenta_id WHERE c.nombre='CAJA'"))[0].s);
    exigir(await api("POST", "/cash/payables/pay-group", { payable_ids: [fl.id], cash_register_id: caja.id, amount: 25, medio_pago: "BANCO" }, matriz, { "x-medio-pago": "BANCO" }), "B4. pagar el flete por BANCO");
    const banco1 = Number((await q("SELECT COALESCE(SUM(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float s FROM campo_movimientos m JOIN campo_cuentas c ON c.id=m.cuenta_id WHERE c.nombre='BANCO'"))[0].s);
    const gav1 = Number((await q("SELECT COALESCE(SUM(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float s FROM campo_movimientos m JOIN campo_cuentas c ON c.id=m.cuenta_id WHERE c.nombre='CAJA'"))[0].s);
    check(r2(banco1 - banco0) === 25 && r2(gav1 - gav0) === 0, "B5. entra al BANCO de Transporte, no a su gaveta", { banco: r2(banco1 - banco0), gaveta: r2(gav1 - gav0) });
    const m = (await q("SELECT medio FROM cash_movements WHERE reference_type='accounts_payable' AND reference_id=$1 ORDER BY created_at DESC LIMIT 1", [fl.id]))[0];
    check(m?.medio === "BANCO", "B6. en la caja de la Matriz el pago sale del banco", m);
  } else check(true, "B. (sin carros de Transporte en la copia: se salta)");

  // ── D. Sale de aquí aunque haya allá ──
  const alla = (await q("SELECT id FROM warehouses WHERE type='EXTERNO' ORDER BY name LIMIT 1"))[0]?.id;
  if (alla) {
    const enPil = Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id=$1 AND warehouse_id=$2 AND accionista_id=$3 AND ownership='OWNED'", [p011, wh, matriz]))[0].s);
    await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, unit, ownership, accionista_id, notes) VALUES ($1,$2,'ADJUSTMENT',10,'QQ','OWNED',$3,'sim 1112 allá')", [p011, alla, matriz]);
    const qqD = r2(Math.max(0, enPil) + 5);
    const pedD = exigir(await api("POST", "/orders", { customer_id: cli.id, payment_method: "CASH", items: [{ product_id: flor, inventory_product_id: p011, quantity: qqD, unit_price: 46 }] }, matriz), `D1. pedido de ${qqD} QQ (5 más de lo que hay en la piladora)`);
    exigir(await api("PATCH", `/orders/${pedD.id}/prepare`, { prepared: true }, matriz), "D2. sin la opción: lo que falta se retira allá");
    const deAlla = Number((await q("SELECT COALESCE(-SUM(m.quantity),0)::float q FROM inventory_movements m JOIN warehouses w ON w.id=m.warehouse_id AND w.type='EXTERNO' WHERE m.reference_type='sales_order' AND m.reference_id=$1", [pedD.id]))[0].q);
    check(r2(deAlla) === 5, "D3. (como antes) salen 5 QQ de allá", deAlla);
    exigir(await api("PATCH", `/orders/${pedD.id}/prepare`, { prepared: false }, matriz), "D4. revertir la preparación");
    exigir(await api("PATCH", `/orders/${pedD.id}/prepare`, { prepared: true, desde_piladora: true }, matriz), "D5. «sale de aquí (se está pilando)»");
    const salD = await q("SELECT w.type, sum(m.quantity)::float q, bool_or(m.lot_id IS NULL AND m.notes ILIKE 'Sin stock suficiente%') neg FROM inventory_movements m JOIN warehouses w ON w.id=m.warehouse_id WHERE m.reference_type='sales_order' AND m.reference_id=$1 GROUP BY 1", [pedD.id]);
    check(salD.length === 1 && salD[0].type !== "EXTERNO" && r2(-salD[0].q) === qqD && salD[0].neg, "D6. todo sale de la piladora (nada de allá) y lo que falta queda en negativo con su nota", salD);
    const ambas = await api("PATCH", `/orders/${pedD.id}/prepare`, { prepared: true, desde_piladora: true, alla_ya_llego: {} }, matriz);
    check(ambas.status === 400, "D7. no se eligen las dos opciones a la vez", mostrar(ambas));
    exigir(await api("PATCH", `/orders/${pedD.id}/prepare`, { prepared: false }, matriz), "D8. revertir (devuelve todo)");
  } else check(true, "D. (sin bodega «allá» en la copia: se salta)");

  // ── E. Liquidar y pagar en el momento ──
  const tickets = await q(`SELECT id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 5 ORDER BY id LIMIT 3`);
  const ingresos = [];
  for (const t of tickets) {
    await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id });
    const i = await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED" });
    if (i.ok) ingresos.push({ id: i.data.ingreso.id, qq: t.qq });
  }
  if (ingresos.length >= 2) {
    // Lo que el agricultor ya debía (anticipos) se descuenta solo; el pago es sobre lo que queda por pagarle.
    const linea = (E) => ({ farmer_id: farmer.id, weighing_ticket_id: E.id, quintals: E.qq, price_per_quintal: 30, other_discounts: 0 });
    const c0 = await saldoCaja();
    const L = exigir(await api("POST", "/liquidations/lote", { lineas: [linea(ingresos[0])], pago: { todo: true, cash_register_id: caja.id, medio_pago: "EFECTIVO" } }, matriz, { "x-confirmar": "QQ_EXCEDE" }), "E1. liquidar y pagar todo");
    const apL = (await q("SELECT balance::float b, amount::float a FROM accounts_payable WHERE liquidation_id=$1 AND reference_type IS NULL", [L[0].id]))[0];
    check(apL && apL.b === 0 && r2(c0 - await saldoCaja()) === r2(apL.a), "E2. la liquidación queda pagada y sale de la caja lo mismo", { ap: apL, salio: r2(c0 - await saldoCaja()) });
    const c1 = await saldoCaja();
    const L2 = exigir(await api("POST", "/liquidations/lote", { lineas: [linea(ingresos[1])], pago: { monto: 10, cash_register_id: caja.id, medio_pago: "BANCO" } }, matriz, { "x-confirmar": "QQ_EXCEDE" }), "E3. liquidar y abonar $10 por banco");
    const apL2 = (await q("SELECT balance::float b, amount::float a FROM accounts_payable WHERE liquidation_id=$1 AND reference_type IS NULL", [L2[0].id]))[0];
    const movL2 = (await q("SELECT medio FROM cash_movements WHERE reference_type='accounts_payable' ORDER BY created_at DESC LIMIT 1"))[0];
    check(apL2 && r2(apL2.a - apL2.b) === 10 && r2(c1 - await saldoCaja()) === 10 && movL2.medio === "BANCO", "E4. abona $10 por banco y el resto queda en Por Pagar", { ap: apL2, medio: movL2.medio });
    if (ingresos[2]) {
      const n0 = (await q("SELECT count(*)::int n FROM liquidations WHERE weighing_ticket_id=$1 AND status<>'CANCELLED'", [ingresos[2].id]))[0].n;
      const mucho = await api("POST", "/liquidations/lote", { lineas: [linea(ingresos[2])], pago: { monto: 999999, cash_register_id: caja.id } }, matriz, { "x-confirmar": "QQ_EXCEDE" });
      const n1 = (await q("SELECT count(*)::int n FROM liquidations WHERE weighing_ticket_id=$1 AND status<>'CANCELLED'", [ingresos[2].id]))[0].n;
      check(mucho.status === 409 && n0 === n1, "E5. si el pago supera lo que se le debe, no se guarda nada", mostrar(mucho));
    }
  } else check(true, "E. (sin tickets para liquidar en la copia: se salta)");

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla) && !/compra a contado vigente/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
  const hc = (await revisar(q)).filter((x) => /compra a contado vigente/i.test(x.regla));
  check(hc.length === 1 && hc[0].filas.every((f) => f.purchase_number.startsWith("COMP-") && f.purchase_number !== comp.purchase_number && f.purchase_number !== comp2.purchase_number),
    "Z2. solo queda la compra real de Adrián (la de la copia) sin pago ni deuda", hc.map((x) => x.filas));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
