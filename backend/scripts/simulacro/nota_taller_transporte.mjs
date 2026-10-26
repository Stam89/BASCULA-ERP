// 🧾 Nota del taller con varios renglones en Transporte (pedido del dueño 2026-10-26): repuestos + mano de obra de una
// misma nota. Cada renglón queda en la hoja de vida; de la cuenta sale UN egreso por el total (o UNA CxP a crédito).
// Reversar el egreso anula todos los renglones; eliminar la CxP los quita. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const LINEAS = [
  { cantidad: 1.25, descripcion: "Chicote batería 1/0", clase: "REPUESTO", valor: 22 },
  { cantidad: 1, descripcion: "Borne de batería", clase: "REPUESTO", valor: 3 },
  { cantidad: 1, descripcion: "Terminal de cobre", clase: "REPUESTO", valor: 3 },
  { cantidad: 1, descripcion: "Porta fusible", clase: "REPUESTO", valor: 3 },
  { cantidad: 2, descripcion: "Rulimanes", clase: "REPUESTO", valor: 12 },
  { cantidad: 1, descripcion: "Reparación placa de diodo alternador", clase: "MANO_OBRA", valor: 25 },
  { cantidad: 1, descripcion: "Mantenimiento arranque y alternador", clase: "MANO_OBRA", valor: 70 }
];
try {
  const activo = (await q("SELECT id, nombre FROM campo_activos WHERE activo ORDER BY nombre LIMIT 1"))[0];
  if (!activo) throw new Error("la copia no tiene maquinaria en Transporte");
  // Cuenta de prueba con saldo (sin caja de sesión): se carga con un ingreso.
  const cuenta = (await q("SELECT id FROM campo_cuentas WHERE nombre='BANCO' LIMIT 1"))[0];
  exigir(await api("POST", "/campo/movimientos", { cuenta_id: cuenta.id, signo: "entrada", monto: 500, concepto: "SIM fondo nota taller" }), "0. fondo de prueba en BANCO");
  const saldo = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN signo='entrada' THEN monto ELSE -monto END),0)::float s FROM campo_movimientos WHERE cuenta_id=$1", [cuenta.id]))[0].s);

  // A. Contado
  const s0 = await saldo();
  const a = exigir(await api("POST", "/campo/mantenimientos/nota", {
    activo_id: activo.id, tipo: "CORRECTIVO", proveedor: "Taller eléctrico SIM", factura: "001", modalidad_pago: "CONTADO", cuenta_id: cuenta.id, lineas: LINEAS
  }), "A1. registrar la nota de 7 renglones al contado");
  check(a.total === 138 && a.renglones.length === 7, "A2. total $138.00 y 7 renglones", { total: a.total });
  check(r2(s0 - await saldo()) === 138, "A3. de la cuenta sale UN solo pago de $138.00", r2(s0 - await saldo()));
  const movs = (await q("SELECT count(*)::int n FROM campo_movimientos WHERE id=$1", [a.movimiento_id]))[0].n;
  const mts = await q("SELECT costo::float c, clase, movimiento_id FROM campo_mantenimientos WHERE nota_id=$1", [a.nota_id]);
  check(movs === 1 && mts.length === 7 && mts.every((m) => m.movimiento_id === a.movimiento_id), "A4. los 7 renglones en la hoja de vida, ligados al mismo egreso");
  check(mts.filter((m) => m.clase === "MANO_OBRA").length === 2 && r2(mts.reduce((x, m) => x + m.c, 0)) === 138, "A5. 5 repuestos + 2 de mano de obra que suman $138");
  const em = (await q("SELECT count(*)::int n FROM equipment_maintenance WHERE campo_mantenimiento_id IN (SELECT id FROM campo_mantenimientos WHERE nota_id=$1)", [a.nota_id]))[0].n;
  check(em === 7, "A6. también en el historial de mantenimiento (Caja principal → Mantenimiento)", em);
  const hist = exigir(await api("GET", `/campo/mantenimientos?activo_id=${activo.id}`), "A7. hoja de vida de la máquina");
  check(hist.some((h) => h.componente === "Rulimanes"), "A8. se puede encontrar cada repuesto (Rulimanes)");
  // Reversar el egreso anula los 7 renglones.
  exigir(await api("POST", `/campo/movimientos/${a.movimiento_id}/reversar`, { motivo: "SIM nota mal registrada" }), "A9. reversar el egreso de la nota");
  const anul = (await q("SELECT count(*)::int n FROM campo_mantenimientos WHERE nota_id=$1 AND anulado_at IS NOT NULL", [a.nota_id]))[0].n;
  check(anul === 7 && r2(s0 - await saldo()) === 0, "A10. reversado: los 7 renglones quedan anulados y la plata vuelve", { anul });

  // B. Crédito
  const s1 = await saldo();
  const b = exigir(await api("POST", "/campo/mantenimientos/nota", {
    activo_id: activo.id, tipo: "CORRECTIVO", proveedor: "Taller eléctrico SIM", modalidad_pago: "CREDITO", lineas: LINEAS
  }), "B1. la misma nota a crédito");
  const cxp = (await q("SELECT monto::float m, acreedor, origen FROM campo_cxp WHERE id=$1", [b.cxp_id]))[0];
  check(cxp.m === 138 && cxp.origen === "EGRESO_CREDITO" && r2(await saldo()) === r2(s1), "B2. queda UNA cuenta por pagar de $138.00 al taller y no sale plata", cxp);
  check((await q("SELECT count(*)::int n FROM campo_mantenimientos WHERE cxp_id=$1", [b.cxp_id]))[0].n === 7, "B3. los 7 renglones en la hoja de vida ligados a esa cuenta");
  exigir(await api("DELETE", `/campo/cxp/${b.cxp_id}`), "B4. eliminar la cuenta por pagar (admin)");
  check((await q("SELECT count(*)::int n FROM campo_mantenimientos WHERE nota_id=$1", [b.nota_id]))[0].n === 0, "B5. se van también sus renglones de la hoja de vida");

  // C. Validaciones
  const sinCuenta = await api("POST", "/campo/mantenimientos/nota", { activo_id: activo.id, modalidad_pago: "CONTADO", lineas: LINEAS });
  check(sinCuenta.status === 400, "C1. al contado sin cuenta se rechaza", mostrar(sinCuenta));
  const sinProv = await api("POST", "/campo/mantenimientos/nota", { activo_id: activo.id, modalidad_pago: "CREDITO", lineas: LINEAS });
  check(sinProv.status === 400, "C2. a crédito sin taller se rechaza", mostrar(sinProv));
  const sinLineas = await api("POST", "/campo/mantenimientos/nota", { activo_id: activo.id, modalidad_pago: "CONTADO", cuenta_id: cuenta.id, lineas: [] });
  check(sinLineas.status === 400, "C3. sin renglones se rechaza", mostrar(sinLineas));

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
