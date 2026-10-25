// 🧹 Borrado de fábrica (2026-10-25): después de vaciar, Nómina no debe quedar con saldo (guardianías del secador) y
// ninguna tabla de movimientos debe quedar con filas. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import path from "node:path"; import { pathToFileURL, fileURLToPath } from "node:url";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, c } = S;
try {
  const DIST = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist")).href;
  const { vaciarDatosDePrueba, WIPE_TABLES } = await import(`${DIST}/services/datos-prueba.js`);
  const matriz = S.matriz;
  await q("INSERT INTO secador_guardias (accionista_id, work_date, worker_name) VALUES ($1, CURRENT_DATE - 3, 'SIM GUARDIA') ON CONFLICT DO NOTHING", [matriz]).catch((e) => console.log("guardia:", e.message));
  await c.query("BEGIN"); const r = await vaciarDatosDePrueba(c); await c.query("COMMIT");
  check(r.notFound.length === 0, "1. todas las tablas de la lista existen", r.notFound);
  const conFilas = [];
  for (const t of WIPE_TABLES) { const n = (await q(`SELECT count(*)::int n FROM "${t}"`))[0].n; if (n) conFilas.push(`${t}:${n}`); }
  check(conFilas.length === 0, "2. ninguna tabla de movimientos quedó con filas", conFilas);
  for (const p of ["/labor/summary", "/labor/payments", "/labor/secador-guardia"]) await api("GET", p);
  const pend = (await q("SELECT count(*)::int n, COALESCE(sum(net_amount),0)::float s FROM worker_payments WHERE status='PENDING'"))[0];
  check(pend.n === 0, "3. Nómina sin saldo pendiente después del borrado", pend);
  const users = (await q("SELECT count(*)::int n FROM users"))[0].n, prods = (await q("SELECT count(*)::int n FROM products"))[0].n;
  check(users > 0 && prods > 0, "4. se conservan usuarios y productos", { users, prods });
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); await c.query("ROLLBACK").catch(() => {}); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
