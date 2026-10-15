// 🚜 La caja de CEYRO paga una reparación de una máquina de Transporte: el gasto va a Transporte, se descuenta de lo
// que CEYRO le debía (cruce) y el resto queda por cobrar; Transporte paga → entra a la caja de CEYRO; anular. SOLO copia.
import fs from "fs";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261103_gasto_transporte_matriz.sql", import.meta.url), "utf8"));
  const reg = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim transporte", tipo: "EFECTIVO", opening_balance_cash: 1000 }, matriz), "0. caja de CEYRO");
  const rid = reg.id;
  const saldo = async () => Number((await q("SELECT COALESCE(SUM(CASE WHEN movement='INCOME' THEN amount ELSE -amount END),0)::float s FROM cash_movements WHERE cash_register_id=$1", [rid]))[0].s);
  const cos = (await q("SELECT id FROM campo_activos WHERE activo AND tipo='cosechadora' ORDER BY nombre LIMIT 1"))[0];
  const cli = (await q("SELECT id FROM campo_clientes WHERE nombre = (SELECT name FROM accionistas WHERE id=$1)", [matriz]))[0];
  // (copia) CEYRO le debe a Transporte un flete de $120, con su Por Pagar espejo
  await q("UPDATE accounts_payable SET balance=0, status='PAID' WHERE accionista_id=$1 AND reference_type='campo_servicio'", [matriz]);
  const sv = (await q("INSERT INTO campo_servicios (fecha, cliente_id, activo_id, tipo, qq, precio_unitario, valor, notas) VALUES (CURRENT_DATE, $1, $2, 'flete', 80, 1.5, 120, 'SIM flete a CEYRO') RETURNING id", [cli.id, cos.id]))[0];
  await q("INSERT INTO accounts_payable (accionista_id, reference_type, reference_id, description, amount, balance, status) VALUES ($1,'campo_servicio',$2,'SIM flete Transporte',120,120,'CONFIRMED')", [matriz, sv.id]);
  const c0 = exigir(await api("GET", "/equipment/transporte/cuentas-matriz", undefined, matriz), "A0. cuentas CEYRO con Transporte");
  check(c0.debe === 120, "A1. CEYRO le debe $120 a Transporte", c0);
  const s0 = await saldo();
  const r = exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: rid, activo_id: cos.id, maintenance_type: "CORRECTIVO", description: "SIM cambio de banda", provider: "Jacobo", hecho_por_tipo: "EXTERNO", comprado_por: "Jacobo", mano_obra: 100, items: [{ nombre: "Banda cosechadora", cantidad: 1, costo_unitario: 50, tipo: "REPUESTO" }] }, matriz), "B1. CEYRO paga $150 de reparación de la cosechadora");
  check(r.total === 150 && r.descontado === 120 && r.por_cobrar === 30, "B2. se descuentan $120 de lo que debía y quedan $30 por cobrar", r);
  check(Math.abs((await saldo()) - (s0 - 150)) < 0.01, "B3. salen $150 de la caja de CEYRO");
  const ap = (await q("SELECT balance::float b FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [sv.id]))[0];
  check(ap.b === 0, "B4. la deuda de CEYRO con Transporte quedó en $0", ap);
  const ar = (await q("SELECT balance::float b, status FROM accounts_receivable WHERE id=$1", [r.receivable_id]))[0];
  check(ar.b === 30 && ar.status === "PARTIAL", "B5. CEYRO tiene por cobrar $30 a Transporte", ar);
  const mant = (await q("SELECT costo::float c, proveedor FROM campo_mantenimientos WHERE cxp_id=$1", [r.cxp_id]))[0];
  check(mant && mant.c === 150 && mant.proveedor === "Jacobo", "B6. queda en la hoja de vida de la cosechadora en Transporte", mant);
  const hoy = new Date();
  const res = exigir(await api("GET", `/resultado-mensual?year=${hoy.getFullYear()}&month=${hoy.getMonth() + 1}`, undefined, matriz), "B7. costos de CEYRO");
  check(!JSON.stringify(res).includes("SIM cambio de banda"), "B8. no es costo operativo de CEYRO");
  const cobrarAqui = await api("POST", `/receivable/${r.receivable_id}/pay`, { amount: 10, cash_register_id: rid }, matriz);
  check(cobrarAqui.status === 409, "B9. no se cobra desde Por Cobrar de CEYRO (lo paga Transporte)", cobrarAqui.status);

  // Transporte le paga los $30 desde su caja: entran a la caja de CEYRO
  const cajaT = (await q("SELECT id FROM campo_cuentas WHERE nombre='CAJA'"))[0];
  const s1 = await saldo();
  await q("INSERT INTO campo_movimientos (fecha, cuenta_id, signo, monto, concepto, cxp_id) VALUES (CURRENT_DATE, $1, 'salida', 30, 'SIM pago a CEYRO', $2)", [cajaT.id, r.cxp_id]);
  check(Math.abs((await saldo()) - (s1 + 30)) < 0.01, "C1. Transporte paga $30 y entran a la caja de CEYRO");
  check(Number((await q("SELECT balance::float b FROM accounts_receivable WHERE id=$1", [r.receivable_id]))[0].b) === 0, "C2. la Por Cobrar de CEYRO queda en $0");
  const rev1 = (await q("SELECT id FROM cash_movements WHERE reference_type='campo_cxp' AND reference_id=$1", [r.cxp_id]))[0];
  const bloq = await api("POST", `/cash/movements/${rev1.id}/reverse`, { reason: "SIM prueba" }, matriz);
  check(bloq.status === 409, "C3. ya pagado por Transporte: no se anula sin anular ese pago", mostrar(bloq));

  // Otro gasto sin deuda previa: todo por cobrar; y se anula
  const r2 = exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: rid, activo_id: cos.id, maintenance_type: "PREVENTIVO", description: "SIM aceite", hecho_por_tipo: "PROPIO", mano_obra: 0, items: [{ nombre: "Aceite", cantidad: 2, costo_unitario: 20, tipo: "INSUMO" }] }, matriz), "D1. gasto de $40 sin deuda previa");
  check(r2.descontado === 0 && r2.por_cobrar === 40, "D2. todo queda por cobrar a Transporte", r2);
  const mov2 = (await q("SELECT id FROM cash_movements WHERE reference_type='campo_cxp' AND reference_id=$1", [r2.cxp_id]))[0];
  const s2 = await saldo();
  exigir(await api("POST", `/cash/movements/${mov2.id}/reverse`, { reason: "SIM se registró mal" }, matriz), "D3. anular el egreso en Caja");
  check(Math.abs((await saldo()) - (s2 + 40)) < 0.01, "D4. la plata vuelve a la caja");
  const quedan = (await q("SELECT (SELECT count(*) FROM campo_cxp WHERE id=$1)::int cxp, (SELECT count(*) FROM campo_mantenimientos WHERE cxp_id=$1)::int mant, (SELECT status::text FROM accounts_receivable WHERE id=$2) ar", [r2.cxp_id, r2.receivable_id]))[0];
  check(quedan.cxp === 0 && quedan.mant === 0 && quedan.ar === "CANCELLED", "D5. se borran el gasto y la hoja de vida en Transporte y se anula la Por Cobrar", quedan);

  // Anular el primero deshace el cruce: CEYRO vuelve a deber $120 (antes se quita el pago de Transporte)
  await q("DELETE FROM campo_movimientos WHERE cxp_id=$1 AND concepto='SIM pago a CEYRO'", [r.cxp_id]);
  await q("DELETE FROM cash_movements WHERE reference_type='accounts_receivable' AND reference_id=$1 AND category='COBRO_CREDITO'", [r.receivable_id]);
  exigir(await api("POST", `/cash/movements/${rev1.id}/reverse`, { reason: "SIM se registró mal" }, matriz), "E1. anular el primer gasto");
  check(Number((await q("SELECT balance::float b FROM accounts_payable WHERE reference_type='campo_servicio' AND reference_id=$1", [sv.id]))[0].b) === 120, "E2. el cruce se deshace: CEYRO vuelve a deber $120 a Transporte");

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
