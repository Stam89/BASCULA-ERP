// Carga el formulario de PUESTA EN MARCHA de una operación (saldos al corte de arranque 14/10/2026) por la API
// de Saldos iniciales (mismas validaciones y espejos entre socios que la pantalla).
//   Prueba en la COPIA:  node --env-file=… scripts/cargar_formulario_arranque.mjs <datos.json> <ACCIONISTA>
//   Carga REAL:          node --env-file=… scripts/cargar_formulario_arranque.mjs <datos.json> <ACCIONISTA> --real
//   Corrección:          … <correccion.json> <ACCIONISTA> [--real] --correccion   (anula y vuelve a cargar filas sueltas)
// En modo real la app corre en este proceso (127.0.0.1:4002) con una clave de sesión propia de este proceso
// (no sirve en el servidor real). Se niega si esa operación ya tiene saldos iniciales vigentes.
// datos.json: { cxc:[{tipo,nombre,monto,fecha,vence,detalle}], cxp:[…], inv:[{producto,qq,costo,detalle,alla?}], ant:[{nombre,monto,fecha,detalle}] }
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
const [archivo, quien, ...flags] = process.argv.slice(2);
const REAL = flags.includes("--real");
// --correccion: la operación ya tiene saldos; se anulan los de `anular` ({producto, qq}) y se agrega lo demás.
const CORRECCION = flags.includes("--correccion");
const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
const CORTE = "2026-10-14";
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function montarReal() {
  const require = createRequire(path.join(BACKEND, "package.json"));
  const pg = require("pg");
  require("dotenv").config({ path: path.join(BACKEND, ".env") });
  process.env.JWT_SECRET = "carga-" + crypto.randomUUID(); // solo vale dentro de este proceso
  process.env.PORT = "4002";
  const DIST = pathToFileURL(path.join(BACKEND, "dist")).href;
  const { app } = await import(`${DIST}/app.js`);
  const { signToken } = await import(`${DIST}/auth/jwt.js`);
  const { pool } = await import(`${DIST}/db/pool.js`);
  const server = await new Promise((res) => { const s = app.listen(4002, "127.0.0.1", () => res(s)); });
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  const admin = (await q("SELECT u.id, u.name, u.username, u.role_id, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='ADMINISTRADOR' AND u.is_active LIMIT 1"))[0];
  const token = signToken({ id: admin.id, username: admin.username, name: admin.name, role_id: admin.role_id, role_name: admin.role_name, allowed_modules: null });
  const api = async (method, p, body, acc) => {
    const r = await fetch(`http://127.0.0.1:4002/api/v1${p}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-accionista-id": acc }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let data = t; try { data = JSON.parse(t); } catch { /* texto */ }
    return { status: r.status, ok: r.ok, data };
  };
  const cerrar = async () => { await new Promise((r) => server.close(r)); await c.end(); await pool.end().catch(() => {}); };
  return { api, q, cerrar, db: (await q("SELECT current_database() d"))[0].d };
}

let fallas = 0;
const check = (ok, msg, extra) => { console.log(`${ok ? "OK  " : "FAIL"} ${msg}${extra !== undefined ? " → " + JSON.stringify(extra) : ""}`); if (!ok) fallas++; };
const S = REAL ? await montarReal() : await (await import("./simulacro/sim_base.mjs")).montar({ copiar: true });
const { api, q } = S;
console.log(REAL ? `### CARGA REAL en «${S.db}»` : "### PRUEBA EN LA COPIA");
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 240)}`;
try {
  const acc = (await q("SELECT id FROM accionistas WHERE name=$1", [quien]))[0]?.id;
  if (!acc) throw new Error(`No existe la operación ${quien}`);
  const ya = (await q("SELECT count(*)::int n FROM saldos_iniciales WHERE accionista_id=$1 AND anulado_at IS NULL", [acc]))[0].n;
  if (ya > 0 && !CORRECCION) throw new Error(`${quien} ya tiene ${ya} saldos iniciales vigentes: no se carga dos veces.`);
  if (CORRECCION && !ya) throw new Error(`${quien} no tiene saldos iniciales que corregir.`);
  for (const a of datos.anular ?? []) {
    const si = await q(`SELECT s.id FROM saldos_iniciales s JOIN products p ON p.id = s.product_id
                         WHERE s.accionista_id=$1 AND s.tipo='INVENTARIO' AND s.anulado_at IS NULL AND p.name=$2 AND abs(s.cantidad - $3) < 0.005`, [acc, a.producto, a.qq]);
    if (si.length !== 1) { check(false, `ANULAR ${a.producto} ${a.qq} QQ: se encontraron ${si.length}`); continue; }
    const r = await api("POST", `/saldos-iniciales/${si[0].id}/anular`, { motivo: a.motivo ?? "Corrección del formulario de arranque" }, acc);
    check(r.ok, `ANULAR ${a.producto} ${a.qq} QQ`, r.ok ? undefined : mostrar(r));
  }
  const socios = Object.fromEntries((await q("SELECT name, id FROM accionistas")).map((a) => [a.name.toUpperCase(), a.id]));
  const productos = Object.fromEntries((await q("SELECT name, id FROM products")).map((p) => [p.name, p.id]));
  // Bodega «Allá: <proveedor>» (igual que la crea Selección la primera vez).
  const bodegaAlla = async (prov) => {
    const p = (await q("SELECT id, name FROM external_providers WHERE lower(name)=lower($1)", [prov]))[0];
    if (!p) throw new Error(`No existe el proveedor externo ${prov}`);
    return (await q(`INSERT INTO warehouses (name, type, is_active, external_provider_id) VALUES ($1, 'EXTERNO', true, $2)
                     ON CONFLICT (external_provider_id) WHERE external_provider_id IS NOT NULL DO UPDATE SET is_active = true RETURNING id`, [`Allá: ${p.name}`, p.id]))[0].id;
  };
  const TIPO = { Cliente: "CLIENTE", Agricultor: "AGRICULTOR", Proveedor: "PROVEEDOR", Socio: "SOCIO" };
  const tot = { cxc: 0, cxp: 0, inv: 0, ant: 0 };
  for (const lado of ["cxc", "cxp"]) {
    for (const f of (datos[lado] ?? [])) {
      const tipo = TIPO[f.tipo];
      const body = { corte: CORTE, contraparte_tipo: tipo, monto: f.monto, fecha_deuda: f.fecha ?? undefined, vencimiento: f.vence ?? undefined, detalle: f.detalle || undefined };
      if (tipo === "SOCIO") body.contraparte_id = socios[f.nombre.toUpperCase()]; else body.nombre = f.nombre;
      const r = await api("POST", `/saldos-iniciales/${lado}`, body, acc);
      check(r.ok, `${lado.toUpperCase()} fila ${f.fila}: ${f.tipo} ${f.nombre} $${f.monto}`, r.ok ? undefined : mostrar(r));
      if (r.ok) tot[lado] += f.monto;
    }
  }
  for (const f of (datos.inv ?? [])) {
    const pid = productos[f.producto];
    const wid = f.alla ? await bodegaAlla(f.alla) : undefined;
    const r = pid
      ? await api("POST", "/saldos-iniciales/inventario", { corte: CORTE, product_id: pid, cantidad: f.qq, costo_unitario: f.costo ?? undefined, warehouse_id: wid, detalle: f.detalle || undefined }, acc)
      : { ok: false, status: 0, data: "producto no existe" };
    check(r.ok, `INVENTARIO fila ${f.fila}: ${f.producto} ${f.qq} QQ (${f.detalle})${r.ok ? ` → ${r.data.bodega}${r.data.lote ? " · lote " + r.data.lote : ""}` : ""}`, r.ok ? undefined : mostrar(r));
    if (r.ok) tot.inv += f.qq;
  }
  for (const f of (datos.ant ?? [])) {
    const r = await api("POST", "/saldos-iniciales/anticipos", { corte: CORTE, nombre: f.nombre, monto: f.monto, fecha_deuda: f.fecha ?? undefined, detalle: f.detalle || undefined }, acc);
    check(r.ok, `ANTICIPO fila ${f.fila}: ${f.nombre} $${f.monto}`, r.ok ? undefined : mostrar(r));
    if (r.ok) tot.ant += f.monto;
  }
  console.log("TOTALES", JSON.stringify(Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, Math.round(v * 100) / 100]))));
} catch (e) { console.log("⛔", e.message); fallas++; } finally {
  console.log(fallas ? `\n${fallas} FALLO(S)` : "\nTODO OK"); await S.cerrar(); process.exit(fallas ? 1 : 0);
}
