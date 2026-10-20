// 🔐 Seguridad del acceso: claves obvias rechazadas, código por correo al ADMINISTRADOR que entra desde internet
// (Cloudflare) en un equipo nuevo, equipo recordado, y CORS cerrado a páginas ajenas. SOLO copia; no envía correos
// reales (el transporte se reemplaza por uno de prueba que guarda el código).
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(BACKEND, "package.json"));
const bcrypt = require("bcryptjs");
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { q } = S;
// Importado DESPUÉS de montar (la app ya apunta a la copia): mismo módulo que usa el servidor.
const correo = await import(pathToFileURL(path.join(BACKEND, "dist", "services", "correo.js")).href);
const enviados = [];
correo.__usarTransporteDePrueba({ sendMail: async (m) => { enviados.push(m); } });
const URL_API = "http://127.0.0.1:4001/api/v1";
const post = async (ruta, cuerpo, headers = {}) => {
  const r = await fetch(URL_API + ruta, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(cuerpo) });
  const t = await r.text(); let d = t; try { d = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, data: d, headers: r.headers };
};
const CF = { "cf-connecting-ip": "200.1.2.3" };
try {
  await q(fs.readFileSync(new URL("../../../database/migrations/20261110_verificacion_admin.sql", import.meta.url), "utf8"));
  // Claves conocidas SOLO en la copia
  const admin = (await q("SELECT u.id, u.username, u.recovery_email FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='ADMINISTRADOR' AND u.is_active LIMIT 1"))[0];
  const oper = (await q("SELECT u.id, u.username FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='OPERADOR' AND u.is_active LIMIT 1"))[0];
  const CLAVE = "Prueba.Segura-2026";
  await q("UPDATE users SET password_hash = $2, recovery_email = COALESCE(recovery_email, 'prueba@ejemplo.com') WHERE id = $1", [admin.id, bcrypt.hashSync(CLAVE, 10)]);
  await q("UPDATE users SET password_hash = $2 WHERE id = $1", [oper.id, bcrypt.hashSync("12345678", 10)]);

  const l1 = await post("/auth/login", { username: admin.username, password: CLAVE });
  check(l1.ok && l1.data.token && !l1.data.requiere_codigo, "1. admin en la PC / red del local: entra directo (sin código)", l1.status);

  const l2 = await post("/auth/login", { username: admin.username, password: CLAVE }, CF);
  check(l2.ok && l2.data.requiere_codigo && !l2.data.token, "2. admin desde internet en equipo nuevo: pide código (no da sesión)", l2.data);
  const codigo = (String(enviados.at(-1)?.text ?? "").match(/\b(\d{6})\b/) ?? [])[1];
  check(Boolean(codigo) && enviados.at(-1)?.to, "3. el código se envía a su correo", enviados.at(-1)?.subject);

  const mal = await post("/auth/login/verificar", { desafio_id: l2.data.desafio_id, codigo: codigo === "000000" ? "111111" : "000000" });
  check(mal.status === 400 && !mal.data.token, "4. código equivocado: no entra", mal.status);
  const bien = await post("/auth/login/verificar", { desafio_id: l2.data.desafio_id, codigo, recordar: true });
  check(bien.ok && bien.data.token && bien.data.dispositivo, "5. código correcto: entra y recuerda el equipo", bien.status);
  const otraVez = await post("/auth/login/verificar", { desafio_id: l2.data.desafio_id, codigo, recordar: true });
  check(otraVez.status === 400, "6. el mismo código no sirve dos veces", otraVez.status);

  const l3 = await post("/auth/login", { username: admin.username, password: CLAVE, dispositivo: bien.data.dispositivo }, CF);
  check(l3.ok && l3.data.token && !l3.data.requiere_codigo, "7. desde internet en el equipo recordado: entra directo", l3.status);
  const l4 = await post("/auth/login", { username: admin.username, password: CLAVE, dispositivo: "token-falso" }, CF);
  check(l4.ok && l4.data.requiere_codigo, "8. con un token de equipo falso: vuelve a pedir código", l4.data);

  const o1 = await post("/auth/login", { username: oper.username, password: "12345678" }, CF);
  check(o1.ok && o1.data.token && o1.data.password_weak === true, "9. operador desde internet: entra (sin código) y se le pide cambiar su clave débil", { weak: o1.data.password_weak });
  const tokOp = o1.data.token;
  const cambio = await fetch(URL_API + "/auth/me/password", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${tokOp}` }, body: JSON.stringify({ current_password: "12345678", password: "password" }) });
  check(cambio.status === 400, "10. no acepta una clave obvia como nueva (password)", cambio.status);
  const cambio2 = await fetch(URL_API + "/auth/me/password", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${tokOp}` }, body: JSON.stringify({ current_password: "12345678", password: "Molino.Arroz-55" }) });
  check(cambio2.ok, "11. acepta una clave segura", cambio2.status);

  // CORS
  const c1 = await fetch(URL_API.replace("/api/v1", "") + "/health", { headers: { origin: "https://pagina-ajena.com" } });
  const c2 = await fetch(URL_API.replace("/api/v1", "") + "/health", { headers: { origin: "https://erp.ceyroerp.com" } });
  const c3 = await fetch(URL_API.replace("/api/v1", "") + "/health", { headers: { origin: "http://192.168.1.25:4000" } });
  check(!c1.headers.get("access-control-allow-origin"), "12. una página ajena no recibe permiso (CORS)", c1.headers.get("access-control-allow-origin"));
  check(c2.headers.get("access-control-allow-origin") === "https://erp.ceyroerp.com", "13. erp.ceyroerp.com sí", c2.headers.get("access-control-allow-origin"));
  check(c3.headers.get("access-control-allow-origin") === "http://192.168.1.25:4000", "14. la red del local sí", c3.headers.get("access-control-allow-origin"));
  check((await fetch(URL_API.replace("/api/v1", "") + "/health")).ok, "15. sin origen (la báscula, la app Android) sigue funcionando");

  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { correo.__usarTransporteDePrueba(null); const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
