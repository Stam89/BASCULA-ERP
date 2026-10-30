// 👷 Anticipo a operador desde la caja de la Matriz (pedido del dueño 2026-10-29): queda como VALE del operador en
// Transporte (la nómina lo propone como descuento), no es gasto en su Estado de Resultados, y anularlo en Caja borra
// el vale. Más: un parte en una máquina sin tarifa usa la tarifa del operador en otra máquina del mismo tipo. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const matriz = (await q("SELECT id FROM accionistas WHERE tipo='MATRIZ' LIMIT 1"))[0].id;
  const caja = (await q("SELECT id FROM cash_registers WHERE accionista_id=$1 AND status='OPEN' ORDER BY opened_at DESC LIMIT 1", [matriz]))[0]?.id
    ?? exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 1000 }, matriz), "0. caja de CEYRO").id;
  const ops = await q("SELECT nombre FROM campo_operadores WHERE activo ORDER BY nombre");
  const op = ops.find((o) => o.nombre === "LEONEL")?.nombre ?? ops[0].nombre;
  const valesAntes = Number((await q("SELECT count(*)::int n FROM campo_movimientos WHERE estado='PENDIENTE_RENDICION' AND concepto ILIKE $1", [`%${op}%`]))[0].n);

  const r = exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: caja, monto: 7.5, description: "Anticipo", anticipo_operador: op }, matriz), `1. anticipo de $7.50 a ${op} desde la caja de la Matriz`);
  const vale = (await q("SELECT id, monto::float m, cuenta_id FROM campo_movimientos WHERE par_id=$1 AND signo='salida'", [r.cxp_id]))[0];
  check(vale && vale.m === 7.5, "2. queda un vale pendiente del operador en Transporte", vale);
  const cxp = (await q("SELECT origen, categoria_id FROM campo_cxp WHERE id=$1", [r.cxp_id]))[0];
  check(cxp.origen === "ANTICIPO_MATRIZ" && cxp.categoria_id === null, "3. Transporte le debe a la Matriz (sin categoría de gasto)", cxp);
  const mov = (await q("SELECT category, amount::float a FROM cash_movements WHERE reference_type='campo_cxp' AND reference_id=$1", [r.cxp_id]))[0];
  check(mov && mov.a === 7.5, "4. sale de la caja de la Matriz", mov);

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
  const m = exigir(await api("GET", `/campo/nomina-operadores/matriz?periodo_desde=${hoy}&periodo_hasta=${hoy}`, undefined, matriz), "5. nómina de operadores");
  const filasOp = m.filas.filter((f) => f.operador === op);
  check(filasOp.some((f) => f.vales.some((v) => v.id === vale.id)), "6. la nómina propone el anticipo como descuento del operador", filasOp.map((f) => f.vales));
  const sinTarifa = m.filas.filter((f) => f.parte_ids.length && f.sin_tarifa && f.operador === op);
  check(sinTarifa.length === 0, "7. sus partes en otra máquina del mismo tipo ya tienen tarifa (la de su otra máquina)", m.filas.filter((f) => f.operador === op).map((f) => [f.activo_nombre, f.tarifa, f.tarifa_de_maquina]));

  const enEr = (await q(`SELECT count(*)::int n FROM campo_cxp WHERE id=$1 AND COALESCE(origen,'') NOT IN ('SALDO_INICIAL','ANTICIPO_MATRIZ')`, [r.cxp_id]))[0].n;
  check(enEr === 0, "9. el anticipo no entra como gasto en el Estado de Resultados de Transporte");

  const h0 = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h0.length === 0, "9b. integridad con el anticipo vivo", h0.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
  const movId = (await q("SELECT id FROM cash_movements WHERE reference_type='campo_cxp' AND reference_id=$1", [r.cxp_id]))[0].id;
  exigir(await api("POST", `/cash/movements/${movId}/reverse`, { reason: "Simulacro: anticipo mal registrado" }, matriz), "10. anular el anticipo en la Caja");
  const quedan = Number((await q("SELECT count(*)::int n FROM campo_movimientos WHERE par_id=$1", [r.cxp_id]))[0].n);
  check(quedan === 0, "11. el vale y su entrada se borran en Transporte", quedan);
  const valesDespues = Number((await q("SELECT count(*)::int n FROM campo_movimientos WHERE estado='PENDIENTE_RENDICION' AND concepto ILIKE $1", [`%${op}%`]))[0].n);
  check(valesDespues === valesAntes, "12. el operador vuelve a sus vales de antes");

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
