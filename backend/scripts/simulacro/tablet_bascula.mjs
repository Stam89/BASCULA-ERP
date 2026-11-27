// 📟 Tablet de báscula ↔ ERP (2026-11-23): la serie 900 001+ no viaja a la tablet, los borrados en espera se avisan, estados y
// catálogo con firma, tablet bloqueada, un ticket malo no frena a los demás y Firebase no quita lo que no conoce. SOLO copia.
process.env.DEVICE_SYNC_KEY = "clave-de-prueba-simulacro";
process.env.BASCULA_APP_DIR = `${process.env.TEMP ?? "/tmp"}/app-tablet-simulacro-${process.pid}`;
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const KEY = process.env.DEVICE_SYNC_KEY;
const DIST = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist")).href;
const mostrar = (r) => `${r.status} ${JSON.stringify(r.data).slice(0, 260)}`;
const DEV = `bascula-SIM-${Date.now()}`;
const llamar = async (ruta, { body, key = KEY, dev = DEV, metodo, extra = {} } = {}) => {
  const r = await fetch(`http://127.0.0.1:4001/api/bascula${ruta}`, {
    method: metodo ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", ...(key ? { "x-device-key": key } : {}), ...(dev ? { "x-device-id": dev } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text(); let d = t; try { d = JSON.parse(t); } catch { /* texto */ }
  return { status: r.status, ok: r.ok, data: d };
};
const ultimo = (await q("SELECT max(regexp_replace(raw_payload->>'numeroTicket','[^0-9]','','g')::bigint) n FROM mobile_synced_tickets WHERE regexp_replace(raw_payload->>'numeroTicket','[^0-9]','','g')::bigint < 900000"))[0].n;
const N = Number(ultimo) + 10;
const fmt = (n) => `${String(n).padStart(6, "0").slice(0, 3)} ${String(n).padStart(6, "0").slice(3)}`;
const tk = (n, extra = {}) => ({ numeroTicket: fmt(n), modo: "principal", cliente: "SIM TABLET", placa: "SIM-001", calidad: "GRANO 0.11", calificacion: 225, pesoBruto: 9000, pesoTara: 4000, pesoNeto: 5000, totalQQ: 48.89, fecha: "23/11/2026 10:00", actualizadoEn: Date.now(), ...extra });
const fila = async (n) => (await q("SELECT id, en_espera, quitado_at, quitado_motivo, gross_weight::float g, raw_payload ? 'borradoEnTablet' AS borrado FROM mobile_synced_tickets WHERE regexp_replace(raw_payload->>'numeroTicket','[^0-9]','','g')::bigint = $1", [n]))[0];

try {
  // ── A. Registro, credencial propia y bloqueo ─────────────────────────────
  const alta = await llamar("/register-device", { body: { deviceId: DEV, modelo: "SIM TAB" }, extra: { "x-app-version": "11.58" } });
  check(alta.status === 201 && alta.data.token, "A1. la tablet se registra y recibe su credencial", alta.status);
  const token = alta.data.token;
  const conTok = (ruta, o = {}) => llamar(ruta, { key: token, ...o });
  const disc = await conTok("/discover", { extra: { "x-app-version": "11.58", "x-pendientes": "3" } });
  check(disc.ok && disc.data.auth === "device" && Math.abs(disc.data.serverTime - Date.now()) < 5000, "A2. credencial propia y hora del ERP", mostrar(disc));
  const dev = (await q("SELECT app_version, pendientes FROM bascula_devices WHERE device_id=$1", [DEV]))[0];
  check(dev.app_version === "11.58" && dev.pendientes === 3, "A3. el ERP guarda la versión y los pendientes que informa", dev);
  await conTok("/discover", { extra: { "x-pendientes": "no-es-numero" } });
  check((await q("SELECT pendientes p FROM bascula_devices WHERE device_id=$1", [DEV]))[0].p === 3, "A4. un dato raro no cambia lo guardado");
  check((await llamar("/discover", { key: "bdt_credencial_vieja" })).status === 401, "A5. credencial vieja → 401 (la app se vuelve a registrar)");
  const bl = await api("GET", "/../../bascula/devices").catch(() => null); void bl;
  await q("UPDATE bascula_devices SET activo=false WHERE device_id=$1", [DEV]);
  check((await conTok("/discover")).status === 403, "A6. tablet bloqueada por el administrador → 403");
  check((await llamar("/register-device", { body: { deviceId: DEV } })).status === 403, "A7. bloqueada: no se reactiva registrándose otra vez");
  check((await llamar("/sync", { body: { tickets: [tk(N)] } })).status === 403, "A8. ni con la clave de instalación");
  check((await q("SELECT activo FROM bascula_devices WHERE device_id=$1", [DEV]))[0].activo === false, "A9. sigue bloqueada");
  await q("UPDATE bascula_devices SET activo=true WHERE device_id=$1", [DEV]);
  check((await conTok("/discover")).ok, "A10. reactivada: su credencial vuelve a servir");
  check((await llamar("/estados", { key: "" })).status === 401 && (await llamar("/catalogo", { key: "" })).status === 401
    && (await llamar("/eliminados", { key: "", body: { eliminados: [{ numeroTicket: "1", eliminadoEn: 1 }] } })).status === 401, "A11. las rutas nuevas exigen credencial");

  // ── A'. Por internet la clave de instalación no sirve; la credencial propia, sí ─
  const web = { "cf-connecting-ip": "186.3.4.5", "cf-ray": "sim" };
  check((await llamar("/register-device", { body: { deviceId: DEV + "x" }, extra: web })).status === 403, "A12. por internet no se registra una tablet nueva");
  check((await llamar("/sync", { body: { tickets: [tk(N + 900)] }, extra: web })).status === 403 && !(await fila(N + 900)), "A13. ni entran tickets con la clave de instalación");
  check((await llamar("/restore", { extra: web })).status === 403, "A14. ni se descarga el historial");
  check((await conTok("/discover", { extra: web })).ok, "A15. la tablet ya registrada sí entra por internet con su credencial");
  const viejo = await fetch("http://127.0.0.1:4001/api/v1/tickets/sync", { method: "POST", headers: { "content-type": "application/json", "x-device-key": KEY, ...web }, body: JSON.stringify({ tickets: [] }) });
  check(viejo.status === 401, "A16. la ruta antigua tampoco acepta la clave por internet");

  // ── A''. Instalador de la app desde el ERP ───────────────────────────────
  check((await llamar("/app", { key: "" })).status === 401 && (await llamar("/app/apk", { key: "" })).status === 401, "A17. el instalador exige la credencial de la tablet");
  check((await conTok("/app")).data.disponible === false && (await conTok("/app/apk")).status === 404, "A18. sin versión publicada no ofrece nada");
  fs.mkdirSync(process.env.BASCULA_APP_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.BASCULA_APP_DIR, "Sim.apk"), "instalador de mentira");
  fs.writeFileSync(path.join(process.env.BASCULA_APP_DIR, "bascula-update.json"), JSON.stringify({ versionCode: 999, versionName: "99.9", archivo: "Sim.apk", sha256: "b".repeat(64), notes: "Prueba" }));
  const ap = await conTok("/app");
  check(ap.data.disponible && ap.data.versionCode === 999 && ap.data.tamano === 21 && !("ruta" in ap.data), "A19. ofrece la versión publicada (sin rutas del servidor)", mostrar(ap));
  const baja = await fetch("http://127.0.0.1:4001/api/bascula/app/apk", { headers: { "x-device-key": token, "x-device-id": DEV } });
  check(baja.ok && /android/.test(baja.headers.get("content-type")) && (await baja.text()) === "instalador de mentira", "A20. y se descarga completa", baja.headers.get("content-type"));
  fs.rmSync(process.env.BASCULA_APP_DIR, { recursive: true, force: true });

  // ── B. Serie de emergencia 900 001+: nunca viaja a la tablet ─────────────
  const st0 = (await conTok("/sync-state")).data.principalCount;
  const farmers = await q("SELECT id FROM farmers ORDER BY full_name LIMIT 1");
  const man = (extra) => api("POST", "/tickets/manual", { farmer_id: farmers[0].id, operation_type: "SECADO", rice_type: "CORRIENTE", plate: "GSB1234", gross_weight: 9000, tare_weight: 4000, qualification: 220, ...extra });
  const nuevo = await man({ modo: "nuevo" });
  check(nuevo.status === 201 && Number(nuevo.data.ticket.numero.replace(/\D/g, "")) > 900000, "B1. el ERP crea un ticket sin tablet (900 001+)", mostrar(nuevo));
  const recup = await man({ modo: "recuperar", ticket_number: N + 1 });
  check(recup.status === 201, "B2. y otro con un número de la tablet", mostrar(recup));
  const pull = (await conTok("/pull?after=0&limit=500")).data.tickets.map((x) => Number(String(x.ticket.numeroTicket).replace(/\D/g, "")));
  check(pull.includes(N + 1) && pull.every((n) => n < 900000), "B3. a la tablet baja el de su numeración y ninguno de la serie 900 000", pull.slice(-5));
  const rest = (await conTok("/restore")).data.tickets.map((x) => Number(String(x.ticket.numeroTicket).replace(/\D/g, "")));
  check(rest.includes(N + 1) && rest.every((n) => n < 900000), "B4. al recuperar el historial tampoco viaja", rest.length);
  check((await conTok("/sync-state")).data.principalCount === st0 + 1, "B5. el conteo para comparar no suma la serie de emergencia");
  const est0 = (await conTok("/estados")).data;
  check(est0.estados[String(N + 1)] === "P" && !Object.keys(est0.estados).some((n) => Number(n) >= 900000), "B6. los estados tampoco", est0.estados[String(N + 1)]);

  // ── B'. Eliminar un duplicado y renumerar no corre la serie de emergencia ─
  await conTok("/sync", { body: { tickets: [tk(N + 20), tk(N + 21)] } });
  const ren = await conTok("/delete-and-renumber", { body: { numeroTicket: N + 20, modo: "principal" } });
  check(ren.ok && ren.data.renumbered.every((x) => Number(x.to.replace(/\D/g, "")) < 900000), "B7. renumerar baja solo los de la tablet", mostrar(ren));
  check((await fila(Number(nuevo.data.ticket.numero.replace(/\D/g, "")))) !== undefined, "B8. el 900 001 sigue siendo 900 001");

  // ── C. Un ticket malo no frena y se dice cuál es ─────────────────────────
  const malo = await conTok("/sync", { body: { tickets: [tk(N + 2), { ...tk(N + 3), pesoBruto: "abc" }, tk(N + 4), { ...tk(N), numeroTicket: "SIN NUMERO" }] } });
  check(malo.ok && malo.data.count === 2 && malo.data.skipped === 2, "C1. entran los buenos", mostrar(malo));
  check(malo.data.rechazados.length === 2 && malo.data.rechazados.some((x) => x.numeroTicket === fmt(N + 3) && /pesoBruto/.test(x.motivo)), "C2. y dice cuáles no y por qué", malo.data.rechazados);
  check(Math.abs(malo.data.serverTime - Date.now()) < 5000, "C3. responde con la hora del ERP");

  // ── D. Ticket ya ingresado que la tablet cambia después ──────────────────
  const ing = (await q(`SELECT t.id, t.raw_payload FROM mobile_synced_tickets t WHERE t.weighing_ticket_id IS NOT NULL AND t.raw_payload->>'numeroTicket' IS NOT NULL
    AND NOT (t.raw_payload ? 'cambioPosterior') AND regexp_replace(t.raw_payload->>'numeroTicket','[^0-9]','','g')::bigint < 900000 ORDER BY t.synced_at DESC LIMIT 1`))[0];
  const nIng = String(Number(String(ing.raw_payload.numeroTicket).replace(/\D/g, "")));
  check(["I", "L"].includes(est0.estados[nIng]), "D1. un ticket ingresado sale ingresado o liquidado", est0.estados[nIng]);
  const cambio = await conTok("/sync", { body: { tickets: [{ ...ing.raw_payload, pesoBruto: Number(ing.raw_payload.pesoBruto) + 777, actualizadoEn: Date.now() }] } });
  check(cambio.ok && cambio.data.porRevisar.includes(ing.raw_payload.numeroTicket), "D2. la tablet se entera de que ese cambio queda por revisar", mostrar(cambio));
  const est1 = (await conTok("/estados")).data;
  check(est1.revisar.includes(nIng) && est1.firma !== est0.firma, "D3. y sale marcado en los estados", est1.revisar);
  check((await conTok(`/estados?firma=${est1.firma}`)).data.igual === true, "D4. con la misma firma no se vuelve a descargar");
  await q("UPDATE mobile_synced_tickets SET raw_payload = raw_payload - 'cambioPosterior' WHERE id=$1", [ing.id]);

  // ── E. Catálogo de agricultores ──────────────────────────────────────────
  const cat = (await conTok("/catalogo")).data;
  const activos = (await q("SELECT count(*)::int n FROM farmers WHERE is_active AND length(btrim(full_name))>=2"))[0].n;
  check(cat.agricultores.length === activos && cat.agricultores.every((x) => Object.keys(x).every((k) => ["n", "a"].includes(k))), "E1. solo nombres (nada de cédulas, teléfonos ni cuentas)", cat.agricultores.length);
  const al = (await q("SELECT a.alias_nombre a, f.full_name n FROM agricultor_alias a JOIN farmers f ON f.id=a.agricultor_id AND f.is_active LIMIT 1"))[0];
  if (al) check(cat.agricultores.some((x) => x.n === al.n.trim() && x.a?.includes(al.a.trim())), "E2. con sus otros nombres", al);
  check((await conTok(`/catalogo?firma=${cat.firma}`)).data.igual === true, "E3. con la misma firma no se vuelve a descargar");

  // ── F. Pesaje en espera borrado en la tablet ─────────────────────────────
  const t0 = Date.now() - 60000;
  const esp = (n, extra) => conTok("/sync", { body: { enEspera: true, tickets: [tk(n, { pesoTara: 0, pesoNeto: 9000, totalQQ: 0, calificacion: 0, actualizadoEn: t0, ...extra })] } });
  const elim = async (n, en = Date.now()) => (await conTok("/eliminados", { body: { deviceId: DEV, eliminados: [{ numeroTicket: fmt(n), modo: "principal", eliminadoEn: en }] } })).data.resultados[0].resultado;
  await esp(N + 5);
  const cuenta1 = (await conTok("/sync-state")).data.principalCount;
  check((await elim(N + 5, t0 - 1000)) === "mas_nuevo" && (await fila(N + 5)).quitado_at === null, "F1. un aviso más viejo que el pesaje no lo quita");
  check((await elim(N + 5)) === "quitado", "F2. borrado en la tablet → sale de pendientes");
  const f5 = await fila(N + 5);
  check(f5.quitado_at && /tablet de báscula/.test(f5.quitado_motivo) && f5.borrado, "F3. queda el motivo y no se borra", f5);
  check((await elim(N + 5)) === "ya_quitado", "F4. repetir el aviso no hace nada más");
  check((await conTok("/sync-state")).data.principalCount === cuenta1 - 1, "F5. deja de contar al comparar con la tablet");
  check(!(await conTok("/restore")).data.tickets.some((x) => x.ticket.numeroTicket === fmt(N + 5)), "F6. y no vuelve a la tablet al recuperar el historial");
  check((await conTok("/estados")).data.estados[String(N + 5)] === "Q", "F7. sale quitado en los estados");
  // la copia vieja de Firebase (misma versión) no lo revive
  const { importBasculaTickets, quitarEnEsperaBorrados } = await import(`${DIST}/routes/modules/mobile-tickets.js`);
  await importBasculaTickets([tk(N + 5, { pesoTara: 0, totalQQ: 0, calificacion: 0, actualizadoEn: t0 })], "firebase-auto:sim", { enEspera: true });
  const f5b = await fila(N + 5);
  check(f5b.quitado_at && f5b.borrado, "F8. la copia vieja de Firebase no lo revive");
  // 2026-11-26 (#561): la misma versión desde Firebase en cada vuelta no se vuelve a guardar ni mueve la hora
  {
    const N7 = N + 47, t7 = Date.now() - 60000;
    await importBasculaTickets([tk(N7, { actualizadoEn: t7 })], "firebase-auto:sim", { enEspera: false });
    const h1 = (await q("SELECT synced_at FROM mobile_synced_tickets WHERE id = $1", [(await fila(N7)).id]))[0].synced_at;
    await new Promise((r) => setTimeout(r, 50));
    const r2 = await importBasculaTickets([tk(N7, { actualizadoEn: t7 })], "firebase-auto:sim", { enEspera: false });
    const h2 = (await q("SELECT synced_at FROM mobile_synced_tickets WHERE id = $1", [(await fila(N7)).id]))[0].synced_at;
    check(String(h1) === String(h2) && (r2.imported?.length ?? r2.count ?? 0) === 0, "F8b. Firebase misma versión: no se reenvía (no mueve la hora)");
    await importBasculaTickets([tk(N7, { actualizadoEn: t7 + 1000, pesoBruto: 9100 })], "firebase-auto:sim", { enEspera: false });
    check((await fila(N7)).g === 9100, "F8c. Firebase versión nueva: sí actualiza");
  }
  // la misma tablet lo vuelve a mandar (restauró un respaldo)
  await esp(N + 5);
  const f5c = await fila(N + 5);
  check(f5c.quitado_at === null && !f5c.borrado, "F9. si la tablet lo tiene otra vez, vuelve a pendientes");
  // número reusado: el aviso llega después del pesaje nuevo
  await esp(N + 5, { cliente: "OTRO CLIENTE SIM", actualizadoEn: t0 + 30000 });
  check((await elim(N + 5, t0 + 10000)) === "mas_nuevo" && (await fila(N + 5)).quitado_at === null, "F10. número reusado: no quita el pesaje nuevo");
  await conTok("/sync", { body: { tickets: [tk(N + 6)] } });
  check((await elim(N + 6)) === "completo" && (await fila(N + 6)).quitado_at === null, "F11. un ticket completo no se quita por aquí");
  check((await elim(Number(nIng), Date.now() + 99999)) === "procesado", "F12. lo ya ingresado no se toca");
  check((await elim(N + 300)) === "no_existe", "F13. uno que nunca llegó: no pasa nada");
  check((await elim(900001)) === "no_existe", "F14. la serie de emergencia no se toca desde la tablet");
  const part = (await conTok("/eliminados", { body: { eliminados: [{ numeroTicket: fmt(N + 5), modo: "particular", eliminadoEn: Date.now() }] } })).data.resultados[0].resultado;
  check(part === "no_existe" && (await fila(N + 5)).quitado_at === null, "F15. el modo particular no toca el principal");

  // ── G. Firebase no quita lo que todavía no conoce (caso real #512) ───────
  await esp(N + 7);
  const otros = (await q("SELECT ltrim(regexp_replace(raw_payload->>'numeroTicket','[^0-9]','','g'),'0') n FROM mobile_synced_tickets WHERE en_espera AND quitado_at IS NULL")).map((x) => x.n).filter((n) => n !== String(N + 7));
  check((await quitarEnEsperaBorrados("principal", new Set(otros), t0 - 1)) === 0 && (await fila(N + 7)).quitado_at === null, "G1. más nuevo que lo último de Firebase: no se quita");
  check((await quitarEnEsperaBorrados("principal", new Set(otros), t0 + 1)) === 1 && (await fila(N + 7)).quitado_at !== null, "G2. si Firebase ya se actualizó después y no está, sí");
  await conTok("/sync", { body: { tickets: [tk(N + 7, { actualizadoEn: Date.now() })] } });
  check((await fila(N + 7)).quitado_at === null, "G3. al completar el 2º pesaje vuelve solo");

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió|rubro en Resultado/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
