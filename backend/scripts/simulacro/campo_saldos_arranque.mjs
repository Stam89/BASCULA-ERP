// 🚜 Transporte y Cosechadora › Configuración: estado de la configuración y SALDOS DE ARRANQUE (quién le debía, a quién
// le debía y el dinero en el banco al empezar). No son ingreso ni gasto del mes; si el que debe es un socio, lo ve en su
// Por Pagar. SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const CORTE = "2026-09-30";

try {
  // La base real ya puede tener su saldo inicial del banco: en la COPIA se quita para probar desde cero.
  await q("DELETE FROM campo_movimientos WHERE naturaleza = 'saldo_inicial'");
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const est0 = exigir(await api("GET", "/campo/config/estado", undefined, matriz), "0. estado de la configuración");
  check(typeof est0.flota === "number" && typeof est0.saldos_cobrar === "number", "0b. trae flota, operadores, tarifas, categorías, caja y saldos", est0);
  const resAntes = exigir(await api("GET", "/campo/reportes/estado-resultados?mes=2026-09", undefined, matriz), "0c. estado de resultados de septiembre (antes)");

  // ── A. Le deben a Transporte: un cliente externo y un socio ──
  const ext = exigir(await api("POST", "/campo/clientes", { nombre: "SIM DON ARANQUE", tipo: "externo" }, matriz), "A0. cliente externo");
  const a1 = exigir(await api("POST", "/campo/saldos-iniciales/cobrar", { cliente_id: ext.id, tipo: "cosecha", monto: 300, fecha: CORTE, nota: "cosecha de agosto" }, matriz), "A1. le debían $300 de cosecha");
  check(a1.espejo_socio === null, "A2. es externo: no hay espejo en ningún socio");
  const cliSocio = (await q("SELECT id FROM campo_clientes WHERE upper(nombre)='STALYN'"))[0]
    ?? exigir(await api("POST", "/campo/clientes", { nombre: "STALYN", tipo: "piladora" }, matriz), "A3a. cliente STALYN");
  const a3 = exigir(await api("POST", "/campo/saldos-iniciales/cobrar", { cliente_id: cliSocio.id, tipo: "flete", monto: 120, fecha: CORTE }, matriz), "A3. STALYN le debía $120 de fletes");
  check(a3.espejo_socio === "STALYN", "A4. a STALYN le aparece en su Por Pagar", a3);
  const ppS = (await api("GET", "/cash/payables", undefined, stalyn)).data.find((p) => p.reference_type === "campo_servicio" && p.reference_id === a3.id);
  check(ppS && Number(ppS.balance) === 120 && ppS.farmer_name === "Transporte y Cosechadora", "A5. Por Pagar de STALYN: $120 a «Transporte y Cosechadora»", ppS && { b: ppS.balance, n: ppS.farmer_name });
  const cxc = (await api("GET", "/campo/clientes/estado-cuenta?estado=pendiente", undefined, matriz)).data.clientes;
  check(cxc.find((c) => c.id === ext.id)?.saldo === 300, "A6. en Cuentas por Cobrar de Transporte el cliente debe $300");

  // ── B. Transporte le debe a alguien ──
  const b1 = exigir(await api("POST", "/campo/saldos-iniciales/pagar", { acreedor: "Taller sim", monto: 80, fecha: CORTE, nota: "repuestos" }, matriz), "B1. Transporte le debía $80 al taller");
  check(b1.acreedor === "TALLER SIM" && b1.saldo === 80, "B2. queda en Cuentas por Pagar de Transporte por $80", b1);

  // ── C. Dinero en el banco al arrancar ──
  const bancoAntes = (await api("GET", "/campo/cuentas", undefined, matriz)).data.find((c) => c.nombre === "BANCO").saldo;
  exigir(await api("POST", "/campo/saldos-iniciales/banco", { monto: 500, fecha: CORTE }, matriz), "C1. había $500 en el banco");
  const bancoDesp = (await api("GET", "/campo/cuentas", undefined, matriz)).data.find((c) => c.nombre === "BANCO").saldo;
  check(Math.round((bancoDesp - bancoAntes) * 100) / 100 === 500, "C2. el banco de Transporte sube $500", { bancoAntes, bancoDesp });
  const otra = await api("POST", "/campo/saldos-iniciales/banco", { monto: 10, fecha: CORTE }, matriz);
  check(otra.status === 409, "C3. no se registra dos veces", mostrar(otra));

  // ── D. No es ingreso ni gasto del mes ──
  const resDesp = exigir(await api("GET", "/campo/reportes/estado-resultados?mes=2026-09", undefined, matriz), "D0. estado de resultados de septiembre (después)");
  check(resDesp.ingresos.total === resAntes.ingresos.total, "D1. los ingresos de septiembre no cambian", { antes: resAntes.ingresos.total, despues: resDesp.ingresos.total });
  check(resDesp.total_gastos === resAntes.total_gastos, "D2. los gastos de septiembre no cambian", { antes: resAntes.total_gastos, despues: resDesp.total_gastos });
  const est1 = exigir(await api("GET", "/campo/config/estado", undefined, matriz), "D3. estado de la configuración");
  check(est1.saldos_cobrar === est0.saldos_cobrar + 2 && est1.saldos_pagar === est0.saldos_pagar + 1 && est1.saldo_banco === est0.saldo_banco + 1, "D4. el estado cuenta los saldos de arranque", est1);

  // ── E. Abonos y quitar ──
  const sesion = (await api("POST", "/campo/caja/abrir", { saldo_inicial: 0 }, matriz));
  check(sesion.ok || sesion.status === 409, "E0. caja de Transporte abierta", mostrar(sesion));
  const caja = (await api("GET", "/campo/cuentas", undefined, matriz)).data.find((c) => c.nombre === "CAJA");
  exigir(await api("POST", "/campo/cxc/abono", { cliente_id: ext.id, monto: 100, cuenta_id: caja.id }, matriz), "E1. el cliente abona $100");
  const lista = exigir(await api("GET", "/campo/saldos-iniciales", undefined, matriz), "E2. lista de saldos");
  const fila = lista.cobrar.find((x) => x.id === a1.id);
  check(fila?.cobrado === 100 && fila?.saldo === 200, "E3. el saldo inicial queda con $100 cobrados y $200 por cobrar", fila);
  const conAbono = await api("DELETE", `/campo/saldos-iniciales/cobrar/${a1.id}`, undefined, matriz);
  check(conAbono.status === 409, "E4. con abonos no se puede quitar", mostrar(conAbono));
  exigir(await api("DELETE", `/campo/saldos-iniciales/cobrar/${a3.id}`, undefined, matriz), "E5. se quita el saldo de STALYN (cargado por error)");
  check(!(await q("SELECT 1 FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [a3.id])).length, "E6. … y desaparece de su Por Pagar");
  exigir(await api("DELETE", `/campo/cxp/${b1.id}`, undefined, matriz), "E7. se quita la deuda con el taller");
  exigir(await api("DELETE", `/campo/saldos-iniciales/banco/${lista.banco[0].id}`, undefined, matriz), "E8. se quita el saldo del banco");
  const bancoFin = (await api("GET", "/campo/cuentas", undefined, matriz)).data.find((c) => c.nombre === "BANCO").saldo;
  check(bancoFin === bancoAntes, "E9. el banco vuelve a como estaba");

  // ── F. Categorías de gasto ──
  const cat = exigir(await api("POST", "/campo/categorias-gasto", { nombre: "llantas sim" }, matriz), "F1. se agrega la categoría LLANTAS SIM");
  check(cat.nombre === "LLANTAS SIM", "F2. queda en mayúsculas", cat);

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
