// ⚖️ Servicio de pilada a clientes: tarifa de Parámetros de planta ($4) y cobro mínimo por rendimiento
// ((kg de cáscara ÷ 100) + 7%) — pedido del dueño 2026-10-30. Con el servicio de CHAVO (2,110 kg, salieron 14 QQ):
// mínimo 22.58 QQ × $4 = $90.32. Actualiza el servicio, su Por Cobrar, la orden de maquila y Costos. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
try {
  const svc = (await q(`SELECT ps.id, ps.total::float t, ps.receivable_id, pb.input_quantity::float kg
                          FROM pilado_services ps JOIN processing_batches pb ON pb.id = ps.processing_batch_id
                         WHERE ps.client_accionista_id IS NULL ORDER BY ps.created_at DESC LIMIT 1`))[0];
  check(!!svc, "0. hay un servicio de pilada a cliente (CHAVO)", svc);
  const cfg = exigir(await api("PUT", "/settings/plant-params", { accionista_id: matriz, tarifa_pilado_qq: 4, humedad_base_pct: 13, servicio_minimo_pct: 7 }, matriz), "1. tarifa $4 y mínimo 7% en Parámetros de planta");
  check(Number(cfg.tarifa_pilado_qq) === 4 && Number(cfg.servicio_minimo_pct) === 7, "2. quedaron guardados", { t: cfg.tarifa_pilado_qq, p: cfg.servicio_minimo_pct });

  const minimo = Math.round((svc.kg / 100) * 1.07 * 100) / 100;
  const r = exigir(await api("POST", `/pilado/services/${svc.id}/aplicar-minimo`, {}, matriz), "3. aplicar mínimo al servicio");
  check(r.aplico_minimo && cerca(r.qq_minimo, minimo) && cerca(r.total, Math.round(minimo * 4 * 100) / 100), `4. se cobra el mínimo ${minimo} QQ × $4`, { qq_minimo: r.qq_minimo, total: r.total, antes: r.antes });
  const ar = (await q("SELECT amount::float a, balance::float b FROM accounts_receivable WHERE id=$1", [svc.receivable_id]))[0];
  check(cerca(ar.a, r.total) && cerca(ar.b, r.total), "5. su Por Cobrar queda con el nuevo valor", ar);
  const ps = (await q("SELECT total::float t, quintals::float qq FROM pilado_services WHERE id=$1", [svc.id]))[0];
  check(cerca(ps.t, r.total) && cerca(ps.qq, minimo), "6. el servicio queda con los QQ y el total nuevos", ps);
  const otra = exigir(await api("POST", `/pilado/services/${svc.id}/aplicar-minimo`, {}, matriz), "7. aplicarlo otra vez");
  check(otra.sin_cambio === true, "8. no cambia nada la segunda vez", otra);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
