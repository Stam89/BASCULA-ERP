// Consistencia ENTRE módulos: reglas que siempre deben cumplirse si todo está bien conectado.
// Uso: como módulo (revisar(q) → lista de hallazgos) o por consola contra la base real, SOLO LECTURA:
//   node scripts/simulacro/consistencia.mjs
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Las reglas viven en el servidor (src/services/consistencia.ts → dist): una sola fuente de verdad.
// IMPORTANTE: se cargan de forma PEREZOSA (al revisar), NUNCA al importar este archivo. Importar `dist` antes de que el
// simulacro apunte a su copia deja a la app conectada a la base REAL (ya ocurrió una vez): por eso `sim_base.mjs` además aborta.
let _reglas = null;
async function reglas() {
  if (!_reglas) {
    const { REGLAS_CONSISTENCIA } = await import(pathToFileURL(path.join(BACKEND, "dist", "services", "consistencia.js")).href);
    _reglas = REGLAS_CONSISTENCIA.map((r) => [r.nombre, r.sql]);
  }
  return _reglas;
}

/** Cuántas reglas hay: se completa en la primera revisión (los simulacros lo leen después de revisar). */
export let TOTAL_REGLAS = 0;

/** Corre todas las reglas con la función q(sql) → filas. Devuelve [{regla, filas, error?}] solo de las que fallan. */
export async function revisar(q) {
  const lista = await reglas();
  TOTAL_REGLAS = lista.length;
  const hallazgos = [];
  for (const [nombre, sql] of lista) {
    try {
      const filas = await q(sql);
      if (filas.length) hallazgos.push({ regla: nombre, filas: filas.slice(0, 5), total: filas.length });
    } catch (e) {
      hallazgos.push({ regla: nombre, error: e.message.split("\n")[0] });
    }
  }
  return hallazgos;
}

// ── Uso por consola: base REAL, solo lectura ──
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const require = createRequire(path.join(BACKEND, "package.json"));
  const pg = require("pg"); require("dotenv").config({ path: path.join(BACKEND, ".env") });
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  await c.query("SET default_transaction_read_only = on");
  const h = await revisar(async (sql) => (await c.query(sql)).rows);
  console.log(`Reglas revisadas: ${TOTAL_REGLAS}`);
  if (!h.length) console.log("✅ Todo consistente");
  for (const x of h) console.log(x.error ? `⚠️  ${x.regla}: ${x.error}` : `❌ ${x.regla} (${x.total}) → ${JSON.stringify(x.filas)}`);
  await c.end();
  process.exit(h.some((x) => !x.error) ? 1 : 0);
}
