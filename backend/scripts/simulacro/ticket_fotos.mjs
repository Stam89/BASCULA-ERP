// 📷 Fotos del camión que manda la tablet (pedido del dueño 2026-11-25): credencial, ticket que aún no llega, repetidas, tope,
// archivos que no son foto, verlas con sesión y limpieza a los 6 meses. Carpeta temporal. SOLO copia.
process.env.DEVICE_SYNC_KEY = "clave-de-prueba-simulacro";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const DIR = process.env.FOTOS_BASCULA_DIR;
fs.rmSync(DIR, { recursive: true, force: true });
const svc = await import(`${pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist")).href}/services/ticket-fotos.js`);
const KEY = process.env.DEVICE_SYNC_KEY, DEV = `bascula-FOTO-${Date.now()}`;
const foto = (n = 5000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(n)]);
const mandar = async (numero, cuerpo, { id = crypto.randomUUID(), key = KEY, tipo = "image/jpeg" } = {}) => {
  const r = await fetch(`http://127.0.0.1:4001/api/bascula/fotos?id=${id}&numero=${encodeURIComponent(numero)}&tomadaEn=${Date.now() - 60000}`, {
    method: "POST", headers: { "content-type": tipo, "x-device-key": key, "x-device-id": DEV }, body: cuerpo });
  return { status: r.status, data: await r.json().catch(() => null), id };
};
try {
  check(DIR.includes("fotos-simulacro") && svc.carpetaFotos() === DIR, "0. carpeta temporal, no la real", DIR);
  const ultimo = (await q("SELECT max(regexp_replace(raw_payload->>'numeroTicket','[^0-9]','','g')::bigint) n FROM mobile_synced_tickets WHERE regexp_replace(raw_payload->>'numeroTicket','[^0-9]','','g')::bigint < 900000"))[0].n;
  const fmt = (n) => `${String(n).padStart(6, "0").slice(0, 3)} ${String(n).padStart(6, "0").slice(3)}`;
  const N = fmt(Number(ultimo) + 7);
  check((await mandar(N, foto(), { key: "otra-clave-cualquiera-zzz" })).status === 401, "1. sin credencial no entra");
  check((await mandar(N, foto())).status === 404, "2. si el ticket no ha llegado: 404 (la tablet la guarda)");
  check(!fs.existsSync(DIR), "3. y no deja archivos");
  const al = await fetch("http://127.0.0.1:4001/api/bascula/sync", { method: "POST", headers: { "content-type": "application/json", "x-device-key": KEY, "x-device-id": DEV },
    body: JSON.stringify({ deviceId: DEV, enEspera: true, tickets: [{ numeroTicket: N, modo: "principal", cliente: "SIM FOTO", placa: "SIM-002", calidad: "GRANO 0.11", calificacion: 225, pesoBruto: 9000, pesoTara: 0, pesoNeto: 0, totalQQ: 0, fecha: "25/11/2026 08:00", actualizadoEn: Date.now() }] }) });
  check(al.status === 201, "4. llega el ticket (en espera)", al.status);
  const buena = foto(), f1 = await mandar(N, buena);
  check(f1.status === 201 && f1.data.estado === "guardada", "5. ahora sí se guarda la foto", f1.data);
  check((await mandar(N, buena, { id: f1.id })).data?.estado === "repetida", "6. repetir el envío no la duplica");
  check((await mandar(N, Buffer.from("no soy una foto".repeat(200)))).status === 400, "7. lo que no es JPG se rechaza");
  check((await mandar(N, foto(4 * 1024 * 1024))).status >= 400, "8. demasiado grande se rechaza");
  check((await mandar("900 005", foto())).status === 400, "9. la serie de emergencia no es de la tablet");
  for (let i = 0; i < 3; i++) await mandar(N, foto());
  check((await mandar(N, foto())).status === 409, "10. tope de 4 por ticket");
  const t = (await q("SELECT id FROM mobile_synced_tickets WHERE raw_payload->>'numeroTicket' = $1", [N]))[0].id;
  const lista = (await api("GET", "/tickets?status=pending", undefined, matriz)).data;
  check(lista.find((x) => x.id === t)?.fotos === 4, "11. Báscula muestra cuántas tiene", lista.find((x) => x.id === t)?.fotos);
  const fs1 = (await api("GET", `/tickets/${t}/fotos`, undefined, matriz)).data;
  check(fs1.length === 4 && fs1.some((x) => x.id === f1.id), "12. y las lista");
  const sinSesion = await fetch(`http://127.0.0.1:4001/api/v1/tickets/fotos/${f1.id}`);
  check(sinSesion.status === 401, "13. sin sesión no se ven", sinSesion.status);
  const arch = (await q("SELECT archivo FROM ticket_fotos WHERE id = $1", [f1.id]))[0].archivo;
  check(fs.readFileSync(path.join(DIR, arch)).equals(buena), "14. el archivo es el mismo que se mandó");
  await q("UPDATE mobile_synced_tickets SET raw_payload = jsonb_set(raw_payload, '{numeroTicket}', to_jsonb($2::text)) WHERE id = $1", [t, fmt(Number(ultimo) + 8)]);
  check((await api("GET", `/tickets/${t}/fotos`, undefined, matriz)).data.length === 4, "15. si se renumera, las fotos siguen al ticket");
  // Limpieza: lo de más de 6 meses se va (registro y archivo); lo reciente queda.
  await q("UPDATE ticket_fotos SET created_at = now() - interval '7 months' WHERE id = $1", [f1.id]);
  const viejo = new Date(Date.now() - 3 * 86400000); fs.utimesSync(path.join(DIR, arch), viejo, viejo);
  const { pool } = await import(`${pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist")).href}/db/pool.js`);
  check((await svc.limpiarFotosViejas(pool)) === 1 && !fs.existsSync(path.join(DIR, arch)), "16. a los 6 meses se borra sola");
  check((await api("GET", `/tickets/${t}/fotos`, undefined, matriz)).data.length === 3, "17. las recientes quedan");
  let fuera = false; try { svc.rutaDeFoto("../../secreto.jpg"); } catch { fuera = true; }
  check(fuera, "18. nunca sale de su carpeta");
  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { fs.rmSync(DIR, { recursive: true, force: true }); const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
