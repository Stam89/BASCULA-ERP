// 💰 Auditoría de Caja: efectivo/banco por movimiento, traspaso entre ellos, arqueo al cerrar, saldo sugerido de la
// caja MIXTA, anular un movimiento de una caja ya cerrada, categorías manuales. SOLO contra la copia.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const SOBRE = { "x-confirmar": "SOBREGIRO" };

try {
  if (!(await q("SELECT 1 FROM information_schema.columns WHERE table_name='cash_movements' AND column_name='medio'")).length) {
    await q(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261085_caja_medio_arqueo.sql"), "utf8"));
    console.log("   (info) migración 20261085 aplicada en la COPIA");
  }
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja mixta sim", tipo: "MIXTO", opening_balance_cash: 500, opening_balance_bank: 1000 }), "0. abrir caja MIXTA ($500 efectivo + $1000 banco)");
  const sum = async (id = caja.id) => (await api("GET", `/cash/registers/${id}/summary`)).data;

  // ── A. Efectivo y banco por movimiento ──
  exigir(await api("POST", "/cash/movements", { cash_register_id: caja.id, movement: "INCOME", category: "VENTA", amount: 100, description: "venta al detalle" }), "A1. venta de $100 (efectivo por defecto)");
  const gas = exigir(await api("POST", `/cash/${caja.id}/movements`, { movement: "EXPENSE", category: "GAS", amount: 40, medio: "BANCO", description: "gas pagado por transferencia" }), "A2. gas de $40 pagado por el banco");
  const s1 = await sum();
  check(s1.saldo_efectivo === 600 && s1.saldo_banco === 960 && r2(s1.current_balance) === 1560, "A3. la caja separa: $600 en la gaveta y $960 en el banco (total $1560)", { ef: s1.saldo_efectivo, ba: s1.saldo_banco });
  const bal = exigir(await api("GET", "/finance/balance"), "A4. balance");
  check(bal.activo.corriente.efectivo === 600 && bal.activo.corriente.bancos === 960, "A5. el balance también separa efectivo y bancos (antes todo lo movido contaba como efectivo)", bal.activo.corriente);

  // ── B. Traspaso efectivo ↔ banco ──
  check((await api("POST", `/cash/registers/${caja.id}/traspaso`, { direccion: "DEPOSITO", monto: 700 })).status === 409, "B1. depositar más efectivo del que hay → 409");
  const tr = exigir(await api("POST", `/cash/registers/${caja.id}/traspaso`, { direccion: "DEPOSITO", monto: 200, descripcion: "papeleta 123" }), "B2. depositar $200 del efectivo al banco");
  const s2 = await sum();
  check(s2.saldo_efectivo === 400 && s2.saldo_banco === 1160 && r2(s2.current_balance) === 1560, "B3. $400 en la gaveta, $1160 en el banco, el total no cambia", { ef: s2.saldo_efectivo, ba: s2.saldo_banco });
  const er = exigir(await api("GET", `/finance/income-statement?desde=${new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" })}&hasta=${new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" })}`), "B4. estado de resultados");
  check(er.gastos_operativos.gastos_generales === 40, "B5. el traspaso no es gasto (solo cuenta el gas de $40)", er.gastos_operativos);
  exigir(await api("POST", `/cash/movements/${tr.entra.id}/reverse`, { reason: "papeleta equivocada" }), "B6. anular una línea del traspaso");
  const s3 = await sum();
  check(s3.saldo_efectivo === 600 && s3.saldo_banco === 960, "B7. se anulan las DOS líneas: vuelve a $600 / $960", { ef: s3.saldo_efectivo, ba: s3.saldo_banco });

  // ── C. Categorías manuales ──
  const manual = (category, movement = "EXPENSE", extra = {}) => api("POST", `/cash/${caja.id}/movements`, { movement, category, amount: 5, ...extra }, matriz, SOBRE);
  check((await manual("PAGO_AGRICULTOR")).status === 400, "C1. «Pago a agricultor» suelto (sin su liquidación) → 400");
  check((await manual("FOMENTOS")).status === 400, "C2. «Fomentos» suelto (va por Fomentos) → 400");
  check((await manual("PAGO_SERVICIO_PILADO")).status === 400, "C3. «Pago servicio de pilado» suelto (va por Por Pagar) → 400");
  check((await manual("NO_EXISTE")).status === 400, "C4. una categoría que no está en el catálogo → 400");
  check((await manual("GAS", "INCOME")).status === 400, "C5. una categoría de egreso usada como ingreso → 400");
  check((await manual("GAS", "EXPENSE", { reference_type: "accounts_payable", reference_id: caja.id })).status === 400, "C6. un movimiento manual no se puede enlazar a una cuenta → 400");
  check((await api("POST", "/expenses/labor-payments", { cash_register_id: caja.id, worker_group: "X", sacks_moved: 1, price_per_sack: 1 })).status === 410, "C7. el viejo «Pago de cuadrilla» por fuera de Nómina ya no se usa → 410");

  // ── D. Cerrar con arqueo ──
  const sD = await sum();
  check((await api("POST", `/cash/registers/${caja.id}/close`, { efectivo_contado: sD.saldo_efectivo - 10, banco_contado: sD.saldo_banco })).status === 400, "D1. el arqueo no cuadra y no hay motivo → 400 (sigue abierta)");
  const cierre = exigir(await api("POST", `/cash/registers/${caja.id}/close`, { efectivo_contado: sD.saldo_efectivo - 10, banco_contado: sD.saldo_banco, notas: "se pagó un taxi sin registrar" }), "D2. cerrar con $10 de faltante en efectivo y su motivo");
  const falt = (await q("SELECT category, amount::float a, medio FROM cash_movements WHERE cash_register_id=$1 AND reference_type='arqueo'", [caja.id]));
  const reg = (await q("SELECT closing_balance::float cb, closed_by, closing_diferencia::float d, closing_cash_counted::float cc FROM cash_registers WHERE id=$1", [caja.id]))[0];
  check(falt.length === 1 && falt[0].category === "FALTANTE_CAJA" && falt[0].a === 10 && falt[0].medio === "EFECTIVO", "D3. queda el «Faltante de caja» de $10 en efectivo", falt);
  check(reg.cb === r2(sD.current_balance - 10) && reg.closed_by && reg.d === -10 && reg.cc === sD.saldo_efectivo - 10, "D4. la caja guarda con cuánto cerró, quién la cerró y lo contado (antes no se guardaba)", reg);
  void cierre;

  // ── E. La siguiente caja mixta sugiere el saldo correcto ──
  const pe = (await api("GET", "/cash/registers/previous-balance?tipo=EFECTIVO")).data;
  const pb = (await api("GET", "/cash/registers/previous-balance?tipo=BANCO")).data;
  check(pe.final_balance === sD.saldo_efectivo - 10 && pb.final_balance === sD.saldo_banco, "E1. al abrir otra caja mixta sugiere el efectivo y el banco con que cerró (antes sugería $0)", { efectivo: pe.final_balance, banco: pb.final_balance });
  const caja2 = exigir(await api("POST", "/cash/registers/open", { name: "Caja mixta sim 2", tipo: "MIXTO", opening_balance_cash: pe.final_balance, opening_balance_bank: pb.final_balance }), "E2. abrir la caja del día siguiente con ese saldo");

  // ── F. Anular un movimiento de la caja ya cerrada ──
  exigir(await api("POST", `/cash/movements/${gas.id}/reverse`, { reason: "el gas se registró dos veces" }), "F1. anular el gas de ayer (caja cerrada)");
  const rev = (await q("SELECT cash_register_id, medio, amount::float a FROM cash_movements WHERE reversal_of=$1", [gas.id]))[0];
  check(rev.cash_register_id === caja2.id && rev.medio === "BANCO" && rev.a === 40, "F2. el contra-asiento entra a la caja ABIERTA (por el banco), no a la cerrada", rev);
  const regF = (await q("SELECT closing_balance::float cb FROM cash_registers WHERE id=$1", [caja.id]))[0];
  check(regF.cb === reg.cb, "F3. la caja cerrada no cambia su saldo de cierre");
  const arq = (await q("SELECT id FROM cash_movements WHERE cash_register_id=$1 AND reference_type='arqueo'", [caja.id]))[0];
  check((await api("POST", `/cash/movements/${arq.id}/reverse`, { reason: "probando anular arqueo" })).status === 409, "F4. el faltante del arqueo no se anula suelto → 409");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
