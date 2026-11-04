// 🧹 Borrado de fábrica (2026-10-25): después de vaciar, Nómina no debe quedar con saldo (guardianías del secador) y
// ninguna tabla de movimientos debe quedar con filas. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import path from "node:path"; import { pathToFileURL, fileURLToPath } from "node:url";
import os from "node:os"; import fs from "node:fs"; import { createRequire } from "node:module";
// El respaldo previo al borrado se guarda en una carpeta temporal: nunca en la de respaldos de verdad.
const RESPALDOS = fs.mkdtempSync(path.join(os.tmpdir(), "sim-respaldo-"));
process.env.BACKUP_DIR = RESPALDOS;
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
  const corte = (await q("SELECT desde::text d, desde_numero n FROM bascula_config WHERE id = 1"))[0];
  const hoyEc = (await q("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text d"))[0].d;
  check(corte?.d === hoyEc && corte?.n === null, "5. «Contar tickets desde» vuelve al día del borrado (los tickets viejos no reaparecen)", corte);
  const arr = (await api("GET", "/saldos-iniciales")).data.corte_arranque;
  const ayer = (await q("SELECT ((now() AT TIME ZONE 'America/Guayaquil')::date - 1)::text d"))[0].d;
  check(arr === ayer, "6. el arranque nuevo es el día anterior al borrado", arr);
  const saldo = await api("POST", "/saldos-iniciales/cxc", { corte: ayer, contraparte_tipo: "CLIENTE", nombre: "SIM ARRANQUE NUEVO", monto: 25 });
  check(saldo.status === 201, "7. acepta saldos iniciales a ese corte, aunque sea a mitad de mes", saldo.status);

  // Por la pantalla: guarda un respaldo ANTES de borrar y, si el respaldo no se puede hacer, no borra.
  const LLAVE = process.env.LLAVE_MAESTRA;
  if (LLAVE) {
    const bcrypt = createRequire(import.meta.url)("bcryptjs");
    await q("UPDATE users SET password_hash = $2 WHERE id = $1", [S.admin.id, await bcrypt.hash("clave-simulacro", 4)]);
    const borrar = () => api("POST", "/settings/reset-transactions", { password: "clave-simulacro", llave_maestra: LLAVE, confirm: "BORRAR" });
    fs.writeFileSync(path.join(RESPALDOS, "es-un-archivo"), "x");
    process.env.BACKUP_DIR = path.join(RESPALDOS, "es-un-archivo", "carpeta");
    const sinRespaldo = await borrar();
    check(!sinRespaldo.ok, "8. sin respaldo no se borra", sinRespaldo.status);
    check((await q("SELECT count(*)::int n FROM saldos_iniciales"))[0].n > 0, "9. y los datos siguen ahí");
    process.env.BACKUP_DIR = RESPALDOS;
    const ok = await borrar();
    check(ok.ok && ok.data.respaldo === true, "10. borrado por la pantalla", ok.status);
    check(fs.readdirSync(RESPALDOS).some((f) => f.endsWith(".dump")), "11. quedó el respaldo", fs.readdirSync(RESPALDOS));
    check((await q("SELECT count(*)::int n FROM saldos_iniciales"))[0].n === 0, "12. y se borró");
  } else check(true, "8. (sin LLAVE_MAESTRA en este equipo no se prueba por la pantalla)");
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); await c.query("ROLLBACK").catch(() => {}); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
