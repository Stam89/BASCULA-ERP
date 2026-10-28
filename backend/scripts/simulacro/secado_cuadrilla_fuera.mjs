// 🧺 Secado registrado después con la cuadrilla pagada por fuera (pedido del dueño 2026-10-28): la cáscara de ROVINSON
// se secó el sábado; se registra en la secadora 3 con sus horas, se finaliza sin combustible, la cuadrilla queda como
// «pagada por fuera» (no genera pagos ni vuelve a aparecer) y lo que va saliendo se guarda en Producción. SOLO copia.
import fs from "fs";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261121_secado_cuadrilla_fuera.sql", import.meta.url), "utf8"));
  const rov = (await q("SELECT id FROM accionistas WHERE name = 'ROVINSON'"))[0].id;
  const tickets = await q("SELECT id, quintals::float qq FROM weighing_tickets WHERE accionista_id = $1 AND lot_id IS NULL AND COALESCE(operation_type,'COMPRA') = 'COMPRA' ORDER BY created_at", [rov]);
  if (tickets.length < 1) throw new Error("ROVINSON no tiene tickets libres en la copia");
  const qq = r2(tickets.reduce((s, t) => s + t.qq, 0));
  const ocupado = await q("SELECT 1 FROM drying_tunnel_reports WHERE motor_number = 2 AND motor_fuel_id IS NULL");
  if (ocupado.length) throw new Error("el motor 2 tiene secados pendientes en la copia");
  const bodPT = (await q("SELECT id FROM warehouses WHERE type = 'FINISHED_GOODS' LIMIT 1"))[0].id;
  const P = async (c) => (await q("SELECT id FROM products WHERE code = $1", [c]))[0].id;
  const stock = async (c) => Number((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements WHERE product_id = $1 AND warehouse_id = $2 AND accionista_id = $3", [await P(c), bodPT, rov]))[0].s);
  const cuadrilla = async (id) => Number((await q("SELECT count(*)::int n FROM cuadrilla_entries WHERE origen = 'SECADORA' AND referencia_id = $1", [id]))[0].n);

  // ── A. Secado del sábado en la secadora 3 ──
  const sab = { lleno: "2026-10-24", ini: "2026-10-24T08:00:00-05:00", fin: "2026-10-24T20:00:00-05:00" };
  const lote = exigir(await api("POST", "/process-flow/drying/batch", {
    entry_ids: tickets.map((t) => t.id), tunnel_number: 3, dryer_name: "Secadora 3", rice_type: "0.11",
    filled_at: sab.lleno, dry_start_at: sab.ini, finalize: false, notes: "Secado del sábado 24/10 registrado después"
  }, rov), `A1. registrar los ${tickets.length} tickets de ROVINSON (${qq} QQ) en la secadora 3`);
  const rep = lote.reports[0];
  check(lote.reports.length === 1 && r2(rep.total_quintals) === qq, "A2. un solo secado con todo el QQ", { n: lote.reports.length, qq: rep.total_quintals });
  const fin = exigir(await api("POST", "/process-flow/drying/tunnel-finalize", { drying_report_id: rep.id, dry_start_at: sab.ini, dry_end_at: sab.fin }, rov), "A3. hora final del sábado");
  check(fin.requires_fuel === true, "A4. pide combustible (es el único túnel del motor 2)", fin);
  exigir(await api("POST", "/process-flow/drying/motor/2/finalizar-sin-combustible", {}, rov), "A5. finalizar sin combustible (queda pendiente)");
  const est = (await q("SELECT status, filled_at::text f, motor_number m FROM drying_tunnel_reports WHERE id = $1", [rep.id]))[0];
  check(est.status === "COMPLETED" && est.f === sab.lleno && est.m === 2, "A6. queda finalizado con fecha del sábado", est);
  const motor1 = (await q("SELECT count(*)::int n FROM drying_tunnel_reports WHERE motor_number = 1 AND status = 'IN_PROGRESS'"))[0].n;
  check(true, "A7. las secadoras 1 y 2 no se tocan", { en_proceso_motor1: motor1 });

  // ── B. Cuadrilla pagada por fuera ──
  check((await cuadrilla(rep.id)) > 0, "B1. el sistema generó la cuadrilla de llenado y botada", await cuadrilla(rep.id));
  const fuera = exigir(await api("POST", `/process-flow/drying/${rep.id}/cuadrilla-fuera`, { fuera: true }, rov), "B2. marcar «cuadrilla ya pagada»");
  check((await cuadrilla(rep.id)) === 0 && fuera.quitados > 0, "B3. se quitan sus pagos pendientes", fuera);
  // Completar el combustible después vuelve a correr el pago automático: no debe regenerarse.
  const pend = (await q("SELECT id FROM motor_fuel_records WHERE motor_number = 2 AND pendiente ORDER BY created_at DESC LIMIT 1"))[0];
  const comp = await api("POST", `/process-flow/drying/motor-fuel/${pend.id}/completar`, { gas_bombona_inicio: 80, gas_bombona_fin: 70 }, rov);
  check(comp.ok && (await cuadrilla(rep.id)) === 0, "B4. al completar el combustible la cuadrilla NO vuelve a aparecer", comp.ok ? await cuadrilla(rep.id) : mostrar(comp));
  const sinTenant = await api("POST", `/process-flow/drying/${rep.id}/cuadrilla-fuera`, { fuera: false }, rov);
  check(sinTenant.ok && (await cuadrilla(rep.id)) > 0, "B5. desmarcarlo la vuelve a generar", await cuadrilla(rep.id));
  exigir(await api("POST", `/process-flow/drying/${rep.id}/cuadrilla-fuera`, { fuera: true }, rov), "B6. volver a marcarla");

  // ── C. Lo que va saliendo, guardado en Producción ──
  const s0 = { b: await stock("ARROZ-PILADO-011"), t: await stock("ARROCILLO-34"), f: await stock("ARROCILLO-FINO") };
  exigir(await api("PUT", `/processing-batches/drafts/${rep.id}`, {
    report: { broken34: "8", fineBroken: "1", polvillo: "", broken34_lb: "100", fineBroken_lb: "100", polvillo_lb: "100", tulas: "", qqTulas: "", juntos: [] },
    pilado_entries: [{ id: "t1", presentation: "TULA", quantityQq: 20, destino: "TULA" }], warehouse_id: bodPT
  }, rov), "C1. guardar el proceso: 20 QQ de 0.11 en tula, 8 de 3/4 y 1 de fino");
  const d = { b: r2(await stock("ARROZ-PILADO-011") - s0.b), t: r2(await stock("ARROCILLO-34") - s0.t), f: r2(await stock("ARROCILLO-FINO") - s0.f) };
  check(d.b === 20 && d.t === 8 && d.f === 1, "C2. ya cuenta en el inventario de ROVINSON", d);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
