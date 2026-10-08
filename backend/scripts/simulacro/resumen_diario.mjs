// Resumen diario por correo: configuración, vista previa, prueba, programador (con un correo FALSO: nunca envía nada real).
// Se pone SMTP de mentira ANTES de cargar la app y se instala un transporte de prueba que solo guarda los mensajes.
process.env.SMTP_USER = "simulacro@ejemplo.invalid";
process.env.SMTP_PASS = "no-es-real";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q, admin } = S;
const DIST = pathToFileURL(path.join(BACKEND, "dist")).href;
const correo = await import(`${DIST}/services/correo.js`);
const svc = await import(`${DIST}/services/resumen-diario.js`);
const enviados = []; let fallar = false;
correo.__usarTransporteDePrueba({ sendMail: async (m) => { if (fallar) throw new Error("SMTP caído (simulacro)"); enviados.push(m); } });
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cfg = async () => (await q("SELECT activo, hora, destinatarios, ultimo_envio_fecha::text f, intentos_hoy, ultimo_resultado FROM resumen_diario_config WHERE id=1"))[0];

try {
  // ── A. Solo el administrador ───────────────────────────────────────────
  const noAdmin = apiComo(admin.id, "operador.sim", "Operador");
  const na = await noAdmin("GET", "/resumen-diario/config");
  check(na.status === 403, "A1. quien no es administrador no ve ni cambia el resumen (403)", na.status);
  const c0 = exigir(await api("GET", "/resumen-diario/config"), "A2. el administrador lee la configuración");
  check(c0.activo === false && c0.correo_configurado === true, "A3. nace APAGADO (y el servidor del simulacro tiene correo de mentira)", { activo: c0.activo });

  // ── B. Validaciones de la configuración ────────────────────────────────
  const put = (b) => api("PUT", "/resumen-diario/config", b);
  check((await put({ activo: false, hora: "25:99", destinatarios: [] })).status === 400, "B1. hora inválida → 400");
  check((await put({ activo: false, hora: "20:30", destinatarios: ["esto no es correo"] })).status === 400, "B2. correo inválido → 400");
  check((await put({ activo: true, hora: "20:30", destinatarios: [] })).status === 400, "B3. activar sin correos → 400");
  check((await put({ activo: false, hora: "20:30", destinatarios: ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com"] })).status === 400, "B4. más de 5 correos → 400");
  const okc = await put({ activo: false, hora: "07:15", destinatarios: ["Dueno@Ejemplo.com", "dueno@ejemplo.com", "  socio@ejemplo.com "] });
  check(okc.ok && okc.data.destinatarios.length === 2 && okc.data.destinatarios[0] === "dueno@ejemplo.com", "B5. se limpian espacios, mayúsculas y repetidos", okc.data?.destinatarios);

  // ── C. Contenido: la caja cuenta lo VIGENTE (sin inflar con anulaciones) ──
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja resumen", tipo: "EFECTIVO", opening_balance_cash: 500 }), "C0. caja abierta con $500");
  const mov = (movement, amount, d) => api("POST", "/cash/movements", { cash_register_id: caja.id, movement, category: "OTROS", amount, description: d });
  exigir(await mov("INCOME", 100, "ingreso"), "C1a. ingreso de $100");
  exigir(await mov("EXPENSE", 40, "gasto"), "C1b. gasto de $40");
  const equivocado = exigir(await mov("EXPENSE", 10, "gasto equivocado"), "C1c. gasto de $10 (se anulará)");
  exigir(await api("POST", `/cash/movements/${equivocado.id}/reverse`, { reason: "equivocado" }), "C1d. se anula el de $10");
  await q("UPDATE app_settings SET business_name = $1 WHERE socio_id IS NULL", ["<b>PILADORA</b> & Cía"]);
  const v = exigir(await api("GET", "/resumen-diario/vista"), "C2. vista previa del resumen");
  check(/Ingresos \$100\.00 · Egresos \$40\.00 · Neto \$60\.00/.test(v.texto), "C3. caja del resumen: Ingresos $100 · Egresos $40 (la anulación no infla las cifras)", v.texto.split("\n").find((l) => l.includes("Ingresos")));
  check(!v.html.includes("<b>PILADORA</b>") && v.html.includes("&lt;b&gt;PILADORA"), "C4. el nombre del negocio va escapado en el HTML (nada de código inyectado)");
  check(/Caja abierta/.test(v.texto), "C5. dice que la caja está abierta");

  // ── D. Prueba de envío ─────────────────────────────────────────────────
  const sinDest = await api("POST", "/resumen-diario/prueba", { destinatarios: ["malo"] });
  check(sinDest.status === 400, "D1. prueba con correo inválido → 400", sinDest.status);
  const p1 = await api("POST", "/resumen-diario/prueba", { destinatarios: ["dueno@ejemplo.com"] });
  check(p1.ok && enviados.length === 1 && enviados[0].to === "dueno@ejemplo.com" && /Resumen del día/.test(enviados[0].subject), "D2. la prueba manda UN correo con el asunto del resumen", { st: p1.status, n: enviados.length });
  const p2 = await api("POST", "/resumen-diario/prueba", { destinatarios: ["dueno@ejemplo.com"] });
  check(p2.status === 429 && enviados.length === 1, "D3. otra prueba seguida se frena (429) y no manda nada", p2.status);
  check((await cfg()).f === null, "D4. la prueba NO cuenta como el envío del día", (await cfg()).f);

  // ── E. Programador automático ──────────────────────────────────────────
  await put({ activo: true, hora: "00:00", destinatarios: ["dueno@ejemplo.com"] });
  enviados.length = 0;
  const [t1, t2] = await Promise.all([svc.ticResumenDiario(), svc.ticResumenDiario()]);
  check(enviados.length === 1 && [t1, t2].filter((x) => x === "enviado").length === 1, "E1. dos «tics» a la vez mandan UN solo correo", { t1, t2, mails: enviados.length });
  const t3 = await svc.ticResumenDiario();
  check(t3 === "ya enviado hoy" && enviados.length === 1 && (await cfg()).ultimo_resultado === "OK", "E2. el mismo día no se vuelve a enviar", { t3 });
  // Falla del correo: reintenta con espera, sin saturar
  await q("UPDATE resumen_diario_config SET ultimo_envio_fecha = NULL, intento_fecha = NULL, intentos_hoy = 0, ultimo_intento_at = NULL WHERE id=1");
  fallar = true; enviados.length = 0;
  const f1 = await svc.ticResumenDiario();
  const c1 = await cfg();
  check(f1 === "falló" && /^ERROR/.test(c1.ultimo_resultado ?? "") && c1.intentos_hoy === 1 && c1.f === null, "E3. si el correo falla: queda anotado el error y NO se da por enviado", { f1, res: c1.ultimo_resultado, intentos: c1.intentos_hoy });
  const f2 = await svc.ticResumenDiario();
  check(f2 === "esperando para reintentar", "E4. no reintenta de inmediato (espera 30 min)", f2);
  fallar = false;
  await q("UPDATE resumen_diario_config SET ultimo_intento_at = now() - interval '31 minutes' WHERE id=1");
  const f3 = await svc.ticResumenDiario();
  check(f3 === "enviado" && enviados.length === 1 && (await cfg()).ultimo_resultado === "OK", "E5. al volver el correo, el siguiente intento lo envía", { f3 });
  // Tope diario
  await q("UPDATE resumen_diario_config SET ultimo_envio_fecha = NULL, intento_fecha = (now() AT TIME ZONE 'America/Guayaquil')::date, intentos_hoy = 4, ultimo_intento_at = now() - interval '2 hours' WHERE id=1");
  check((await svc.ticResumenDiario()) === "demasiados intentos hoy", "E6. tras 4 intentos fallidos hoy, deja de insistir");
  // Apagado
  await put({ activo: false, hora: "00:00", destinatarios: ["dueno@ejemplo.com"] });
  await q("UPDATE resumen_diario_config SET ultimo_envio_fecha = NULL, intentos_hoy = 0, ultimo_intento_at = NULL WHERE id=1");
  enviados.length = 0;
  check((await svc.ticResumenDiario()) === "apagado" && enviados.length === 0, "E7. apagado no envía nada");
  // La hora (hora de Ecuador)
  await put({ activo: true, hora: "23:59", destinatarios: ["dueno@ejemplo.com"] });
  const ahora = await svc.ahoraEcuador();
  if (ahora.hhmm < "23:59") check((await svc.ticResumenDiario()) === "aún no es la hora" && enviados.length === 0, "E8. antes de la hora configurada no envía");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. las ${TOTAL_REGLAS} reglas de consistencia se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
