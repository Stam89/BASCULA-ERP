// 🗓️ Regla del dueño (2026-10-29): el LLENADO fecha el pago de la CUADRILLA y la HORA DE INICIO el del SECADOR.
// Caso real: la secadora 3 se llenó el 27/10 y arrancó el 28/10 08:30; la nómina contaba al secador 3 secadoras el 27
// y 2 el 28 (por la fecha de llenado). Al recalcular la corrida, el secador queda 2 el 27 y 3 el 28, y la cuadrilla
// del llenado sigue en el 27. Usa los secados reales de la copia. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const s3 = (await q("SELECT id, operator_name, filled_at::text f, (dry_start_at AT TIME ZONE 'America/Guayaquil')::date::text i FROM drying_tunnel_reports WHERE tunnel_number = 3 AND filled_at = '2026-10-27' AND dry_start_at IS NOT NULL LIMIT 1"))[0];
  if (!s3 || s3.f !== "2026-10-27" || s3.i !== "2026-10-28") throw new Error("la copia no tiene la secadora 3 llenada el 27 y arrancada el 28");
  const sec = s3.operator_name.trim();
  const jornada = async (dia) => (await q("SELECT tunnels, base_amount::float base FROM worker_payments WHERE worker_role = 'SECADOR' AND btrim(worker_name) = $1 AND work_date = $2::date", [sec, dia]));
  const cuadrillaDia = async () => (await q("SELECT DISTINCT work_date::text d FROM cuadrilla_entries WHERE origen = 'SECADORA' AND referencia_id = $1 AND momento = 'LLENADO'", [s3.id])).map((x) => x.d);
  const [a27] = await jornada("2026-10-27"), [a28] = await jornada("2026-10-28");
  check(a27?.tunnels === 3 && a28?.tunnels === 2, "0. antes: el secador con 3 el 27 y 2 el 28 (el error)", { a27, a28 });
  const cuadAntes = await cuadrillaDia();

  // Recalcular la jornada del secador de esos días con la regla vigente.
  const rc = exigir(await api("POST", "/process-flow/drying/secador/recalcular", { from: "2026-10-26", to: "2026-10-29" }), "A1. se recalcula la jornada del secador del 26 al 29");
  const sinCambio = await q("SELECT work_date::text d, tunnels FROM worker_payments WHERE worker_role = 'SECADOR' AND work_date IN ('2026-10-26','2026-10-29') ORDER BY work_date");
  check(sinCambio.every((x) => x.tunnels === 0), "A1b. los días sin secadoras (26 y 29) siguen solo con la guardianía", { sinCambio, rc: rc.jornadas });
  const [d27] = await jornada("2026-10-27"), [d28] = await jornada("2026-10-28");
  check(d27?.tunnels === 2 && d28?.tunnels === 3, "A2. el secador: 2 secadoras el 27 y 3 el 28 (por la hora de inicio)", { d27, d28 });
  check(d27 && d28 && Math.abs((d28.base - d27.base) - (a27.base - a28.base)) < 0.01, "A3. lo que baja el 27 es lo que sube el 28 (una secadora)", { antes: [a27?.base, a28?.base], ahora: [d27?.base, d28?.base] });
  const f = (await q("SELECT filled_at::text f FROM drying_tunnel_reports WHERE id = $1", [s3.id]))[0].f;
  const cuadDespues = await cuadrillaDia();
  check(f === "2026-10-27" && JSON.stringify(cuadDespues) === JSON.stringify(cuadAntes) && cuadDespues.includes("2026-10-27"),
    "A4. la fecha de llenado y la cuadrilla del llenado siguen en el 27", { f, cuadAntes, cuadDespues });
  const n = (await q("SELECT count(*)::int n FROM worker_payments WHERE worker_role = 'SECADOR' AND btrim(worker_name) = $1 AND work_date IN ('2026-10-27','2026-10-28')", [sec]))[0].n;
  check(n === 2, "A5. una sola jornada por día (no se duplica)", n);
  const sug = exigir(await api("GET", "/labor/secador-suggestions?from=2026-10-27&to=2026-10-28"), "A6. días detectados del secador").rows;
  const s27 = sug.find((x) => String(x.work_date).slice(0, 10) === "2026-10-27" && x.worker_name.trim() === sec);
  const s28 = sug.find((x) => String(x.work_date).slice(0, 10) === "2026-10-28" && x.worker_name.trim() === sec);
  check((!s27 || s27.tunnels === 2) && (!s28 || s28.tunnels === 3), "A7. las sugerencias del secador cuentan igual (por inicio)", { s27, s28 });

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
