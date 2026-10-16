// Registra un LOTE de operaciones por la API (las mismas validaciones, espejos y cruces que la pantalla). Sirve para
// pasar al sistema la caja manual de un día (cuadre de caja durante la adaptación).
//   Prueba en la COPIA:  node --env-file=… scripts/operaciones_lote.mjs <lote.json>
//   Registro REAL:       node --env-file=… scripts/operaciones_lote.mjs <lote.json> --real
// lote.json = { "pasos": [ { "id", "como": "CEYRO", "metodo", "ruta", "cuerpo", "confirmar": ["SOBREGIRO"] } | { "id", "sql", "params" } ],
//               "verificar": [ { "texto", "sql", "params", "espera": {campo: valor} } ] }
// En textos se puede usar {{acc.CEYRO}} (id del socio), {{caja.CEYRO}} (su caja abierta) y {{paso.campo}} (resultado
// de un paso anterior). En modo real la app corre en este proceso (127.0.0.1:4003) con una clave propia del proceso.
// Se detiene en el primer paso que falle (lo anterior ya quedó registrado: cada paso es su propia operación).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
const [archivo, modo] = process.argv.slice(2);
const REAL = modo === "--real";
const lote = JSON.parse(fs.readFileSync(archivo, "utf8"));
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function montarReal() {
  const require = createRequire(path.join(BACKEND, "package.json"));
  const pg = require("pg");
  require("dotenv").config({ path: path.join(BACKEND, ".env") });
  process.env.JWT_SECRET = "lote-" + crypto.randomUUID(); // solo vale dentro de este proceso
  const DIST = pathToFileURL(path.join(BACKEND, "dist")).href;
  const { app } = await import(`${DIST}/app.js`);
  const { signToken } = await import(`${DIST}/auth/jwt.js`);
  const { pool } = await import(`${DIST}/db/pool.js`);
  const server = await new Promise((res) => { const s = app.listen(4003, "127.0.0.1", () => res(s)); });
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  const admin = (await q("SELECT u.id, u.name, u.username, u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='ADMINISTRADOR' AND u.is_active LIMIT 1"))[0];
  const token = signToken({ id: admin.id, username: admin.username, name: admin.name, role_id: admin.role_id, role_name: admin.role_name, allowed_modules: null });
  const api = async (method, p, body, acc, extra = {}) => {
    const r = await fetch(`http://127.0.0.1:4003/api/v1${p}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-accionista-id": acc, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let data = t; try { data = JSON.parse(t); } catch { /* texto */ }
    return { status: r.status, ok: r.ok, data };
  };
  const cerrar = async () => { await new Promise((r) => server.close(r)); await c.end(); await pool.end().catch(() => {}); };
  return { api, q, cerrar, db: (await q("SELECT current_database() d"))[0].d };
}

const S = REAL ? await montarReal() : await (await import("./simulacro/sim_base.mjs")).montar({ copiar: true, cerrarCajas: false });
const { api, q } = S;
console.log(REAL ? `### REGISTRO REAL en «${S.db}»` : "### PRUEBA EN LA COPIA");
let fallas = 0;
try {
  const ctx = { acc: {}, caja: {} };
  for (const a of await q("SELECT id, name FROM accionistas")) ctx.acc[a.name.toUpperCase()] = a.id;
  for (const r of await q("SELECT r.id, a.name FROM cash_registers r JOIN accionistas a ON a.id = r.accionista_id WHERE r.status = 'OPEN'")) ctx.caja[r.name.toUpperCase()] = r.id;
  const valor = (ruta) => ruta.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
  const poner = (x) => {
    if (typeof x === "string") {
      const solo = x.match(/^\{\{([^}]+)\}\}$/);
      if (solo) { const v = valor(solo[1].trim()); if (v === undefined) throw new Error(`No hay valor para ${solo[1]}`); return v; }
      return x.replace(/\{\{([^}]+)\}\}/g, (_, k) => { const v = valor(k.trim()); if (v === undefined) throw new Error(`No hay valor para ${k}`); return String(v); });
    }
    if (Array.isArray(x)) return x.map(poner);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, poner(v)]));
    return x;
  };
  for (const p of lote.pasos) {
    if (p.sql) {
      const rows = await q(p.sql, poner(p.params ?? []));
      if (!rows[0]) { console.log(`FAIL ${p.id}: la consulta no devolvió nada`); fallas++; break; }
      ctx[p.id] = rows[0];
      console.log(`OK   ${p.id}: ${JSON.stringify(rows[0]).slice(0, 160)}`);
      continue;
    }
    const acc = ctx.acc[String(p.como).toUpperCase()];
    const extra = p.confirmar?.length ? { "X-Confirmar": p.confirmar.join(","), ...(p.confirmar.includes("SOBREGIRO") ? { "X-Confirmar-Sobregiro": "1" } : {}) } : {};
    const r = await api(p.metodo, poner(p.ruta), p.cuerpo === undefined ? undefined : poner(p.cuerpo), acc, extra);
    if (!r.ok) { console.log(`FAIL ${p.id} (${p.texto ?? ""}) → ${r.status} ${typeof r.data === "string" ? r.data.slice(0, 300) : JSON.stringify(r.data).slice(0, 300)}`); fallas++; break; }
    ctx[p.id] = r.data;
    console.log(`OK   ${p.id}: ${p.texto ?? ""}`);
  }
  if (!fallas) {
    for (const v of lote.verificar ?? []) {
      const row = (await q(v.sql, poner(v.params ?? [])))[0] ?? {};
      const ok = Object.entries(v.espera ?? {}).every(([k, e]) => Math.abs(Number(row[k]) - Number(e)) < 0.01);
      console.log(`${ok ? "OK  " : "FAIL"} ✔ ${v.texto} → ${JSON.stringify(row)}`);
      if (!ok) fallas++;
    }
  }
} catch (e) { console.log("⛔", e.message); fallas++; } finally {
  console.log(fallas ? `\n${fallas} FALLO(S)` : "\nTODO OK"); await S.cerrar(); process.exit(fallas ? 1 : 0);
}
