// ➕ Faltó un peso (pedido del dueño 2026-10-29): a una secadora ya llena se le SUMA un ticket del mismo dueño y tipo
// mientras el motor no arranca (sin hora de inicio). Sube QQ/kg del secado y el pago del llenado de la cuadrilla; con el
// motor encendido ya no se deja. Otro dueño en la misma secadora sigue siendo un registro aparte. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const farmer = (await q("SELECT id FROM farmers ORDER BY full_name LIMIT 1"))[0];
  const pend = await q("SELECT id, farmer_id, quintals::float qq FROM mobile_synced_tickets WHERE liquidated_at IS NULL AND weighing_ticket_id IS NULL AND quintals > 5 AND lower(coalesce(raw_payload->>'modo','principal')) = 'principal' ORDER BY quintals DESC LIMIT 3");
  if (pend.length < 3) throw new Error(`la copia no tiene 3 tickets pendientes (${pend.length})`);
  // El caso real: la secadora 1 (motor 1) ya está llena y el motor todavía no arranca.
  const tunel = 1, motor = 1;
  const base = (await q(`SELECT d.id, d.total_quintals::float qq, d.dry_start_at, l.accionista_id, l.operation_type, a.name
                           FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id LEFT JOIN accionistas a ON a.id = l.accionista_id
                          WHERE d.tunnel_number = $1 AND d.status = 'IN_PROGRESS' ORDER BY d.created_at LIMIT 1`, [tunel]))[0];
  if (!base || base.dry_start_at) throw new Error("la copia no tiene la secadora 1 llena y sin hora de inicio");
  const socio = { id: base.accionista_id, name: base.name };

  const ingresar = async (t, acc, op, etiqueta) => {
    if (!t.farmer_id) exigir(await api("POST", `/tickets/${t.id}/link-farmer`, { farmer_id: farmer.id }, acc), `${etiqueta}: vincular agricultor`);
    const ing = exigir(await api("POST", `/tickets/${t.id}/create-lot`, { rice_type: "0.11", operation_type: op, ownership: op === "COMPRA" ? "OWNED" : "MAQUILA", accionista_id: acc }, acc), `${etiqueta}: ingresar ${t.qq} QQ`);
    return ing.ingreso;
  };
  const b = await ingresar(pend[0], socio.id, base.operation_type, `0a. ${socio.name}: el peso que faltó`);
  const c = await ingresar(pend[1], socio.id, base.operation_type, `0b. ${socio.name}: otro peso`);
  const d = await ingresar(pend[2], matriz, "SECADO_PILADO", "0c. Matriz servicio");
  const qb = Number((await q("SELECT quintals::float qq FROM weighing_tickets WHERE id = $1", [b.id]))[0].qq);
  const llenar = (ids, acc, compartir) => api("POST", "/process-flow/drying/batch", {
    entry_ids: ids, tunnel_number: tunel, dryer_name: `Secadora ${tunel}`, rice_type: "0.11", moisture_before: 22,
    finalize: false, operator_name: "SECADOR PRUEBA", compartir_secadora: compartir
  }, acc);
  const llenadoCuadrilla = async (id) => (await q("SELECT COALESCE(sum(quantity),0)::float q FROM cuadrilla_entries WHERE origen='SECADORA' AND referencia_id=$1 AND momento='LLENADO' AND paid_at IS NULL", [id]))[0].q;

  // ── A. Sumar el peso que faltó (motor apagado) ──
  const rep = { id: base.id }, qa = base.qq;
  const cuad0 = await llenadoCuadrilla(rep.id);
  const antesTickets = (await q("SELECT count(*)::int n FROM drying_tunnel_report_lots WHERE drying_report_id = $1", [rep.id]))[0].n;
  const bloqueado = await llenar([b.id], socio.id, false);
  check(bloqueado.status === 409, "A2. sin «agregar más arroz», la secadora en uso sigue bloqueada", mostrar(bloqueado));
  const r2r = exigir(await llenar([b.id], socio.id, true), "A3. ➕ se suma el peso que faltó a la secadora 1");
  check(r2r.sumados === 1 && r2r.reports[0].id === rep.id, "A4. se sumó al MISMO secado (no crea otro)", { sumados: r2r.sumados, id: r2r.reports[0]?.id });
  const fila = (await q("SELECT total_quintals::float qq, lot_id FROM drying_tunnel_reports WHERE id = $1", [rep.id]))[0];
  check(Math.abs(fila.qq - (qa + qb)) < 0.01, "A5. los QQ del secado suben con el ticket nuevo", { antes: qa, ahora: fila.qq, esperado: r2(qa + qb) });
  const enLote = await q("SELECT count(*)::int n FROM weighing_tickets WHERE id = $1 AND lot_id = $2", [b.id, fila.lot_id]);
  const miembros = (await q("SELECT count(*)::int n FROM drying_tunnel_report_lots WHERE drying_report_id = $1", [rep.id]))[0].n;
  check(enLote[0].n === 1 && miembros === antesTickets + 1, "A6. el ticket queda en el lote y en el informe del túnel", { informe: miembros });
  const informe = (await q("SELECT (report_data->>'total_quintals')::float qq, jsonb_array_length(report_data->'lots') n FROM lot_process_reports WHERE id = (SELECT process_report_id FROM drying_tunnel_reports WHERE id = $1)", [rep.id]))[0];
  check(Math.abs(informe.qq - (qa + qb)) < 0.01 && informe.n === antesTickets + 1, "A7. el informe del túnel muestra el ticket nuevo y el total nuevo", informe);
  const cuad1 = await llenadoCuadrilla(rep.id);
  check(cuad0 > 0 ? Math.abs(cuad1 - cuad0 * (qa + qb) / qa) < 0.01 : true, "A8. el pago del llenado de la cuadrilla sube a los QQ nuevos", { antes: cuad0, ahora: cuad1 });
  const activosSocio = await q("SELECT count(*)::int n FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id WHERE d.tunnel_number = $1 AND d.status = 'IN_PROGRESS' AND l.accionista_id = $2", [tunel, socio.id]);
  check(activosSocio[0].n === 1, "A9. el socio sigue con UN solo secado en esa secadora");

  // ── B. Otro dueño en la misma secadora: registro aparte ──
  const r3 = exigir(await llenar([d.id], matriz, true), "B1. la Matriz echa un servicio en la misma secadora");
  check(!r3.sumados && r3.reports[0].id !== rep.id, "B2. el servicio queda como otro registro (no se suma al del socio)");

  // ── C. Con el motor encendido ya no se suma ──
  exigir(await api("POST", `/process-flow/drying/motor/${motor}/sync-run`, { dry_start_at: new Date().toISOString() }), "C1. arranca el motor (hora de inicio)");
  const tarde = await llenar([c.id], socio.id, true);
  check(tarde.status === 409 && /arranc/.test(JSON.stringify(tarde.data)), "C2. con el motor encendido ya no se suma peso", mostrar(tarde));
  const libre = await q("SELECT lot_id FROM weighing_tickets WHERE id = $1", [c.id]);
  check(!libre[0].lot_id, "C3. ese ticket queda libre (no se metió a medias)");

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
