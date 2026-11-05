// 🧭 Todo desde la hoja de Caja: cuadrilla pagada en el momento, abono por banco, venta con día, fondo y lo de Transporte
// que paga un socio. Se revisa que la gaveta dé lo que debe y que al anular no quede nada colgado. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "CEYRO", tipo: "EFECTIVO", opening_balance_cash: 500 }, matriz), "0. caja con $500");
  const cajaId = caja.id;
  const gaveta = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [cajaId]))[0].s);
  const base = await gaveta();

  // A. Cuadrilla: nace el registro y se paga solo ese.
  const act = (await q("SELECT id, unit_rate::float r FROM cuadrilla_activities WHERE name='EMBARQUE Y DESEMBARQUE' LIMIT 1"))[0];
  await api("POST", "/cuadrilla/entries", { activity_id: act.id, worker_name: "SIM HOJA", quantity: 10 }, matriz);
  const pago = exigir(await api("POST", "/cuadrilla/pago-directo", { cash_register_id: cajaId, activity_id: act.id, worker_name: "sim hoja", quantity: 315, monto: 63, description: "Cuadrilla embarque 315 x 0,20" }, matriz), "A1. cuadrilla $63");
  check(await gaveta() === base - 63, "A2. sale de la caja", await gaveta());
  const e = (await q("SELECT quantity::float c, unit_rate::float t, subtotal::float s, paid_at IS NOT NULL p, origen FROM cuadrilla_entries WHERE id=$1", [pago.entry_id]))[0];
  check(e.c === 315 && e.t === 0.2 && e.s === 63 && e.p && e.origen === "CAJA", "A3. registro pagado", e);
  const pend = (await q("SELECT count(*)::int n FROM cuadrilla_entries WHERE worker_name='SIM HOJA' AND paid_at IS NULL"))[0].n;
  check(pend === 1, "A4. lo otro pendiente no se pagó", pend);
  const inc = exigir(await api("POST", "/cuadrilla/pago-directo", { cash_register_id: cajaId, activity_id: act.id, quantity: 100, monto: 25 }, matriz), "A5. tarifa de incentivo");
  const n = (await q("SELECT unit_rate::float t, notes FROM cuadrilla_entries WHERE id=$1", [inc.entry_id]))[0];
  check(n.t === 0.25 && /catálogo/.test(n.notes), "A6. queda anotada", n);
  exigir(await api("POST", `/cash/movements/${pago.cash_movement_id}/reverse`, { reason: "sim anula cuadrilla" }, matriz), "A7. se anula");
  check((await q("SELECT count(*)::int n FROM cuadrilla_entries WHERE id=$1", [pago.entry_id]))[0].n === 0, "A8. el registro se va con su pago");
  check(await gaveta() === base - 25, "A9. el dinero vuelve", await gaveta());

  // B. Abono al agricultor: en efectivo y por banco.
  const fa = (await q("SELECT id FROM farmers LIMIT 1"))[0].id;
  const g1 = await gaveta();
  exigir(await api("POST", "/advances", { farmer_id: fa, amount: 20, concept: "Abono sim", cash_register_id: cajaId, apply_to_payables: true }, matriz), "B1. abono $20");
  check(await gaveta() === g1 - 20, "B2. baja la gaveta");
  const ab = exigir(await api("POST", "/advances", { farmer_id: fa, amount: 700, concept: "Abono sim banco", cash_register_id: cajaId, apply_to_payables: true, pagado_con_banco: true }, matriz), "B3. por banco, sin aviso de sobregiro");
  check(await gaveta() === g1 - 20, "B4. la gaveta no cambia", await gaveta());
  const mv = (await q("SELECT id FROM cash_movements WHERE reference_type='farmer_advances' AND reference_id=$1", [ab.id]))[0];
  exigir(await api("POST", `/cash/movements/${mv.id}/reverse`, { reason: "sim anula abono" }, matriz), "B5. se anula");
  check(await gaveta() === g1 - 20, "B6. las dos líneas juntas", await gaveta());
  check((await q("SELECT status FROM farmer_advances WHERE id=$1", [ab.id]))[0].status === "CANCELLED", "B7. anticipo cancelado");

  // C. Venta por asignar y fecha fuera de la caja.
  const pr = (await q("SELECT id, name FROM products WHERE code='POLVILLO'"))[0];
  const bod = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' LIMIT 1"))[0].id;
  const venta = { cash_register_id: cajaId, product_id: pr.id, warehouse_id: bod, quantity_qq: 1, total_amount: 14, price_per_pound: 0.15, mode: "QQ", input_amount: 1, product_name: "POLVILLO", buyer: { full_name: "CONSUMIDOR FINAL" }, por_asignar: true };
  const g2 = await gaveta();
  exigir(await api("POST", "/sales/retail", venta, matriz), "C1. venta por asignar");
  check(await gaveta() === g2 + 14, "C2. entra a la caja");
  const vieja = await api("POST", "/sales/retail", { ...venta, fecha: "2020-01-01" }, matriz);
  check(vieja.status === 400, "C3. antes de abrir la caja no", mostrar(vieja));
  check(await gaveta() === g2 + 14, "C4. y no entró nada");

  // D. Fondo a rendir y crédito.
  const g3 = await gaveta();
  const fondo = exigir(await api("POST", `/cash/${cajaId}/movements`, { movement: "EXPENSE", category: "GASTOS_VARIOS", amount: 40, description: "Anticipo sim", es_fondo: true, responsable: "SIM JACOBO" }, matriz), "D1. fondo $40");
  check(fondo.fondo_estado === "POR_LIQUIDAR" && await gaveta() === g3 - 40, "D2. por liquidar", fondo.fondo_estado);
  exigir(await api("POST", `/cash/${cajaId}/movements`, { movement: "EXPENSE", category: "GASTOS_VARIOS", amount: 30, description: "Credito sim", modalidad_pago: "CREDITO", proveedor_nombre: "SIM TALLER" }, matriz), "D3. a crédito");
  check(await gaveta() === g3 - 40, "D4. no toca la gaveta");

  // E. Transporte: lo pagó un socio.
  const toyota = (await q("SELECT id FROM campo_activos LIMIT 1"))[0].id;
  const nota = exigir(await api("POST", "/campo/mantenimientos/nota", { activo_id: toyota, tipo: "CORRECTIVO", proveedor: "ROVINSON", modalidad_pago: "CREDITO", lineas: [{ cantidad: 1, descripcion: "Guardafango sim", clase: "REPUESTO", valor: 125 }] }, matriz), "E1. nota a crédito");
  check(!!nota.cxp_id && await gaveta() === g3 - 40, "E2. no toca la caja de CEYRO");
  const cxp = exigir(await api("GET", "/campo/cxp", undefined, matriz), "E3. sale en sus cuentas");
  check(cxp.cuentas.some((c) => c.id === nota.cxp_id && c.origen === "EGRESO_CREDITO" && c.acreedor === "ROVINSON"), "E4. a favor de ROVINSON");

  const h = await revisar(q);
  check(!h?.length, "Z. consistencia sin hallazgos", h);
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
