// 🌾 Empezar de cero conservando la cartera (pedido del dueño 2026-11-03): agricultores, fomentos y préstamos no son datos
// de prueba. Las cuotas ya vencidas quedan pagadas por fuera de la caja. También: cuota pagada por fuera a mano, fecha en
// la hoja de Caja y facturar varios partes de Transporte. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
import path from "node:path"; import { pathToFileURL, fileURLToPath } from "node:url";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, c, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dia = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const hoy = dia(0), ayer = dia(-1);
const SOBRE = { "x-confirmar": "SOBREGIRO" };

try {
  const DIST = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist")).href;
  const { vaciarDatosDePrueba } = await import(`${DIST}/services/datos-prueba.js`);

  // ── A. Cartera que debe sobrevivir al borrado ──
  const f = (await q("SELECT id, full_name FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const caja0 = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim cartera", tipo: "EFECTIVO", opening_balance_cash: 1000 }), "A0. caja").id;
  const fom = exigir(await api("POST", "/fomentos", { farmer_name: f.full_name, farmer_id: f.id, cuadras: 5, inicio: dia(-30), renta: 0.05 }), "A1. fomento");
  exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: dia(-30), valor: 400, concepto: "SIM entrega", cash_register_id: caja0 }), "A2. entrega desde la caja");
  exigir(await api("POST", `/fomentos/${fom.id}/pagos`, { fecha: dia(-5), valor: 100, concepto: "SIM pago", cash_register_id: caja0 }), "A3. pago a la caja");
  const pres = exigir(await api("POST", "/prestamos", {
    banco: "SIM BANCO", numero: "111", capital: 300, cuotas: 3, primera_fecha: dia(-40), tasa_anual: 12,
    filas: [
      { fecha: dia(-40), capital: 100, interes: 3, otros: 0 },
      { fecha: dia(-10), capital: 100, interes: 2, otros: 0 },
      { fecha: dia(20), capital: 100, interes: 1, otros: 0 }
    ]
  }), "A4. préstamo con 2 cuotas vencidas y 1 por venir");
  const cuotas = async () => q("SELECT numero, estado, pagada_fuera, cash_movement_id, pagado_interes::float i FROM prestamo_cuotas WHERE prestamo_id=$1 ORDER BY numero", [pres.id]);
  const c1 = (await q("SELECT id FROM prestamo_cuotas WHERE prestamo_id=$1 AND numero=1", [pres.id]))[0].id;
  exigir(await api("POST", `/prestamos/${pres.id}/cuotas/${c1}/pagar`, { cash_register_id: caja0 }, matriz, SOBRE), "A5. la cuota 1 se paga por la caja");
  const nAgricultores = (await q("SELECT count(*)::int n FROM farmers"))[0].n;
  const nFomentos = (await q("SELECT count(*)::int n FROM fomentos"))[0].n;

  await c.query("BEGIN");
  await vaciarDatosDePrueba(c, { conservarCartera: true });
  await c.query("COMMIT");

  const n = async (t) => (await q(`SELECT count(*)::int n FROM ${t}`))[0].n;
  check(await n("farmers") === nAgricultores && await n("fomentos") === nFomentos, "B1. siguen los agricultores y los fomentos", { ag: await n("farmers"), fom: await n("fomentos") });
  const e = (await q("SELECT (SELECT sum(valor) FROM fomento_entregas WHERE fomento_id=$1)::float ent, (SELECT sum(valor) FROM fomento_pagos WHERE fomento_id=$1)::float pag", [fom.id]))[0];
  check(e.ent === 400 && e.pag === 100, "B2. el fomento conserva sus entregas y pagos", e);
  check(await n("cash_movements") === 0 && await n("cash_registers") === 0 && await n("lots") === 0 && await n("accounts_receivable") === 0 && await n("inventory_movements") === 0, "B3. lo demás sí se borró");
  const qs = await cuotas();
  check(qs[0].estado === "PAGADA" && qs[0].pagada_fuera && qs[0].cash_movement_id === null, "B4. la cuota pagada por caja sigue pagada (sin su movimiento)", qs[0]);
  check(qs[1].estado === "PAGADA" && qs[1].pagada_fuera && qs[1].i === 2, "B5. la cuota ya vencida queda pagada por fuera", qs[1]);
  check(qs[2].estado === "PENDIENTE" && !qs[2].pagada_fuera, "B6. la que no ha vencido sigue pendiente", qs[2]);
  check((await q("SELECT count(*)::int n FROM prestamos_bancarios WHERE estado='ANULADO'"))[0].n === 0, "B7. los préstamos anulados no pasan al arranque");

  const bal = exigir(await api("GET", `/finance/balance?hasta=${hoy}`), "B8. balance después del borrado");
  check(bal.activo.corriente.fomentos_por_cobrar >= 300 && bal.activo.corriente.efectivo === 0, "B9. el Balance arranca con los fomentos y sin caja", bal.activo.corriente.fomentos_por_cobrar);
  check(bal.pasivo.corriente.prestamos_bancarios + (bal.pasivo.no_corriente?.prestamos_bancarios ?? 0) >= 100, "B10. y con el capital que falta del préstamo");
  check(Math.abs(bal.cuadre) < 0.01, "B11. cuadra", bal.cuadre);

  // ── C. Cuota pagada por fuera, a mano ──
  const c3 = (await q("SELECT id FROM prestamo_cuotas WHERE prestamo_id=$1 AND numero=3", [pres.id]))[0].id;
  exigir(await api("POST", `/prestamos/${pres.id}/cuotas/${c3}/pagada-fuera`, {}), "C1. marcar la cuota 3 como pagada por fuera");
  check((await q("SELECT estado FROM prestamos_bancarios WHERE id=$1", [pres.id]))[0].estado === "PAGADO", "C2. sin cuotas pendientes, el préstamo queda pagado");
  check(await n("cash_movements") === 0, "C3. no movió ninguna caja");
  exigir(await api("POST", `/prestamos/${pres.id}/cuotas/${c3}/deshacer-fuera`, {}), "C4. deshacer");
  const q3 = (await cuotas())[2];
  check(q3.estado === "PENDIENTE" && !q3.pagada_fuera && (await q("SELECT estado FROM prestamos_bancarios WHERE id=$1", [pres.id]))[0].estado === "VIGENTE", "C5. vuelve a pendiente y el préstamo a vigente", q3);
  const otra = await api("POST", `/prestamos/${pres.id}/cuotas/${c1}/deshacer-fuera`, {});
  check(otra.ok, "C6. la que quedó sin su caja también se puede corregir", mostrar(otra));
  exigir(await api("POST", `/prestamos/${pres.id}/pagadas-fuera`, { hasta: hoy }), "C7. marcar de una vez las vencidas");
  check((await cuotas())[0].estado === "PAGADA" && (await cuotas())[2].estado === "PENDIENTE", "C8. solo las vencidas", await cuotas());

  // ── D. Fecha en la hoja de Caja ──
  // La caja se abrió hace 3 días (en la copia): se puede registrar desde ese día hasta hoy.
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim fechas", tipo: "EFECTIVO", opening_balance_cash: 500 }), "D0. caja").id;
  await q("UPDATE cash_registers SET opened_at = now() - interval '3 days' WHERE id = $1", [caja]);
  const mov = (extra) => api("POST", `/cash/${caja}/movements`, { movement: "EXPENSE", category: "ALIMENTACION", amount: 10, description: "SIM comida", codigo: "001", ...extra }, matriz, SOBRE);
  const ayerMov = exigir(await mov({ fecha: ayer }), "D1. gasto con fecha de ayer");
  const fechaDe = async (id) => (await q("SELECT (created_at AT TIME ZONE 'America/Guayaquil')::date::text d FROM cash_movements WHERE id=$1", [id]))[0].d;
  check(await fechaDe(ayerMov.id) === ayer, "D2. queda con esa fecha", await fechaDe(ayerMov.id));
  const normal = exigir(await mov({}), "D3. gasto de hoy");
  check(await fechaDe(normal.id) === hoy, "D4. sin fecha queda hoy");
  const fut = await mov({ fecha: dia(1) });
  check(fut.status === 400, "D5. una fecha futura no se acepta", mostrar(fut));
  const antes = await mov({ fecha: dia(-5) });
  check(antes.status === 400 && /se abrió/.test(JSON.stringify(antes.data)), "D6. antes de abrir la caja no se acepta", mostrar(antes));
  const er = async (d) => exigir(await api("GET", `/finance/income-statement?desde=${d}&hasta=${d}`), "resultados");
  check((await er(ayer)).gastos_operativos.gastos_generales === 10, "D7. el gasto cuenta en el día que se puso", (await er(ayer)).gastos_operativos);
  const [ya, ma] = ayer.split("-").map(Number);
  await q("INSERT INTO cierres_mes (anio, mes, accionista_id, desde, hasta, datos) VALUES ($1,$2,$3,$4,$4,'{}'::jsonb)", [ya, ma, matriz, ayer]);
  const cerrado = await mov({ fecha: ayer });
  check(cerrado.status === 409, "D8. en un mes con cierre no se puede", mostrar(cerrado));
  await q("DELETE FROM cierres_mes WHERE anio=$1 AND mes=$2", [ya, ma]);
  // Con banco y de Transporte: todo lo que nace del movimiento va a ese día.
  const conBanco = exigir(await mov({ fecha: ayer, pagado_con_banco: true }), "D9. gasto pagado con banco de ayer");
  const banco = (await q("SELECT (created_at AT TIME ZONE 'America/Guayaquil')::date::text d FROM cash_movements WHERE reference_type='pagado_con_banco' AND reference_id=$1", [conBanco.id]))[0];
  check(banco?.d === ayer, "D10. el retiro del banco también", banco);
  await q("DELETE FROM campo_caja_sesiones WHERE estado = 'ABIERTA'");
  exigir(await api("POST", "/campo/caja/abrir", { saldo_inicial: 50 }), "D11. caja de Transporte");
  const gt = exigir(await api("POST", "/equipment/transporte/gasto", { cash_register_id: caja, categoria: "DIESEL", monto: 15, description: "SIM diésel", fecha: ayer }), "D12. gasto de Transporte de ayer");
  const cxp = (await q("SELECT fecha::text f FROM campo_cxp WHERE id=$1", [gt.cxp_id]))[0];
  const salida = (await q("SELECT (created_at AT TIME ZONE 'America/Guayaquil')::date::text d FROM cash_movements WHERE reference_type='campo_cxp' AND reference_id=$1", [gt.cxp_id]))[0];
  check(cxp.f.slice(0, 10) === ayer && salida.d === ayer, "D13. en Transporte y en la Caja queda con esa fecha", { cxp, salida });

  // ── E. Facturar varios partes ──
  const camion = (await q("SELECT id FROM campo_activos WHERE nombre='PLATAFORMA'"))[0].id;
  const cose = (await q("SELECT id FROM campo_activos WHERE tipo='cosechadora' ORDER BY nombre LIMIT 1"))[0].id;
  const cli = exigir(await api("POST", "/campo/clientes", { nombre: "SIM CLIENTE LOTE", tipo: "externo" }), "E0. cliente");
  const parte = async (activo_id, qq) => exigir(await api("POST", "/campo/partes", { activo_id, cliente: cli.nombre, cliente_id: cli.id, qq, fecha: hoy }), `E1. parte de ${qq} QQ`);
  const p1 = await parte(cose, 10), p2 = await parte(cose, 20), p3 = await parte(camion, 5);
  const ids = [p1.id, p2.id, p3.id];
  const falta = await api("POST", "/campo/partes/cobrar-varios", { parte_ids: ids, precio_cosecha: 2 });
  check(falta.status === 400, "E2. falta el precio del flete: no cobra ninguno", mostrar(falta));
  check((await q("SELECT count(*)::int n FROM campo_partes WHERE id = ANY($1) AND estado='por_cobrar'", [ids]))[0].n === 3, "E3. todo o nada");
  const r = exigir(await api("POST", "/campo/partes/cobrar-varios", { parte_ids: ids, precio_cosecha: 2, precio_flete: 3 }), "E4. cobrar los 3");
  check(r.partes === 3 && r2(r.total) === 75, "E5. 30 QQ × $2 + 5 QQ × $3 = $75", r);
  const sv = await q("SELECT tipo, sum(valor)::float v FROM campo_servicios s WHERE cliente_id=$1 GROUP BY tipo ORDER BY tipo", [cli.id]);
  check(sv.length === 2 && sv[0].v === 60 && sv[1].v === 15, "E6. quedan como servicios del cliente", sv);
  const repite = await api("POST", "/campo/partes/cobrar-varios", { parte_ids: ids, precio_cosecha: 2, precio_flete: 3 });
  check(repite.status === 409, "E7. no se cobra dos veces", mostrar(repite));

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); await c.query("ROLLBACK").catch(() => {}); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
