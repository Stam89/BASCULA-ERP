// 🏦 Fomento por transferencia (la fangueada, o el agricultor con cuenta) y 🔎 compras a crédito en «¿Cuándo se hizo?».
// La transferencia suma a la deuda y no toca la gaveta; anularla deja todo como estaba. La compra a crédito sale una vez,
// con su día, aunque ya se haya pagado. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const ceyro = matriz;
  const rovinson = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "CEYRO", tipo: "EFECTIVO", opening_balance_cash: 100 }, ceyro), "0. caja de efectivo con $100");
  const cajaId = caja.id;
  const gaveta = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [cajaId]))[0].s);
  const inicial = await gaveta();
  const fom = exigir(await api("POST", "/fomentos", { farmer_name: "SIM AGRICULTOR TRANSFERENCIA", cuadras: 5, inicio: "2026-10-01" }, ceyro), "0. fomento");

  // A. Más que lo que hay en la gaveta: no avisa sobregiro porque no sale de ahí.
  const ent = exigir(await api("POST", `/fomentos/${fom.id}/entregas`, {
    fecha: "2026-11-04", valor: 350, concepto: "Fangueada", cash_register_id: cajaId, pagado_con_banco: true, transferido_a: "LUIS FANGUERO"
  }, ceyro), "A1. fangueada de $350 transferida a otra persona");
  check(ent.concepto === "Fangueada · Transferido a LUIS FANGUERO", "A2. la entrega dice qué fue y a quién", ent.concepto);
  check(await gaveta() === inicial, "A3. la gaveta no cambia", await gaveta());
  const movs = await q("SELECT id, category, reference_type, amount::float a, description FROM cash_movements WHERE cash_register_id=$1 AND (reference_id=$2 OR reference_id IN (SELECT id FROM cash_movements WHERE reference_id=$2))", [cajaId, ent.id]);
  const egreso = movs.find((m) => m.category === "FOMENTO_ENTREGA");
  const banco = movs.find((m) => m.category === "RETIRO_BANCO");
  check(egreso?.a === 350 && banco?.a === 350, "A4. sale como fomento y entra lo mismo del banco", movs);
  check(banco?.reference_type === "pagado_con_banco", "A5. la entrada queda enlazada al egreso", banco);
  const det = exigir(await api("GET", `/fomentos/${fom.id}`, undefined, ceyro), "A6. detalle del fomento");
  check(Number(det.total_pedido) === 350, "A7. suma a la deuda del agricultor", det.total_pedido);
  const buscada = exigir(await api("GET", "/historial/buscar?ambito=matriz&q=fangueada", undefined, ceyro), "A8. busca «fangueada»");
  check(buscada.filas.some((f) => f.id === egreso.id), "A9. se encuentra en ¿Cuándo se hizo?", buscada.filas);

  // B. Al agricultor, sin concepto.
  const propia = exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: "2026-11-04", valor: 20, cash_register_id: cajaId, pagado_con_banco: true }, ceyro), "B1. transferencia al mismo agricultor");
  check(propia.concepto === "Transferencia", "B2. queda marcada como transferencia", propia.concepto);

  // C. En efectivo todo sigue igual.
  const efectivo = exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: "2026-11-04", valor: 10, concepto: "Semilla", cash_register_id: cajaId }, ceyro), "C1. entrega en efectivo");
  check(efectivo.concepto === "Semilla", "C2. el concepto no cambia", efectivo.concepto);
  check(await gaveta() === inicial - 10, "C3. esa sí sale de la gaveta", await gaveta());

  // C2. Pago del agricultor por transferencia.
  const antesPago = await gaveta();
  const pago = exigir(await api("POST", `/fomentos/${fom.id}/pagos`, { fecha: "2026-11-04", valor: 15, concepto: "Abono", cash_register_id: cajaId, pagado_con_banco: true }, ceyro), "C4. el agricultor paga $15 por transferencia");
  check(pago.concepto === "Abono · Transferencia", "C5. el pago queda marcado", pago.concepto);
  check(await gaveta() === antesPago, "C6. no entra a la gaveta", await gaveta());
  const ingreso = (await q("SELECT id FROM cash_movements WHERE reference_type='fomento_pagos' AND reference_id=$1", [pago.id]))[0];
  const salida = (await q("SELECT id, category, movement FROM cash_movements WHERE reference_type='pagado_con_banco' AND reference_id=$1", [ingreso.id]))[0];
  check(salida?.category === "TRASPASO_INTERNO" && salida?.movement === "EXPENSE", "C7. su contrapartida no es gasto", salida);
  const conPago = exigir(await api("GET", `/fomentos/${fom.id}`, undefined, ceyro), "C8. detalle");
  check(Number(conPago.total_pagado) === 15, "C9. baja la deuda", conPago.total_pagado);
  const sinBorrar = await api("DELETE", `/fomentos/${fom.id}`, undefined, ceyro);
  check(sinBorrar.status === 409, "C10. un fomento con caja no se elimina", mostrar(sinBorrar));
  exigir(await api("POST", `/cash/movements/${ingreso.id}/reverse`, { reason: "sim anula pago" }, ceyro), "C11. se anula el pago");
  check(await gaveta() === antesPago, "C12. la gaveta sigue igual", await gaveta());
  const vivosPago = await q("SELECT count(*)::int n FROM cash_movements WHERE id = ANY($1) AND reversed_at IS NULL", [[ingreso.id, salida.id]]);
  check(vivosPago[0].n === 0, "C13. las dos líneas del pago quedan anuladas", vivosPago);
  const efPago = exigir(await api("POST", `/fomentos/${fom.id}/pagos`, { fecha: "2026-11-04", valor: 5, cash_register_id: cajaId }, ceyro), "C14. pago en efectivo");
  check(efPago.concepto === null && await gaveta() === antesPago + 5, "C15. ese sí entra a la gaveta", await gaveta());

  // D. Anular.
  const soloBanco = await api("POST", `/cash/movements/${banco.id}/reverse`, { reason: "sim" }, ceyro);
  check(soloBanco.status === 409, "D1. la entrada del banco sola no se anula", mostrar(soloBanco));
  exigir(await api("POST", `/cash/movements/${egreso.id}/reverse`, { reason: "sim anula" }, ceyro), "D2. se anula el egreso");
  check(await gaveta() === inicial - 5, "D3. la gaveta sigue igual tras anular", await gaveta());
  const vivos = await q("SELECT count(*)::int n FROM cash_movements WHERE id = ANY($1) AND reversed_at IS NULL", [[egreso.id, banco.id]]);
  check(vivos[0].n === 0, "D4. las dos líneas quedan anuladas", vivos);
  exigir(await api("DELETE", `/fomentos/${fom.id}/entregas/${ent.id}`, undefined, ceyro), "D5. ya se puede quitar la entrega");

  // E. Fomento de un socio transferido por la Matriz.
  const fomS = exigir(await api("POST", "/fomentos", { farmer_name: "SIM SOCIO TRANSFERENCIA", cuadras: 2, inicio: "2026-10-01" }, rovinson), "E0. fomento de ROVINSON");
  const antesS = await gaveta();
  const entS = exigir(await api("POST", `/fomentos/${fomS.id}/entregas`, { fecha: "2026-11-04", valor: 40, concepto: "Fangueada", cash_register_id: cajaId, pagado_con_banco: true }, ceyro), "E1. la Matriz transfiere un fomento del socio");
  check(!!entS.entregado_por_matriz, "E2. se cruza con el socio", entS);
  check(await gaveta() === antesS, "E3. la gaveta de la Matriz no cambia", await gaveta());

  // F. Repuesto a crédito en el buscador.
  const compra = exigir(await api("POST", "/repuestos/compra", {
    items: [{ nuevo: { nombre: "RODAMIENTO SIM DESCASCARADOR", referencia: null, unidad: "UNIDAD", stock_minimo: 0 }, cantidad: 2, costo_unitario: 30 }],
    cash_register_id: cajaId, modalidad_pago: "CREDITO", proveedor_nombre: "SIM FERRETERIA"
  }, ceyro), "F1. repuesto a crédito $60");
  const buscar = async (t) => exigir(await api("GET", `/historial/buscar?ambito=matriz&q=${encodeURIComponent(t)}`, undefined, ceyro), `busca ${t}`);
  let r = await buscar("descascarador");
  check(r.filas.length === 1 && r.filas[0].fuente === "CREDITO", "F2. sale en el buscador", r.filas);
  check(r.filas[0].monto === 60 && r.filas[0].donde === "A crédito · debe $60.00", "F3. dice cuánto se debe", r.filas[0]);
  check(r.filas[0].proveedor === "SIM FERRETERIA", "F4. con el proveedor", r.filas[0]);
  r = await buscar("sim ferreteria");
  check(r.filas.length === 1, "F5. también por el proveedor", r.filas);

  exigir(await api("POST", `/cash/payables/${compra.payable_id}/pay`, { amount: 60, cash_register_id: cajaId }, ceyro), "F6. se paga completo");
  r = await buscar("descascarador");
  check(r.filas.length === 1 && r.total === 60, "F7. pagada no sale dos veces", r.filas);
  check(r.filas[0].donde === "A crédito · pagada", "F8. y dice pagada", r.filas[0]);

  const otra = exigir(await api("POST", "/repuestos/compra", {
    items: [{ nuevo: { nombre: "BANDA SIM ANULADA", referencia: null, unidad: "UNIDAD", stock_minimo: 0 }, cantidad: 1, costo_unitario: 15 }],
    cash_register_id: cajaId, modalidad_pago: "CREDITO", proveedor_nombre: "SIM FERRETERIA"
  }, ceyro), "F9. otra compra a crédito");
  exigir(await api("POST", `/cash/creditos/${otra.payable_id}/anular`, { reason: "sim anula" }, ceyro), "F10. se anula");
  r = await buscar("banda sim anulada");
  check(r.filas.length === 0, "F11. la anulada no sale", r.filas);

  // G. Transporte: egreso a crédito y su abono.
  const cuentas = exigir(await api("GET", "/campo/cuentas", undefined, ceyro), "G0. cuentas de Transporte");
  const BANCO = cuentas.find((c) => c.nombre === "BANCO").id;
  const eg = exigir(await api("POST", "/campo/movimientos", { signo: "salida", monto: 80, concepto: "Filtro sim cosechadora", modalidad_pago: "CREDITO", proveedor: "SIM TALLER" }, ceyro), "G1. egreso a crédito en Transporte");
  const buscarT = async (t) => exigir(await api("GET", `/historial/buscar?ambito=transporte&q=${encodeURIComponent(t)}`, undefined, ceyro), `busca ${t}`);
  let t = await buscarT("filtro sim");
  check(t.filas.length === 1 && t.filas[0].donde === "A crédito · debe $80.00", "G2. sale con lo que se debe", t.filas);
  exigir(await api("POST", `/campo/cxp/${eg.cxp.id}/abono`, { monto: 30, cuenta_id: BANCO }, ceyro), "G3. abono de $30");
  t = await buscarT("filtro sim");
  check(t.filas.length === 1 && t.total === 80 && t.filas[0].donde === "A crédito · debe $50.00", "G4. el abono no sale como otra compra", t.filas);

  const hallazgos = await revisar(q);
  check(!hallazgos?.length, "Z. consistencia sin hallazgos", hallazgos);
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
