// ✍️ «+ Registrar deuda manual» en Por Cobrar / Por Pagar (pedido del dueño 2026-11-26): préstamo o deuda antigua
// sin mover caja; DEBE = monto, HABER = lo ya abonado, SALDO = DEBE − HABER; suma al total. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz, operador } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
try {
  const cajaMov = async () => Number((await q("SELECT count(*)::int n FROM cash_movements"))[0].n);
  const movAntes = await cajaMov();
  const totalCxC = async () => r2((await api("GET", "/receivable", undefined, matriz)).data.reduce((a, r) => a + Number(r.balance), 0));
  const totalCxCAntes = await totalCxC();

  // A. Le deben a la cuenta: persona nueva (se crea como cliente), con abono inicial.
  const a = exigir(await api("POST", "/deudas-manuales", { lado: "CXC", nombre: "sim prestamo  antiguo ana", monto: 500, abonado: 120.5, fecha: "2026-03-15", detalle: "Dinero antiguo prestado" }, matriz), "A1. registra la deuda por cobrar");
  const ar = (await q("SELECT * FROM accounts_receivable WHERE id = $1", [a.cuenta_id]))[0];
  check(r2(ar.amount) === 500 && r2(ar.balance) === 379.5 && ar.status === "PARTIAL" && ar.reference_type === "deuda_manual", "A2. DEBE 500, HABER 120.50, SALDO 379.50", [ar.amount, ar.balance, ar.status]);
  check(ar.accionista_id === matriz && ar.customer_id && a.contraparte_tipo === "CLIENTE" && a.contraparte === "SIM PRESTAMO ANTIGUO ANA", "A3. queda en la cuenta activa, como cliente nuevo", a);
  check(new Date(ar.created_at).toISOString().slice(0, 10) === "2026-03-15", "A4. con la fecha de la deuda (su antigüedad es la real)", ar.created_at);
  const lista = (await api("GET", "/receivable", undefined, matriz)).data;
  const fila = lista.find((r) => r.id === a.cuenta_id);
  check(fila && fila.customer_name === "SIM PRESTAMO ANTIGUO ANA", "A5. sale en Por Cobrar con su nombre", fila?.customer_name);
  check(r2(await totalCxC()) === r2(totalCxCAntes + 379.5), "A6. el total por cobrar sube en el saldo", [totalCxCAntes, await totalCxC()]);
  check(await cajaMov() === movAntes, "A7. no mueve la caja");

  // B. Misma persona otra vez: no se duplica el cliente.
  const b = exigir(await api("POST", "/deudas-manuales", { lado: "CXC", nombre: "SIM PRESTAMO ANTIGUO ANA", monto: 50, fecha: hoy }, matriz), "B1. segunda deuda de la misma persona");
  const clientes = (await q("SELECT count(*)::int n FROM customers WHERE lower(full_name) = 'sim prestamo antiguo ana'"))[0].n;
  check(clientes === 1, "B2. reutiliza el cliente", clientes);
  check((await q("SELECT status FROM accounts_receivable WHERE id = $1", [b.cuenta_id]))[0].status === "CONFIRMED", "B3. sin abono queda CONFIRMED");

  // C. Esta cuenta debe: proveedor nuevo.
  const c = exigir(await api("POST", "/deudas-manuales", { lado: "CXP", nombre: "Sim prestamista don luis", monto: 1000, abonado: 0, fecha: "2026-09-01" }, matriz), "C1. registra la deuda por pagar");
  const ap = (await q("SELECT * FROM accounts_payable WHERE id = $1", [c.cuenta_id]))[0];
  check(r2(ap.amount) === 1000 && r2(ap.balance) === 1000 && ap.supplier_id && ap.reference_type === "deuda_manual", "C2. por pagar 1,000 a un proveedor nuevo", [ap.amount, ap.balance, c.contraparte_tipo]);
  const pagos = (await api("GET", "/cash/payables", undefined, matriz)).data;
  check(pagos.some((p) => p.id === c.cuenta_id), "C3. sale en Por Pagar");

  // D. Lo que no se permite.
  const socio = (await q("SELECT name FROM accionistas WHERE tipo = 'SOCIO' LIMIT 1"))[0].name;
  const d1 = await api("POST", "/deudas-manuales", { lado: "CXC", nombre: socio, monto: 10, fecha: hoy }, matriz);
  check(d1.status === 400 && /Cuentas entre socios/.test(JSON.stringify(d1.data)), "D1. con un socio manda a «Cuentas entre socios»", mostrar(d1));
  const d2 = await api("POST", "/deudas-manuales", { lado: "CXC", nombre: "SIM OTRO", monto: 10, abonado: 10, fecha: hoy }, matriz);
  check(d2.status === 400, "D2. abonado igual al total: no", mostrar(d2));
  const d3 = await api("POST", "/deudas-manuales", { lado: "CXP", nombre: "SIM OTRO", monto: 10, fecha: "2099-01-01" }, matriz);
  check(d3.status === 400, "D3. fecha futura: no", mostrar(d3));
  const cli = (await q("SELECT id, full_name FROM customers ORDER BY created_at LIMIT 1"))[0];
  const d4 = await api("POST", "/deudas-manuales", { lado: "CXP", contraparte_tipo: "CLIENTE", contraparte_id: cli.id, nombre: cli.full_name, monto: 10, fecha: hoy }, matriz);
  check(d4.status === 400, "D4. Por Pagar no admite «cliente» elegido de la lista", mostrar(d4));

  // E. Cobrar una parte con la caja (botón de siempre) y luego anular.
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim deuda manual", tipo: "EFECTIVO", opening_balance_cash: 500 }, matriz), "E1. caja");
  exigir(await api("POST", `/receivable/${a.cuenta_id}/pay`, { amount: 79.5, cash_register_id: caja.id }, matriz), "E2. cobra 79.50");
  check(r2((await q("SELECT balance FROM accounts_receivable WHERE id = $1", [a.cuenta_id]))[0].balance) === 300, "E3. queda 300");
  const e4 = await api("POST", `/deudas-manuales/${a.id}/anular`, { motivo: "prueba con cobro" }, matriz);
  check(e4.status === 409, "E4. con un cobro hecho después no se anula", mostrar(e4));
  exigir(await api("POST", `/cash/payables/${c.cuenta_id}/pay`, { amount: 200, cash_register_id: caja.id }, matriz), "E5. paga 200 de la deuda por pagar");
  const cat = (await q("SELECT category FROM cash_movements WHERE cash_register_id = $1 AND movement = 'EXPENSE' ORDER BY created_at DESC LIMIT 1", [caja.id]))[0]?.category;
  check(cat === "PAGO_SALDO_INICIAL", "E6. el pago no cuenta como gasto del mes", cat);
  const e7 = exigir(await api("POST", `/deudas-manuales/${b.id}/anular`, { motivo: "registrada por error" }, matriz), "E7. anula la que no tiene cobros");
  const bAr = (await q("SELECT status, balance FROM accounts_receivable WHERE id = $1", [b.cuenta_id]))[0];
  check(e7.anulado && bAr.status === "CANCELLED" && Number(bAr.balance) === 0, "E8. sale de Por Cobrar", bAr);
  const reg = (await api("GET", "/deudas-manuales", undefined, matriz)).data;
  check(reg.length >= 3 && reg.find((x) => x.id === a.id)?.saldo === 300, "E9. la lista dice cuánto les queda", reg.slice(0, 3));

  // F. Permisos: con Por Cobrar se registra; sin módulos, no.
  const conPorCobrar = await operador("sim deuda cobrar", ["EDIT:Por Cobrar"]);
  const f1 = await conPorCobrar("POST", "/deudas-manuales", { lado: "CXC", nombre: "SIM PERMISO", monto: 5, fecha: hoy });
  check(f1.status === 201, "F1. operador de Por Cobrar puede registrar", mostrar(f1));
  const f2 = await conPorCobrar("POST", `/deudas-manuales/${f1.data?.id}/anular`, { motivo: "sin permiso" });
  check(f2.status === 403, "F2. anular pide el permiso «Anular»", mostrar(f2));
  const sinNada = await operador("sim deuda nada", ["Bascula"]);
  const f3 = await sinNada("POST", "/deudas-manuales", { lado: "CXC", nombre: "SIM PERMISO", monto: 5, fecha: hoy });
  check(f3.status === 403, "F3. sin Caja / Por Cobrar / Por Pagar no puede", mostrar(f3));

  const hall = await revisar(q);
  check(hall.length === 0, "G. consistencia entre módulos", hall.slice(0, 3));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
