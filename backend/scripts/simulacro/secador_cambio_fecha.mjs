// 🗓️ Jornada del secador al corregir la fecha de una corrida (2026-10-29): la secadora 3 quedó con llenado 27/10 aunque
// arrancó el 28, y la nómina contaba 3 secadoras el 27 y 2 el 28. Al pasar la corrida al 28, el 27 se vuelve a contar
// (2) y el 28 suma la 3 (3). Usa los secados reales de la copia. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const s3 = (await q("SELECT id, operator_name, filled_at::text f FROM drying_tunnel_reports WHERE tunnel_number = 3 AND status = 'IN_PROGRESS' AND dry_start_at IS NOT NULL LIMIT 1"))[0];
  if (!s3 || s3.f !== "2026-10-27") throw new Error("la copia no tiene la secadora 3 con llenado 27/10");
  const jornada = async (dia) => (await q("SELECT tunnels, base_amount::float base, status FROM worker_payments WHERE worker_role = 'SECADOR' AND btrim(worker_name) = $1 AND work_date = $2::date", [s3.operator_name.trim(), dia]));
  const [a27] = await jornada("2026-10-27"), [a28] = await jornada("2026-10-28");
  check(a27?.tunnels === 3 && a28?.tunnels === 2, "0. antes: el 27 con 3 secadoras y el 28 con 2 (el error)", { a27, a28 });

  exigir(await api("POST", "/process-flow/drying/motor/2/sync-run", { filled_at: "2026-10-28" }), "A1. la corrida del motor 2 pasa a llenado 28/10");
  const [d27] = await jornada("2026-10-27"), [d28] = await jornada("2026-10-28");
  check(d27?.tunnels === 2 && d28?.tunnels === 3, "A2. ahora: el 27 con 2 secadoras y el 28 con 3", { d27, d28 });
  check(d27 && d28 && Math.abs((d28.base - d27.base) - (a27.base - a28.base)) < 0.01, "A3. lo que baja el 27 es lo que sube el 28 (una secadora)", { antes: [a27?.base, a28?.base], ahora: [d27?.base, d28?.base] });
  const n = (await q("SELECT count(*)::int n FROM worker_payments WHERE worker_role = 'SECADOR' AND btrim(worker_name) = $1 AND work_date IN ('2026-10-27','2026-10-28')", [s3.operator_name.trim()]))[0].n;
  check(n === 2, "A4. sigue habiendo una sola jornada por día (no se duplica)", n);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
