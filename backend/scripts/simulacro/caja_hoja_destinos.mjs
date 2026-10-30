// 🧭 Caja hoja › «¿De quién?» y 💳 «No es efectivo» (pedido del dueño 2026-10-30): la fila rápida manda cada salida por
// su flujo (Transporte con cruce, anticipo = vale del operador, gasto de socio con cruce) y «pagado con banco» no mueve la
// gaveta (entra lo mismo como Retiro del banco). Anular el gasto anula también su entrada del banco. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 240)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
try {
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim hoja", tipo: "EFECTIVO", opening_balance_cash: 1000 }, matriz), "0. caja de CEYRO").id;
  const saldo = async () => Number((await q(
    `SELECT r.opening_balance + COALESCE(SUM(CASE WHEN m.movement='INCOME' THEN m.amount ELSE -m.amount END),0) AS s
       FROM cash_registers r LEFT JOIN cash_movements m ON m.cash_register_id = r.id WHERE r.id = $1 GROUP BY r.opening_balance`, [caja]))[0].s);
  const s0 = await saldo();

  // A. Gasto de CEYRO pagado con la tarjeta de débito
  const a = exigir(await api("POST", `/cash/${caja}/movements`, { movement: "EXPENSE", category: "DIESEL", amount: 233, description: "Diésel de ayer", pagado_con_banco: true }, matriz), "A1. diésel $233 pagado con tarjeta");
  const par = (await q("SELECT category, amount::float a FROM cash_movements WHERE reference_type='pagado_con_banco' AND reference_id=$1", [a.id]))[0];
  check(par && par.category === "RETIRO_BANCO" && par.a === 233, "A2. entra lo mismo como Retiro del banco", par);
  check(cerca(await saldo(), s0), "A3. la gaveta no cambia", await saldo());
  const solo = await api("POST", `/cash/movements/${(await q("SELECT id FROM cash_movements WHERE reference_type='pagado_con_banco' AND reference_id=$1", [a.id]))[0].id}/reverse`, { reason: "sim" }, matriz);
  check(solo.status === 409, "A4. la entrada del banco sola no se anula (se anula con el gasto)", mostrar(solo));
  exigir(await api("POST", `/cash/movements/${a.id}/reverse`, { reason: "sim anular gasto con banco" }, matriz), "A5. anular el gasto");
  const vivos = Number((await q("SELECT count(*)::int n FROM cash_movements WHERE reference_type='pagado_con_banco' AND reference_id=$1 AND reversed_at IS NULL", [a.id]))[0].n);
  check(vivos === 0 && cerca(await saldo(), s0), "A6. se anulan las dos líneas y la gaveta queda igual", { vivos, saldo: await saldo() });

  // B. Transporte con máquina, pagado con banco
  const maq = (await q("SELECT id, nombre FROM campo_activos WHERE activo ORDER BY nombre LIMIT 1"))[0];
  const b = exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: caja, categoria: "DIESEL", activo_id: maq.id, monto: 57, description: "Diésel cose", pagado_con_banco: true }, matriz), `B1. diésel de ${maq.nombre} con tarjeta`);
  const gB = (await q("SELECT id FROM cash_movements WHERE reference_type='campo_cxp' AND reference_id=$1", [b.cxp_id]))[0];
  const parB = (await q("SELECT amount::float a FROM cash_movements WHERE reference_type='pagado_con_banco' AND reference_id=$1", [gB.id]))[0];
  check(parB && parB.a === 57 && cerca(await saldo(), s0), "B2. Transporte: gasto + Retiro del banco, gaveta igual", { parB, saldo: await saldo() });
  exigir(await api("POST", `/cash/movements/${gB.id}/reverse`, { reason: "sim anular transporte banco" }, matriz), "B3. anular el gasto de Transporte");
  const cxpB = Number((await q("SELECT count(*)::int n FROM campo_cxp WHERE id=$1", [b.cxp_id]))[0].n);
  check(cxpB === 0 && cerca(await saldo(), s0), "B4. se deshace en Transporte y la gaveta queda igual", { cxpB, saldo: await saldo() });

  // C. Anticipo a operador con banco
  const op = (await q("SELECT nombre FROM campo_operadores WHERE activo ORDER BY nombre LIMIT 1"))[0].nombre;
  const c = exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: caja, monto: 5, description: "Anticipo", anticipo_operador: op, pagado_con_banco: true }, matriz), `C1. anticipo a ${op} con tarjeta`);
  const vale = (await q("SELECT estado FROM campo_movimientos WHERE par_id=$1 AND signo='salida'", [c.cxp_id]))[0];
  check(vale?.estado === "PENDIENTE_RENDICION" && cerca(await saldo(), s0), "C2. queda el vale del operador y la gaveta igual", { vale, saldo: await saldo() });

  // D. Gasto de un socio pagado en efectivo (sin banco): sale de la gaveta y se cruza
  const socio = (await q("SELECT id, name FROM accionistas WHERE tipo='SOCIO' AND is_active ORDER BY code LIMIT 1"))[0];
  const d = exigir(await api("POST", `/cash/${caja}/movements`, { movement: "EXPENSE", category: "ALIMENTACION", amount: 12, description: "Comida", por_cuenta_de: socio.id }, matriz), `D1. gasto de ${socio.name} en efectivo`);
  check(d.category === "GASTO_POR_SOCIO" && cerca(await saldo(), s0 - 12), "D2. queda como gasto del socio y sale de la gaveta", { cat: d.category, saldo: await saldo() });

  // E. Repuesto y mantenimiento de una máquina desde la hoja: entran a su hoja de vida en Transporte
  const e1 = exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: caja, categoria: "REPARACION_MANT", activo_id: maq.id, maintenance_type: "REPUESTO",
    items: [{ nombre: "Filtro de aceite", cantidad: 1, costo_unitario: 18, tipo: "REPUESTO" }], description: "Filtro de aceite" }, matriz), "E1. repuesto de la máquina (como lo manda la hoja)");
  const e2 = exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: caja, categoria: "REPARACION_MANT", activo_id: maq.id, maintenance_type: "CORRECTIVO",
    mano_obra: 30, description: "Soldadura de la plataforma" }, matriz), "E2. mantenimiento de la máquina (como lo manda la hoja)");
  const hv = await q("SELECT tipo, costo::float c FROM campo_mantenimientos WHERE cxp_id = ANY($1::uuid[]) ORDER BY costo", [[e1.cxp_id, e2.cxp_id]]);
  check(hv.length === 2 && hv[0].c === 18 && hv[1].c === 30, "E3. los dos quedan en la hoja de vida de la máquina", hv);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
