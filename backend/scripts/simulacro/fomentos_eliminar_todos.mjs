// 🗑️ Eliminar todos los fomentos para volver a subirlos: pide clave, llave y BORRAR; no borra si algo movió la caja;
// agricultores, caja e inventario se quedan. SOLO copia.
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const LLAVE = process.env.LLAVE_MAESTRA;

try {
  check(!!LLAVE, "0. hay llave maestra para la prueba");
  const respaldos = fs.mkdtempSync(path.join(os.tmpdir(), "sim-fomentos-"));
  process.env.BACKUP_DIR = respaldos;
  const bcrypt = createRequire(import.meta.url)("bcryptjs");
  await q("UPDATE users SET password_hash = $2 WHERE id = $1", [S.admin.id, await bcrypt.hash("clave-simulacro", 4)]);
  const eliminar = (extra = {}) => api("POST", "/settings/eliminar-fomentos", { password: "clave-simulacro", llave_maestra: LLAVE, confirm: "BORRAR", ...extra });
  const cuenta = async (t) => (await q(`SELECT count(*)::int n FROM ${t}`))[0].n;

  const rovinson = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "CEYRO", tipo: "EFECTIVO", opening_balance_cash: 100 }, matriz), "0. caja");
  const fom = exigir(await api("POST", "/fomentos", { farmer_name: "SIM FOMENTO UNO", cuadras: 2, inicio: "2026-10-01" }, matriz), "0. fomento de CEYRO");
  exigir(await api("POST", "/fomentos", { farmer_name: "SIM FOMENTO DOS", cuadras: 2, inicio: "2026-10-01" }, rovinson), "0. fomento de ROVINSON");
  exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: "2026-10-02", valor: 50 }, matriz), "0. entrega sin caja");
  const conCaja = exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: "2026-10-03", valor: 20, cash_register_id: caja.id }, matriz), "0. entrega con caja");

  check((await eliminar({ password: "mala-clave" })).status === 401, "A1. con clave mala no borra");
  check((await eliminar({ llave_maestra: "llave-mala" })).status === 401, "A2. con llave mala no borra");
  check((await eliminar({ confirm: "SI" })).status === 400, "A3. sin BORRAR no borra");

  const bloqueado = await eliminar();
  check(bloqueado.status === 409, "B1. con entregas que movieron la caja no borra", mostrar(bloqueado));
  check(await cuenta("fomentos") >= 2, "B2. y los fomentos siguen ahí");

  const mov = (await q("SELECT id FROM cash_movements WHERE reference_type='fomento_entregas' AND reference_id=$1", [conCaja.id]))[0];
  exigir(await api("POST", `/cash/movements/${mov.id}/reverse`, { reason: "sim" }, matriz), "C1. se anula ese movimiento");

  const agricultores = await cuenta("farmers");
  const movimientos = await cuenta("cash_movements");
  const r = exigir(await eliminar(), "C2. elimina todos");
  check(r.eliminados >= 2 && r.respaldo === true, "C3. dice cuántos y que hubo respaldo", r);
  check(await cuenta("fomentos") === 0 && await cuenta("fomento_entregas") === 0, "C4. no queda ningún fomento ni entrega");
  check(await cuenta("farmers") === agricultores, "C5. los agricultores se quedan");
  check(await cuenta("cash_movements") === movimientos, "C6. la caja no cambia");
  check(fs.readdirSync(respaldos).length > 0, "C7. el respaldo se guardó");
  exigir(await api("POST", "/fomentos", { farmer_name: "SIM FOMENTO UNO", cuadras: 2, inicio: "2026-10-01" }, matriz), "C8. se puede volver a subir");
  fs.rmSync(respaldos, { recursive: true, force: true });
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
