// Base del simulacro: copia de la base real + servidor Express REAL en el puerto 4001 (nunca toca la base real ni Firebase).
// Uso (desde backend/, con el backend ya compilado: npm run build):  node scripts/simulacro/simulacro.mjs
// Requiere PostgreSQL local (pg_dump/pg_restore/createdb/dropdb en PG_BIN o en la ruta por defecto) y backend/.env.
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(BACKEND, "package.json"));
const pg = require("pg");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(BACKEND, ".env") });
const SP = os.tmpdir().split(path.sep).join("/");
const BIN = process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const url = new URL(process.env.DATABASE_URL);
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGUSER: decodeURIComponent(url.username), PGHOST: url.hostname, PGPORT: url.port || "5432" };
export const REAL = url.pathname.slice(1), COPIA = "bascula_erp_simulacro";
if (REAL === COPIA) throw new Error("copia igual a real");
const run = (exe, args) => { const r = spawnSync(`${BIN}/${exe}`, args, { env, encoding: "utf8" }); if (r.status !== 0) throw new Error(`${exe}: ${r.stderr}`); };

export async function montar({ puerto = 4001, copiar = true, liberarTuneles = true } = {}) {
  if (copiar) {
    const dump = `${SP}/simulacro.dump`;
    run("pg_dump", ["-Fc", "-f", dump, REAL]);
    spawnSync(`${BIN}/dropdb`, ["--if-exists", COPIA], { env });
    run("createdb", [COPIA]);
    spawnSync(`${BIN}/pg_restore`, ["-d", COPIA, "--no-owner", dump], { env, encoding: "utf8" });
  }
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.PGUSER)}:${encodeURIComponent(env.PGPASSWORD)}@${env.PGHOST}:${env.PGPORT}/${COPIA}`;
  process.env.PORT = String(puerto);
  process.env.APP_MODE = "test";
  const DIST = pathToFileURL(path.join(BACKEND, "dist")).href;
  const { app } = await import(`${DIST}/app.js`);
  const { signToken } = await import(`${DIST}/auth/jwt.js`);
  const { ensureLaborTables } = await import(`${DIST}/routes/modules/labor.js`);
  const { pool } = await import(`${DIST}/db/pool.js`);
  // SEGURIDAD: si algún módulo cargó `dist/db/pool.js` ANTES de apuntar a la copia (por ejemplo un import estático
  // que lo arrastre), la app escribiría en la base REAL. Se comprueba y se aborta antes de hacer cualquier cosa.
  const dbApp = (await pool.query("SELECT current_database() AS d")).rows[0].d;
  if (dbApp !== COPIA) throw new Error(`ABORTADO: la app quedó conectada a «${dbApp}» y no a la copia «${COPIA}». No se ejecuta nada.`);
  await ensureLaborTables();
  const server = await new Promise((res) => { const s = app.listen(puerto, "127.0.0.1", () => res(s)); });
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  // Los túneles que estén en uso en la base REAL (operación del día) estorbarían a los simulacros: SOLO en la COPIA se dan por terminados.
  // (El control de arriba ya garantizó que `c` y la app apuntan a la copia.)
  if ((await c.query("SELECT current_database() AS d")).rows[0].d !== COPIA) throw new Error("ABORTADO: la conexión del simulacro no es la copia.");
  if (liberarTuneles) await c.query("UPDATE drying_tunnel_reports SET status = 'COMPLETED', dry_end_at = COALESCE(dry_end_at, now()), drying_hours = COALESCE(drying_hours, 1) WHERE status = 'IN_PROGRESS'");
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  const admin = (await q("SELECT u.id, u.name, u.username, u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='ADMINISTRADOR' LIMIT 1"))[0];
  const matriz = (await q("SELECT id FROM accionistas WHERE tipo='MATRIZ' LIMIT 1"))[0].id;
  const token = signToken({ id: admin.id, username: admin.username, name: admin.name, role_id: admin.role_id, role_name: admin.role_name, allowed_modules: null });
  const api = async (method, path, body, acc = matriz, extra = {}) => {
    const r = await fetch(`http://127.0.0.1:${puerto}/api/v1${path}`, {
      method, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-accionista-id": acc, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = null; const txt = await r.text(); try { data = JSON.parse(txt); } catch { data = txt; }
    return { status: r.status, ok: r.ok, data };
  };
  // Descarga binaria (Excel/PDF): devuelve estado, tipo y tamaño.
  const descargar = async (path, acc = matriz) => {
    const t0 = Date.now();
    const r = await fetch(`http://127.0.0.1:${puerto}/api/v1${path}`, { headers: { authorization: `Bearer ${token}`, "x-accionista-id": acc } });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, tipo: r.headers.get("content-type"), bytes: buf.length, ms: Date.now() - t0, texto: r.ok ? "" : buf.toString("utf8").slice(0, 200) };
  };
  const cerrar = async () => { await new Promise((r) => server.close(r)); await c.end(); await pool.end().catch(() => {}); };
  const apiComo = (userId, username, nombre, acc = matriz) => { const tk = signToken({ id: userId, username, name: nombre, role_id: null, role_name: null, allowed_modules: null }); return async (method, path, body) => { const r = await fetch(`http://127.0.0.1:${puerto}/api/v1${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tk}`, "x-accionista-id": acc }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let d = t; try { d = JSON.parse(t); } catch {} return { status: r.status, ok: r.ok, data: d }; }; };
  return { api, apiComo, descargar, q, matriz, admin, cerrar, c };
}

let fallas = 0; const lineas = [];
export const check = (cond, msg, extra) => { const t = `${cond ? "OK  " : "FAIL"} ${msg}${extra !== undefined ? " → " + JSON.stringify(extra) : ""}`; console.log(t); lineas.push(t); if (!cond) fallas++; };
export const resumen = () => { console.log(fallas ? `\n${fallas} FALLO(S)` : "\nTODO OK"); return fallas; };
