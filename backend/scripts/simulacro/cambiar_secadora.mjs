// 🔀 Cambiar de secadora (pedido del dueño 2026-10-29: «lo de la secadora 1 va en la 2 y la 2 en la 1»). Mientras el
// motor no arranca, lo de una secadora se pasa a otra; si la otra está llena se intercambian. Se ajustan túnel, nombre,
// motor, informe y la labor/pago del llenado de la cuadrilla (tarifa por túnel). Con hora de inicio ya no. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const en = async (t) => (await q(`SELECT d.id, d.tunnel_number, d.dryer_name, d.motor_number, d.total_quintals::float qq, d.dry_start_at, p.stage, p.report_data->>'tunnel_number' rt
                                      FROM drying_tunnel_reports d LEFT JOIN lot_process_reports p ON p.id = d.process_report_id
                                     WHERE d.tunnel_number = $1 AND d.status = 'IN_PROGRESS' ORDER BY d.created_at`, [t]));
  const [s1] = await en(1), [s2] = await en(2);
  if (!s1 || !s2 || s1.dry_start_at || s2.dry_start_at) throw new Error("la copia no tiene las secadoras 1 y 2 llenas sin hora de inicio");
  const cuadrilla = async (id) => (await q("SELECT activity_name, tunnel_number, quantity::float q, subtotal::float s FROM cuadrilla_entries WHERE origen='SECADORA' AND referencia_id=$1 AND momento='LLENADO'", [id]));
  const c1 = await cuadrilla(s1.id), c2 = await cuadrilla(s2.id);

  // ── A. Intercambiar 1 ⇄ 2 ──
  const r = exigir(await api("POST", `/process-flow/drying/${s1.id}/cambiar-secadora`, { tunnel_number: 2 }), "A1. intercambiar la secadora 1 con la 2");
  check(r.intercambio === true && r.movidos.length === 2, "A2. se movieron los 2 secados (intercambio)", r);
  const [n1] = await en(1), [n2] = await en(2);
  check(n2?.id === s1.id && n1?.id === s2.id, "A3. lo de la 1 quedó en la 2 y lo de la 2 en la 1");
  check(n2.dryer_name === "Secadora 2" && n1.dryer_name === "Secadora 1" && n1.motor_number === 1 && n2.motor_number === 1, "A4. nombre de secadora y motor correctos", { n1, n2 });
  check(n2.stage === "TUNEL_2" && n2.rt === "2" && n1.stage === "TUNEL_1" && n1.rt === "1", "A5. el informe de cada túnel cambió de secadora");
  check(Math.abs(n2.qq - s1.qq) < 0.001 && Math.abs(n1.qq - s2.qq) < 0.001, "A6. los quintales viajan con su secado");
  const d1 = await cuadrilla(s1.id), d2 = await cuadrilla(s2.id);
  if (c1.length && c2.length) {
    check(d1.every((e) => e.activity_name === "RECEPCION A TUNEL 2" && e.tunnel_number === 2) && d2.every((e) => e.activity_name === "RECEPCION A TUNEL 1" && e.tunnel_number === 1),
      "A7. el llenado de la cuadrilla pasa a la tarifa de su secadora nueva", { d1, d2 });
    check(Math.abs(d1[0].q - c1[0].q) < 0.001 && Math.abs(d2[0].q - c2[0].q) < 0.001, "A8. los QQ de la cuadrilla no cambian");
  }

  // ── B. Con el motor encendido ya no ──
  exigir(await api("POST", "/process-flow/drying/motor/1/sync-run", { dry_start_at: new Date().toISOString() }), "B1. arranca el motor 1");
  const tarde = await api("POST", `/process-flow/drying/${s1.id}/cambiar-secadora`, { tunnel_number: 1 });
  check(tarde.status === 409 && /hora de inicio/.test(JSON.stringify(tarde.data)), "B2. con el motor encendido ya no se cambia de secadora", mostrar(tarde));
  const igual = await en(2);
  check(igual[0]?.id === s1.id, "B3. nada se movió");

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
