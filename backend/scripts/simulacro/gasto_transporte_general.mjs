// 🚜 Gasto de Transporte SIN máquina pagado por la caja de CEYRO (pedido del dueño 2026-10-22): diésel de Transporte
// por transferencia. Va a Transporte con su categoría, se descuenta de lo que CEYRO le debía y el resto queda por
// cobrar; anularlo en Caja deshace el cruce. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const reg = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim transporte", tipo: "MIXTO", opening_balance_cash: 1000, opening_balance_bank: 1000 }, matriz), "0. caja de CEYRO");
  const rid = reg.id;
  const saldo = async (medio) => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1 AND ($2::text IS NULL OR medio=$2)", [rid, medio ?? null]))[0].s);
  const cos = (await q("SELECT id FROM campo_activos WHERE activo ORDER BY nombre LIMIT 1"))[0];
  const cli = (await q("SELECT id FROM campo_clientes WHERE nombre = (SELECT name FROM accionistas WHERE id=$1)", [matriz]))[0]
    ?? (await q("INSERT INTO campo_clientes (nombre, tipo) SELECT name, 'piladora' FROM accionistas WHERE id=$1 RETURNING id", [matriz]))[0];
  // (copia) CEYRO le debe a Transporte un flete de $60
  await q("UPDATE accounts_payable SET balance=0, status='PAID' WHERE accionista_id=$1 AND reference_type='campo_servicio'", [matriz]);
  const sv = (await q("INSERT INTO campo_servicios (fecha, cliente_id, activo_id, tipo, qq, precio_unitario, valor, notas) VALUES (CURRENT_DATE, $1, $2, 'flete', 40, 1.5, 60, 'SIM flete a CEYRO') RETURNING id", [cli.id, cos.id]))[0];
  await q("INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'campo_servicio',$2,'SIM flete Transporte',60,60,'CONFIRMED')", [matriz, sv.id]);

  // A. Diésel de Transporte, sin máquina, por transferencia
  const b0 = await saldo("BANCO"), e0 = await saldo("EFECTIVO");
  const r = exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: rid, categoria: "DIESEL", monto: 100, description: "SIM diésel", pagado_a: "Gasolinera Ortiz", medio_pago: "BANCO" }, matriz), "A1. CEYRO paga $100 de diésel de Transporte");
  check(r.total === 100 && r.descontado === 60 && r.por_cobrar === 40 && r.maquina === null, "A2. se descuentan $60 de lo que debía y quedan $40 por cobrar", r);
  check(Math.abs((await saldo("BANCO")) - (b0 - 100)) < 0.01 && Math.abs((await saldo("EFECTIVO")) - e0) < 0.01, "A3. sale del banco (transferencia), no del efectivo");
  const cxp = (await q("SELECT c.monto::float m, c.activo_id, c.compensacion_id, g.nombre cat, c.concepto FROM campo_cxp c LEFT JOIN campo_categorias_gasto g ON g.id=c.categoria_id WHERE c.id=$1", [r.cxp_id]))[0];
  check(cxp.m === 100 && cxp.cat === "DIESEL" && cxp.activo_id === null && cxp.compensacion_id && /Gasolinera Ortiz/.test(cxp.concepto), "A4. en Transporte: gasto de DIESEL por $100, con el cruce guardado", cxp);
  check(Number((await q("SELECT count(*)::int n FROM campo_mantenimientos WHERE cxp_id=$1", [r.cxp_id]))[0].n) === 0, "A5. sin máquina no hay hoja de vida");
  check(Number((await q("SELECT balance::float b FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [sv.id]))[0].b) === 0, "A6. la deuda de CEYRO con Transporte quedó en $0");

  // B. Diésel para una máquina (sin trabajo): va a esa máquina, sin hoja de vida
  const r2 = exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: rid, activo_id: cos.id, categoria: "DIESEL", monto: 30, description: "SIM diésel máquina", medio_pago: "EFECTIVO" }, matriz), "B1. $30 de diésel para una máquina de Transporte");
  const c2 = (await q("SELECT activo_id FROM campo_cxp WHERE id=$1", [r2.cxp_id]))[0];
  check(c2.activo_id === cos.id && r2.por_cobrar === 30, "B2. queda en esa máquina y todo por cobrar", { c2, r2 });
  const sinNada = await api("POST", "/equipment/transporte/gasto", { cash_register_id: rid, monto: 10, description: "x" }, matriz);
  check(sinNada.status === 400, "B3. sin máquina ni categoría no se acepta", mostrar(sinNada));

  // C. Anular el diésel general en Caja: vuelve la plata y CEYRO vuelve a deber los $60
  const mov = (await q("SELECT id FROM cash_movements WHERE reference_type='campo_cxp' AND reference_id=$1", [r.cxp_id]))[0];
  exigir(await api("POST", `/cash/movements/${mov.id}/reverse`, { reason: "SIM se registró mal" }, matriz), "C1. anular el diésel en Caja");
  check(Math.abs((await saldo("BANCO")) - b0) < 0.01, "C2. la plata vuelve al banco");
  check(Number((await q("SELECT balance::float b FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [sv.id]))[0].b) === 60, "C3. el cruce se deshace: CEYRO vuelve a deber $60");
  const quedan = (await q("SELECT (SELECT count(*) FROM campo_cxp WHERE id=$1)::int cxp, (SELECT status::text FROM accounts_receivable WHERE id=$2) ar", [r.cxp_id, r.receivable_id]))[0];
  check(quedan.cxp === 0 && quedan.ar === "CANCELLED", "C4. se borra el gasto en Transporte y se anula la Por Cobrar", quedan);

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
