// 🤝 Secadora compartida (pedido del dueño 2026-10-28): en la secadora 2 se echó arroz comprado de un socio y un
// servicio de pilada de la Matriz. Cada dueño suma su parte como su propio registro en el MISMO túnel: mismas horas,
// combustible repartido por QQ, y al pilar cada registro va por su lado. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const socio = (await q("SELECT id, name FROM accionistas WHERE tipo = 'SOCIO' ORDER BY code LIMIT 1"))[0];
  const farmer = (await q("SELECT id FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const pend = await q("SELECT id, farmer_id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 5 AND lower(coalesce(raw_payload->>'modo','principal')) = 'principal' ORDER BY quintals DESC LIMIT 4");
  if (pend.length < 4) throw new Error(`la copia no tiene 4 tickets pendientes (${pend.length})`);
  // Motor 1 = secadoras 1 y 2. Se usa el túnel 2, libre en la copia.
  const tunel = 2, motor = 1;
  const ocupados = await q("SELECT count(*)::int n FROM drying_tunnel_reports WHERE motor_number = $1 AND motor_fuel_id IS NULL", [motor]);
  if (ocupados[0].n > 0) throw new Error("el motor 1 tiene secados pendientes en la copia");

  const ingresar = async (t, acc, op, etiqueta) => {
    if (!t.farmer_id) exigir(await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id }, acc), `${etiqueta}: vincular agricultor`);
    const ing = exigir(await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: op, ownership: op === "COMPRA" ? "OWNED" : "MAQUILA", accionista_id: acc }, acc), `${etiqueta}: ingresar ${t.qq} QQ`);
    return ing.ingreso;
  };
  const a = await ingresar(pend[0], socio.id, "COMPRA", `0a. ${socio.name} compra`);
  const b = await ingresar(pend[1], socio.id, "COMPRA", `0b. ${socio.name} compra`);
  const s = await ingresar(pend[2], matriz, "SECADO_PILADO", "0c. Matriz servicio completo");
  const extra = await ingresar(pend[3], socio.id, "COMPRA", `0d. ${socio.name} otra compra`);
  const lleno = new Date(Date.now() - 20 * 3600e3).toISOString(), inicio = new Date(Date.now() - 19 * 3600e3).toISOString();
  const llenar = (ids, acc, compartir) => api("POST", "/process-flow/drying/batch", {
    entry_ids: ids, tunnel_number: tunel, dryer_name: `Secadora ${tunel}`, rice_type: "0.11", moisture_before: 22,
    filled_at: lleno, dry_start_at: inicio, finalize: false, operator_name: "SECADOR PRUEBA", compartir_secadora: compartir
  }, acc);

  // ── A. Llenar y compartir ──
  const r1 = exigir(await llenar([a.id, b.id], socio.id, false), `A1. ${socio.name} llena la secadora 2 con sus 2 compras`);
  const sinCompartir = await llenar([s.id], matriz, false);
  check(sinCompartir.status === 409, "A2. sin «compartir», la secadora en uso sigue bloqueada", mostrar(sinCompartir));
  const r2rep = exigir(await llenar([s.id], matriz, true), "A3. la Matriz suma el servicio en la MISMA secadora (compartida)");
  const repServ = r2rep.reports[0], repSocio = r1.reports[0];
  const estado = exigir(await api("GET", "/process-flow/drying/tunnels-status"), "A4. estado de túneles");
  const del2 = estado.filter((x) => x.tunnel_number === tunel);
  check(del2.length === 2 && del2.some((x) => x.es_servicio) && del2.some((x) => !x.es_servicio), "A5. la secadora 2 muestra los 2 registros (propio + servicio)", del2);
  const filas = await q("SELECT d.id, d.dry_start_at, d.filled_at, d.motor_number, l.accionista_id, l.operation_type FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id WHERE d.tunnel_number = $1 AND d.status = 'IN_PROGRESS'", [tunel]);
  check(filas.length === 2 && new Set(filas.map((f) => String(f.dry_start_at))).size === 1 && filas.every((f) => f.motor_number === motor), "A6. los 2 registros comparten hora de inicio y motor");
  check(filas.find((f) => f.id === repServ.id)?.accionista_id === matriz && filas.find((f) => f.id === repServ.id)?.operation_type === "SECADO_PILADO"
    && filas.find((f) => f.id === repSocio.id)?.accionista_id === socio.id, "A7. cada registro conserva su dueño y su tipo (no se mezclan)");
  const repetido = await llenar([extra.id], socio.id, true);
  check(repetido.status === 409 && /editando/.test(JSON.stringify(repetido.data)), "A8. el mismo dueño y tipo no se repite: se agrega editando su secado", mostrar(repetido));
  const verSocio = exigir(await api("GET", "/process-flow/drying/reports", undefined, socio.id), `A9. secados de ${socio.name}`);
  const verMatriz = exigir(await api("GET", "/process-flow/drying/reports", undefined, matriz), "A10. secados de la Matriz");
  check(verSocio.some((r) => r.id === repSocio.id) && !verSocio.some((r) => r.id === repServ.id) && verMatriz.some((r) => r.id === repServ.id) && !verMatriz.some((r) => r.id === repSocio.id),
    "A11. cada dueño ve solo su registro de la secadora compartida");

  // ── B. Terminar y combustible ──
  const fin = exigir(await api("POST", "/process-flow/drying/tunnel-finalize", { drying_report_id: repSocio.id, dry_start_at: inicio, dry_end_at: new Date().toISOString() }, socio.id), "B1. terminar la secadora 2");
  check(fin.requires_fuel === true && fin.prepared === 2, "B2. al terminar, se cierran JUNTOS los 2 registros y pide el combustible", fin);
  const tarde = await llenar([extra.id], matriz, true);
  check(tarde.status === 409, "B3. a una secadora ya terminada no se le puede sumar arroz", mostrar(tarde));
  const fuel = exigir(await api("POST", "/process-flow/drying/motor-fuel", { motor_number: motor, gas_bombona_inicio: 90, gas_bombona_fin: 60, finalize: true }), "B4. registrar el combustible del motor");
  const partes = await q("SELECT drying_report_id, quintales::float qq, (gas + diesel)::float costo FROM motor_fuel_partes WHERE motor_fuel_id = $1", [fuel.registro?.id]);
  const pS = partes.find((p) => p.drying_report_id === repSocio.id), pM = partes.find((p) => p.drying_report_id === repServ.id);
  check(partes.length === 2 && pS && pM && Math.abs(pS.costo / pM.costo - pS.qq / pM.qq) < 0.02, "B5. el combustible se reparte por QQ entre los 2 registros", partes);
  const estados = await q("SELECT status FROM drying_tunnel_reports WHERE id = ANY($1::uuid[])", [[repSocio.id, repServ.id]]);
  check(estados.every((e) => e.status === "COMPLETED"), "B6. los 2 registros quedan finalizados");
  const nomina = exigir(await api("GET", "/labor/secador-suggestions").catch(() => ({ ok: true, data: null })), "B7. nómina del secador");
  if (Array.isArray(nomina)) {
    const fila = nomina.find((n) => /SECADOR PRUEBA/.test(n.worker_name ?? ""));
    check(!fila || fila.tunnels <= 1, "B8. la secadora compartida se paga como UN túnel", fila);
  }

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
