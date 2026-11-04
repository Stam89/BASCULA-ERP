// 🔍 Arreglos de la auditoría (2026-11-03): la llave maestra no queda en la auditoría; el Estado de Resultados cuenta los
// otros ingresos; el Balance incluye los fomentos; el flete de báscula lleva el día del viaje; «del grupo» en Transporte
// son solo la piladora y los socios; los socios pueden traer dinero del banco. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const dormir = (ms) => new Promise((f) => setTimeout(f, ms));
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const SOBRE = { "x-confirmar": "SOBREGIRO" };

try {
  // ── A. La llave maestra no se guarda en la auditoría ──
  exigir(await api("PUT", "/campo/config", { nombre_operacion: "TRANSPORTE Y COSECHADORA", llave_maestra: "no-debe-quedar" }), "A1. una petición que trae llave_maestra");
  await dormir(400);
  const au = (await q("SELECT new_data->>'llave_maestra' v FROM audit_logs WHERE path LIKE '%/campo/config' ORDER BY created_at DESC LIMIT 1"))[0];
  check(au?.v === "[oculto]", "A2. en la auditoría queda oculta", au);

  // ── B. Estado de Resultados: otros ingresos sí; banco, aportes y anulados no ──
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim auditoría", tipo: "EFECTIVO", opening_balance_cash: 1000 }), "B0. caja").id;
  const er = async () => exigir(await api("GET", `/finance/income-statement?desde=${hoy}&hasta=${hoy}`), "estado de resultados");
  const mov = (category, amount, movement = "INCOME") => api("POST", "/cash/movements", { cash_register_id: caja, movement, category, amount, description: `SIM ${category}` }, matriz, SOBRE);
  const e0 = await er();
  const tamo = exigir(await mov("TAMO", 20), "B1. venta de tamo $20");
  exigir(await mov("SERVICIO_BASCULA", 5), "B2. servicio de báscula $5");
  let e = await er();
  check(r2(e.ingresos.otros_ingresos - e0.ingresos.otros_ingresos) === 25 && r2(e.ingresos.total - e0.ingresos.total) === 25, "B3. suben $25 los otros ingresos y el total", e.ingresos);
  exigir(await mov("RETIRO_BANCO", 100), "B4. retiro del banco $100");
  exigir(await mov("APORTE_SOCIO", 50), "B5. aporte $50");
  e = await er();
  check(r2(e.ingresos.total - e0.ingresos.total) === 25, "B6. el banco y los aportes no son ingreso", e.ingresos);
  exigir(await api("POST", `/cash/movements/${tamo.id}/reverse`, { reason: "simulacro" }), "B7. anular el tamo");
  e = await er();
  check(r2(e.ingresos.total - e0.ingresos.total) === 5, "B8. lo anulado deja de contar", e.ingresos);

  // ── C. Balance: el capital de los fomentos es un activo ──
  const bal = async () => exigir(await api("GET", `/finance/balance?hasta=${hoy}`), "balance");
  const f = (await q("SELECT id, full_name FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const b0 = await bal();
  const fom = exigir(await api("POST", "/fomentos", { farmer_name: f.full_name, farmer_id: f.id, cuadras: 5, inicio: hoy, renta: 0.05 }), "C1. fomento nuevo");
  exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: hoy, valor: 300, concepto: "SIM entrega", cash_register_id: caja }), "C2. entrega de $300 desde la caja");
  const b1 = await bal();
  check(r2(b1.activo.corriente.fomentos_por_cobrar - b0.activo.corriente.fomentos_por_cobrar) === 300, "C3. el Balance suma $300 de fomentos", b1.activo.corriente.fomentos_por_cobrar);
  check(r2(b1.activo.corriente.efectivo - b0.activo.corriente.efectivo) === -300 && r2(b1.activo.total - b0.activo.total) === 0, "C4. sale de caja y el activo total no cambia", { ef: b1.activo.corriente.efectivo, total: b1.activo.total });
  exigir(await api("POST", `/fomentos/${fom.id}/pagos`, { fecha: hoy, valor: 100, concepto: "SIM pago", cash_register_id: caja }), "C5. el agricultor paga $100");
  const b2 = await bal();
  check(r2(b2.activo.corriente.fomentos_por_cobrar - b1.activo.corriente.fomentos_por_cobrar) === -100 && r2(b2.activo.corriente.efectivo - b1.activo.corriente.efectivo) === 100, "C6. baja el fomento y entra a caja", b2.activo.corriente.fomentos_por_cobrar);
  check(Math.abs(b2.cuadre) < 0.01, "C7. el Balance cuadra", b2.cuadre);
  check(typeof b2.activo.corriente.inventario_detalle.qq_sin_costo === "number", "C8. el Balance sabe cuántos QQ no tienen costo", b2.activo.corriente.inventario_detalle.qq_sin_costo);

  // ── D. El flete de báscula lleva el día del viaje, no el del ingreso ──
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const t = (await q(`SELECT id, farmer_id, raw_payload->>'fecha' fecha, raw_payload->>'numeroTicket' n FROM mobile_synced_tickets
                       WHERE upper(replace(raw_payload->>'placa','-','')) = 'GHK553' AND weighing_ticket_id IS NULL AND quintals > 0 AND quitado_at IS NULL
                         AND raw_payload->>'fecha' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}' AND left(raw_payload->>'fecha', 10) <> to_char(now() AT TIME ZONE 'America/Guayaquil', 'DD/MM/YYYY')
                       ORDER BY mobile_created_at DESC LIMIT 1`))[0];
  if (t) {
    const fi = (await q("SELECT id FROM farmers ORDER BY full_name LIMIT 1"))[0];
    if (!t.farmer_id) exigir(await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: fi.id }, stalyn), "D0. vincular agricultor");
    // El último que manejó ese carro: el parte automático lo sugiere para que el viaje llegue a su nómina.
    const carro = (await q("SELECT id FROM campo_activos WHERE replace(upper(placa_codigo), '-', '') = 'GHK553'"))[0].id;
    const cliS = (await q("SELECT id, nombre FROM campo_clientes WHERE upper(nombre) = 'STALYN'"))[0];
    exigir(await api("POST", "/campo/partes", { activo_id: carro, operador: "SIM CHOFER", cliente: cliS.nombre, cliente_id: cliS.id, qq: 1, fecha: hoy }), "D0b. un parte anterior de ese carro");
    const ing = exigir(await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: "COMPRA", ownership: "OWNED", accionista_id: stalyn }, stalyn), `D1. ingresar hoy el ticket #${t.n} del ${t.fecha.slice(0, 10)}`);
    await dormir(500);
    const parte = (await q("SELECT to_char(fecha, 'DD/MM/YYYY') f, operador FROM campo_partes WHERE origen_uid = $1", [`weighing_ticket:${ing.ingreso.id}`]))[0];
    check(parte?.f === t.fecha.slice(0, 10), "D2. el parte queda con el día del viaje", { parte, ticket: t.fecha });
    check(parte?.operador === "SIM CHOFER", "D3. y con el último operador de ese carro", parte);
  } else check(true, "D. (la copia no tiene un ticket de la flota por ingresar)");

  // ── E. Transporte: un agricultor es tercero; un socio es del grupo ──
  await q("DELETE FROM campo_caja_sesiones WHERE estado = 'ABIERTA'");
  exigir(await api("POST", "/campo/caja/abrir", { saldo_inicial: 50 }), "E0. caja de Campo");
  const camion = (await q("SELECT id FROM campo_activos WHERE nombre='PLATAFORMA'"))[0].id;
  const mes = hoy.slice(0, 7);
  const res = async () => exigir(await api("GET", `/campo/reportes/estado-resultados?mes=${mes}`), "estado de resultados de Transporte");
  const r0 = await res();
  const parteDe = async (cliente, cliente_id) => exigir(await api("POST", "/campo/partes", { activo_id: camion, cliente, cliente_id, qq: 10, fecha: hoy }), `E1. parte de ${cliente}`);
  const ag = await parteDe(f.full_name, f.id);
  const res1 = await res();
  check((res1.notas ?? []).some((n) => /por cobrar .*NO cuentan como ingreso/.test(n)), "E2. el resultado avisa los partes sin facturar", res1.notas);
  const cliAg = (await q("SELECT cliente_id FROM campo_partes WHERE id=$1", [ag.id]))[0].cliente_id;
  exigir(await api("POST", "/campo/conciliacion/convertir-y-aplicar", { parte_id: ag.id, cliente_id: cliAg, precio_unitario: 2 }), "E3. facturar el parte del agricultor $20");
  const socioCli = (await q("SELECT id, nombre FROM campo_clientes WHERE upper(nombre)='STALYN'"))[0];
  const so = await parteDe(socioCli.nombre, socioCli.id);
  exigir(await api("POST", "/campo/conciliacion/convertir-y-aplicar", { parte_id: so.id, cliente_id: socioCli.id, precio_unitario: 3 }), "E4. facturar el parte del socio $30");
  const r1 = await res();
  check(r2(r1.ingresos.de_terceros - r0.ingresos.de_terceros) === 20 && r2(r1.ingresos.del_grupo - r0.ingresos.del_grupo) === 30, "E5. el agricultor es tercero y el socio es del grupo", r1.ingresos);

  // ── F. Un socio puede traer dinero del banco ──
  const cajaS = exigir(await api("POST", "/cash/registers/open", { name: "Caja sim socio", tipo: "EFECTIVO", opening_balance_cash: 0 }, stalyn), "F0. caja de STALYN").id;
  exigir(await api("POST", "/cash/movements", { cash_register_id: cajaS, movement: "INCOME", category: "RETIRO_BANCO", amount: 80, description: "SIM retiro" }, stalyn), "F1. STALYN retira $80 del banco a su caja");

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
