// 👩‍💼 Sueldo que se deja acumular y se cobra a poco (pedido del dueño 2026-11-27, CECILIA): la cuenta por pagar lleva el
// rubro de sueldo (PAGO_MANO_OBRA) y CADA ABONO es gasto «Sueldo administrativo» del mes en que se paga (rubro «Sueldos»
// del Resultado mensual). Un préstamo / deuda sin rubro sigue sin ser gasto. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const [anio, mes] = hoy.split("-").map(Number);
const sueldos = async () => {
  const r = exigir(await api("GET", `/resultado-mensual?year=${anio}&month=${mes}`, undefined, matriz), "resultado mensual");
  const lista = JSON.stringify(r);
  const m = (r.rubros ?? []).find((x) => x.nombre === "Sueldos");
  return { total: Number(m?.gasto_total ?? 0), m: m?.detalle, tiene: lista.length > 0 };
};
try {
  const nombre = "SIM SUELDO ACUMULADO";
  // A. Lo acumulado antes (deuda manual) y luego se le pone el rubro de sueldo, como a CECILIA.
  const d0 = exigir(await api("POST", "/deudas-manuales", { lado: "CXP", nombre, monto: 1000, abonado: 0, fecha: "2026-10-31", detalle: "SUELDO ACUMULADO" }, matriz), "A1. sueldo acumulado (deuda manual)");
  await q("UPDATE accounts_payable SET categoria = 'PAGO_MANO_OBRA' WHERE id = $1", [d0.cuenta_id]);
  await q("UPDATE deudas_manuales SET categoria = 'PAGO_MANO_OBRA' WHERE id = $1", [d0.deuda_manual_id]);
  let k = exigir(await api("GET", `/estado-cuenta?lado=CXP&nombre=${encodeURIComponent(nombre)}`, undefined, matriz), "A2. estado de cuenta");
  check(k.rubro === "PAGO_MANO_OBRA" && k.contraparte.tipo === "PROVEEDOR", "A3. la cuenta se reconoce como de sueldo (el + cargo propone «Sueldo administrativo»)", { rubro: k.rubro, cp: k.contraparte });

  // B. Sueldo del mes con «+ Aumentar deuda» → Sueldo administrativo (aunque PAGO_MANO_OBRA no se elige a mano en Caja).
  const c1 = exigir(await api("POST", "/deudas-manuales", { lado: "CXP", contraparte_tipo: "PROVEEDOR", contraparte_id: k.contraparte.id, monto: 450, fecha: hoy, detalle: "Sueldo del mes", categoria: "PAGO_MANO_OBRA" }, matriz), "B1. + cargo: sueldo del mes");
  const ap1 = (await q("SELECT reference_type, categoria, description FROM accounts_payable WHERE id = $1", [c1.cuenta_id]))[0];
  check(ap1.reference_type === "gasto_credito" && ap1.categoria === "PAGO_MANO_OBRA" && /Sueldo administrativo/.test(ap1.description), "B2. queda como sueldo administrativo a crédito", ap1);
  const malo = await api("POST", "/deudas-manuales", { lado: "CXP", contraparte_tipo: "PROVEEDOR", contraparte_id: k.contraparte.id, monto: 10, fecha: hoy, categoria: "NO_EXISTE_SIM" }, matriz);
  check(malo.status === 400, "B3. un rubro que no existe se sigue rechazando", mostrar(malo));

  // C. Abonos: cada uno es gasto de sueldo del mes; el Resultado lo pone en «Sueldos».
  const antes = await sueldos();
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim sueldo", tipo: "EFECTIVO", opening_balance_cash: 3000 }, matriz), "C1. caja");
  const g = exigir(await api("POST", "/cash/payables/pay-group", { payable_ids: [d0.cuenta_id, c1.cuenta_id], cash_register_id: caja.id, amount: 300, comentario: "abono" }, matriz), "C2. abono de 300 (va a lo más viejo)");
  void g;
  const p1 = exigir(await api("POST", `/cash/payables/${c1.cuenta_id}/pay`, { cash_register_id: caja.id, amount: 100 }, matriz), "C3. abono de 100 al sueldo del mes");
  void p1;
  const movs = await q("SELECT category, reference_type, amount::float a FROM cash_movements WHERE cash_register_id = $1 AND movement = 'EXPENSE' AND reversed_at IS NULL ORDER BY created_at", [caja.id]);
  check(movs.length === 2 && movs.every((m) => m.category === "PAGO_MANO_OBRA" && m.reference_type === "accounts_payable"), "C4. los dos abonos salen como sueldo (PAGO_MANO_OBRA)", movs);
  const { tipoNomina } = await import(new URL("../../dist/services/resultado-mensual.js", import.meta.url).href);
  check(tipoNomina({ category: "PAGO_MANO_OBRA", reference_type: "accounts_payable", description: "Pago a SIM SUELDO ACUMULADO" }) === "SUELDO_ADMIN", "C5. el Resultado lo toma como sueldo administrativo");
  const despues = await sueldos();
  check(Math.abs(despues.total - antes.total - 400) < 0.01, `C6. rubro «Sueldos» del Resultado sube 400 (${antes.total} → ${despues.total})`, despues.m);
  k = exigir(await api("GET", `/estado-cuenta?lado=CXP&nombre=${encodeURIComponent(nombre)}`, undefined, matriz), "C7. estado de cuenta");
  check(k.totales.saldo === 1050 && k.cuadra, "C8. saldo 1,000 + 450 − 400 = 1,050", k.totales);

  // D. Un préstamo sin rubro sigue sin ser gasto.
  const d2 = exigir(await api("POST", "/deudas-manuales", { lado: "CXP", nombre: "SIM PRESTAMO SIN RUBRO", monto: 100, abonado: 0, fecha: hoy, detalle: "préstamo" }, matriz), "D1. préstamo");
  exigir(await api("POST", `/cash/payables/${d2.cuenta_id}/pay`, { cash_register_id: caja.id, amount: 50 }, matriz), "D2. abono al préstamo");
  const m2 = (await q("SELECT category FROM cash_movements WHERE reference_id = $1 AND reversed_at IS NULL", [d2.cuenta_id]))[0];
  check(m2?.category === "PAGO_SALDO_INICIAL", "D3. abono a un préstamo sin rubro: no es gasto (PAGO_SALDO_INICIAL)", m2);

  const hall = await revisar(q);
  check(hall.length === 0, "Z. consistencia entre módulos", hall.slice(0, 3));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
