// 📒 Estado de cuenta con historial (pedido del dueño 2026-11-26): cuenta corriente donde el saldo sube (cargos) y baja
// (abonos). Saldo acumulado = anterior + cargo − abono; anular o corregir un movimiento rehace todo lo de después; saldada
// sin borrar historial y se reactiva con un cargo nuevo. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz, operador } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const kardex = async (lado, nombre, acc = matriz) => exigir(await api("GET", `/estado-cuenta?lado=${lado}&nombre=${encodeURIComponent(nombre)}`, undefined, acc), `kardex ${lado} ${nombre}`);
const cadena = (k) => k.movimientos.every((m, i, a) => r2((i ? a[i - 1].saldo : 0) + m.cargo - m.abono) === r2(m.saldo));
try {
  // A. Todas las cuentas que ya existen (de todos los socios, pendientes y saldadas) cuadran con su historial.
  const socios = await q("SELECT id, name FROM accionistas WHERE is_active ORDER BY name");
  let revisadas = 0, sinCuadrar = [];
  for (const s of socios) {
    for (const lado of ["CXC", "CXP"]) {
      const lista = (await api("GET", lado === "CXP" ? "/cash/payables" : "/receivable", undefined, s.id)).data;
      const nombres = new Set(lista.map((r) => String((lado === "CXP" ? r.farmer_name : r.customer_name) || r.description || "Sin nombre").trim().toUpperCase()));
      const saldadas = (await api("GET", `/estado-cuenta/saldadas?lado=${lado}`, undefined, s.id)).data;
      for (const x of saldadas) nombres.add(x.key);
      for (const n of nombres) {
        const k = (await api("GET", `/estado-cuenta?lado=${lado}&nombre=${encodeURIComponent(n)}`, undefined, s.id)).data;
        revisadas++;
        const pend = lista.filter((r) => String((lado === "CXP" ? r.farmer_name : r.customer_name) || r.description || "Sin nombre").trim().toUpperCase() === n);
        const saldoLista = r2(pend.reduce((a, r) => a + Number(r.balance), 0));
        if (!k.cuadra || !cadena(k) || r2(k.totales.saldo) !== saldoLista) sinCuadrar.push([s.name, lado, n, k.totales?.saldo, saldoLista, k.cuadra]);
      }
    }
  }
  check(revisadas > 0 && sinCuadrar.length === 0, `A1. ${revisadas} cuentas existentes: historial en cadena y saldo igual al de la tabla`, sinCuadrar.slice(0, 5));

  // B. Cuenta corriente nueva (como CECILIA SUELDO): deuda inicial, cargo de sueldo (gasto a crédito) y préstamo.
  const nombre = "SIM CECILIA KARDEX";
  const d0 = exigir(await api("POST", "/deudas-manuales", { lado: "CXP", nombre, monto: 1000, abonado: 0, fecha: "2026-10-31", detalle: "Sueldo acumulado al 31/10" }, matriz), "B1. saldo inicial de la cuenta");
  let k = await kardex("CXP", nombre);
  check(k.movimientos.length === 1 && k.totales.saldo === 1000 && k.estado === "PENDIENTE", "B2. un cargo y saldo 1,000", k.totales);
  check(k.contraparte.tipo === "PROVEEDOR", "B3. el cargo nuevo va a la misma persona", k.contraparte);
  const cat = (await q(`SELECT codigo FROM cash_categories WHERE tipo = 'EGRESO' AND activo AND aplicable_a IN ('AMBOS', 'MATRIZ')
                          AND codigo NOT IN ('PAGO_AGRICULTOR', 'FOMENTOS', 'PAGO_SERVICIO_PILADO') ORDER BY (nombre ILIKE '%sueldo%') DESC, codigo LIMIT 1`))[0].codigo;
  const c1 = exigir(await api("POST", "/deudas-manuales", { lado: "CXP", contraparte_tipo: k.contraparte.tipo, contraparte_id: k.contraparte.id, monto: 450, fecha: "2026-11-15", detalle: "Sueldo de noviembre", comprobante: "ROL-11", categoria: cat }, matriz), "B4. + cargo: sueldo del mes (gasto a crédito)");
  const apG = (await q("SELECT reference_type, categoria, supplier_id FROM accounts_payable WHERE id = $1", [c1.cuenta_id]))[0];
  check(apG.reference_type === "gasto_credito" && apG.categoria === cat, "B5. queda como gasto a crédito de su rubro", apG);
  const c2 = exigir(await api("POST", "/deudas-manuales", { lado: "CXP", contraparte_tipo: "PROVEEDOR", contraparte_id: k.contraparte.id, monto: 200, fecha: hoy, detalle: "Préstamo", comprobante: "REC-7" }, matriz), "B6. + cargo: préstamo");
  k = await kardex("CXP", nombre);
  check(k.movimientos.length === 3 && k.totales.saldo === 1650 && cadena(k), "B7. tres cargos en orden de fecha, saldo 1,650", k.movimientos.map((m) => [m.fecha.slice(0, 10), m.cargo, m.saldo]));
  check(k.movimientos[1].comprobante === "ROL-11" && k.movimientos[1].clase === "Gasto a crédito", "B8. con su comprobante y tipo", k.movimientos[1]);
  check(k.movimientos[0].cargo === 1000 && k.movimientos[2].saldo === 1650, "B9. saldo acumulado 1,000 → 1,450 → 1,650");

  // C. Abonos: uno por caja (de la más vieja a la más nueva) y otro que se anula.
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim kardex", tipo: "EFECTIVO", opening_balance_cash: 3000 }, matriz), "C1. caja");
  const ids = [d0.cuenta_id, c1.cuenta_id, c2.cuenta_id];
  exigir(await api("POST", "/cash/payables/pay-group", { payable_ids: ids, cash_register_id: caja.id, amount: 1200, comentario: "abono quincena" }, matriz), "C2. abono de 1,200");
  k = await kardex("CXP", nombre);
  const ab = k.movimientos.filter((m) => m.tipo === "ABONO");
  check(r2(ab.reduce((s, m) => s + m.abono, 0)) === 1200 && k.totales.saldo === 450 && cadena(k), "C3. el abono baja el saldo a 450", k.movimientos.map((m) => [m.clase, m.cargo, m.abono, m.saldo]));
  check(ab.every((m) => m.mov_id && m.anulable && m.comprobante), "C4. cada abono dice su comprobante de caja y se puede anular", ab);
  const catPago = (await q("SELECT category FROM cash_movements WHERE id = $1", [ab[0].mov_id]))[0].category;
  check(!!catPago, "C5. el pago quedó en caja", catPago);
  exigir(await api("POST", "/cash/payables/pay-group", { payable_ids: ids, cash_register_id: caja.id, amount: 100 }, matriz), "C6. otro abono de 100");
  k = await kardex("CXP", nombre);
  const ultimo = k.movimientos.filter((m) => m.tipo === "ABONO").at(-1);
  exigir(await api("POST", `/cash/movements/${ultimo.mov_id}/reverse`, { reason: "abono mal digitado" }, matriz), "C7. se anula el abono de 100");
  k = await kardex("CXP", nombre);
  check(k.totales.saldo === 450 && cadena(k) && k.movimientos.some((m) => m.clase === "Pago anulado" && m.cargo === 100), "C8. el saldo vuelve a 450 y queda el renglón «Pago anulado»", k.movimientos.map((m) => [m.clase, m.cargo, m.abono, m.saldo]));

  // D. Corregir un cargo intermedio: todo lo de después se rehace.
  const dmPrestamo = k.movimientos.find((m) => m.cuenta_id === c2.cuenta_id && m.tipo === "CARGO" && m.editable);
  exigir(await api("PATCH", `/deudas-manuales/${dmPrestamo.deuda_manual_id}`, { monto: 260, comprobante: "REC-7B", motivo: "era 260" }, matriz), "D1. corrige el préstamo de 200 a 260");
  k = await kardex("CXP", nombre);
  check(k.totales.saldo === 510 && cadena(k) && k.movimientos.find((m) => m.cuenta_id === c2.cuenta_id && m.tipo === "CARGO").cargo === 260, "D2. cargo nuevo 260 y saldo 510 en cadena", k.movimientos.map((m) => [m.clase, m.cargo, m.abono, m.saldo]));
  const dSueldo = k.movimientos.find((m) => m.cuenta_id === c1.cuenta_id && m.tipo === "CARGO");
  const pagadoSueldo = r2(450 - Number((await q("SELECT balance FROM accounts_payable WHERE id = $1", [c1.cuenta_id]))[0].balance));
  const d3 = await api("PATCH", `/deudas-manuales/${dSueldo.deuda_manual_id}`, { monto: 10, motivo: "prueba" }, matriz);
  check(pagadoSueldo > 10 ? d3.status === 409 : d3.ok, "D3. no deja bajar un cargo por debajo de lo ya abonado", mostrar(d3));
  const d4 = await api("PATCH", `/deudas-manuales/${dSueldo.deuda_manual_id}`, { fecha: "2099-01-01", motivo: "prueba" }, matriz);
  check(d4.status === 400, "D4. fecha futura: no");

  // E. Saldar: la cuenta queda «Saldada» con su historial; un cargo nuevo la reactiva.
  exigir(await api("POST", "/cash/payables/pay-group", { payable_ids: ids, cash_register_id: caja.id, amount: 510 }, matriz), "E1. paga el resto (510)");
  k = await kardex("CXP", nombre);
  check(k.estado === "SALDADA" && k.totales.saldo === 0 && k.movimientos.length >= 6 && cadena(k), "E2. saldada sin borrar el historial", [k.estado, k.movimientos.length]);
  const sald = (await api("GET", "/estado-cuenta/saldadas?lado=CXP", undefined, matriz)).data;
  check(sald.some((x) => x.key === nombre), "E3. aparece en «cuentas saldadas»");
  const pend = (await api("GET", "/cash/payables", undefined, matriz)).data;
  check(!pend.some((p) => ids.includes(p.id)), "E4. ya no sale en las pendientes");
  exigir(await api("POST", "/deudas-manuales", { lado: "CXP", contraparte_tipo: "PROVEEDOR", contraparte_id: k.contraparte.id, monto: 75, fecha: hoy, detalle: "Sueldo de diciembre (adelantado)" }, matriz), "E5. + cargo a la cuenta saldada");
  k = await kardex("CXP", nombre);
  check(k.estado === "PENDIENTE" && k.totales.saldo === 75 && cadena(k), "E6. se reactiva con saldo 75 y el historial completo", [k.estado, k.totales]);
  const sald2 = (await api("GET", "/estado-cuenta/saldadas?lado=CXP", undefined, matriz)).data;
  check(!sald2.some((x) => x.key === nombre), "E7. sale de las saldadas");

  // F. Anular un cargo sin abonos: queda como renglón informativo y no suma.
  const ultimoCargo = k.movimientos.filter((m) => m.tipo === "CARGO" && m.editable).at(-1);
  exigir(await api("POST", `/deudas-manuales/${ultimoCargo.deuda_manual_id}/anular`, { motivo: "registrado de más" }, matriz), "F1. anula el cargo de 75");
  k = await kardex("CXP", nombre);
  check(k.estado === "SALDADA" && k.totales.saldo === 0 && k.movimientos.some((m) => m.tipo === "INFO" && m.clase === "Anulado") && cadena(k), "F2. vuelve a saldada; el anulado queda visible sin sumar");

  // G. Por Cobrar: préstamo con abono inicial y cobro parcial.
  const g = exigir(await api("POST", "/deudas-manuales", { lado: "CXC", nombre: "SIM DEUDOR KARDEX", monto: 300, abonado: 50, fecha: "2026-09-10", detalle: "Préstamo" }, matriz), "G1. por cobrar con 50 ya abonados");
  exigir(await api("POST", `/receivable/${g.cuenta_id}/pay`, { amount: 100, cash_register_id: caja.id }, matriz), "G2. cobra 100");
  k = await kardex("CXC", "SIM DEUDOR KARDEX");
  check(k.totales.saldo === 150 && cadena(k) && k.movimientos.some((m) => m.clase === "Abonado antes de registrarla" && m.abono === 50), "G3. 300 − 50 − 100 = 150 en cadena", k.movimientos.map((m) => [m.clase, m.cargo, m.abono, m.saldo]));
  const g4 = await api("POST", "/deudas-manuales", { lado: "CXC", contraparte_tipo: "CLIENTE", contraparte_id: k.contraparte.id, monto: 20, fecha: hoy, categoria: cat }, matriz);
  check(g4.status === 400, "G4. en Por Cobrar no hay gasto a crédito", mostrar(g4));

  // H. Permisos: con Por Pagar se ve; sin módulos, no. Corregir pide «Anular».
  const conPagar = await operador("sim kardex pagar", ["EDIT:Por Pagar"]);
  const h1 = await conPagar("GET", `/estado-cuenta?lado=CXP&nombre=${encodeURIComponent(nombre)}`);
  check(h1.ok, "H1. operador de Por Pagar ve el estado de cuenta", mostrar(h1));
  const h2 = await conPagar("PATCH", `/deudas-manuales/${dmPrestamo.deuda_manual_id}`, { monto: 300, motivo: "sin permiso" });
  check(h2.status === 403, "H2. corregir un cargo pide el permiso «Anular»", mostrar(h2));
  const nada = await operador("sim kardex nada", ["Bascula"]);
  const h3 = await nada("GET", `/estado-cuenta?lado=CXP&nombre=${encodeURIComponent(nombre)}`);
  check(h3.status === 403, "H3. sin Caja / Por Cobrar / Por Pagar no lo ve", mostrar(h3));

  // I. La bitácora no cambió ningún saldo: todo cuadra entre módulos.
  const hall = await revisar(q);
  check(hall.length === 0, "I. consistencia entre módulos", hall.slice(0, 3));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
