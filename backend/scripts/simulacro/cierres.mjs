// 📸 «Cerrar mes»: foto de los estados de cada socio, que no cambia aunque después se corrija algo; anular y volver a cerrar;
// avisos de integridad; permisos; Excel del cierre. SOLO contra la copia (sim_base aborta si no).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, apiComo, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  if (!(await q("SELECT to_regclass('public.cierres_mes') AS t"))[0].t) {
    await q(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261084_cierres_mes.sql"), "utf8"));
    console.log("   (info) migración 20261084 aplicada en la COPIA");
  }
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
  const [A, M] = hoy.split("-").map(Number);
  const prev = M === 1 ? { anio: A - 1, mes: 12 } : { anio: A, mes: M - 1 };
  const prev2 = prev.mes === 1 ? { anio: prev.anio - 1, mes: 12 } : { anio: prev.anio, mes: prev.mes - 1 };
  const finPrev = new Date(Date.UTC(prev.anio, prev.mes, 0)).toISOString().slice(0, 10);
  const nAcc = Number((await q("SELECT count(*)::int n FROM accionistas WHERE is_active"))[0].n);

  // ── A. Cerrar ──
  const fin = new Date(Date.UTC(A, M, 0)).toISOString().slice(0, 10);
  if (fin > hoy) check((await api("POST", "/finance/cierres", { anio: A, mes: M })).status === 409, "A1. el mes en curso todavía no se puede cerrar → 409");
  const r1 = exigir(await api("POST", "/finance/cierres", { anio: prev.anio, mes: prev.mes, notas: "ensayo" }), `A2. cerrar ${prev.mes}/${prev.anio}`);
  check(r1.cierres.length === nAcc, `A3. se guarda la foto de los ${nAcc} socios`, r1.cierres.map((c) => c.accionista));
  check((await api("POST", "/finance/cierres", { anio: prev.anio, mes: prev.mes })).status === 409, "A4. cerrar el mismo mes dos veces → 409");
  const lista = exigir(await api("GET", "/finance/cierres"), "A5. lista de cierres");
  const delMes = lista.filter((c) => c.anio === prev.anio && c.mes === prev.mes && !c.anulado_at);
  check(delMes.length === nAcc && delMes.every((c) => c.kpis && typeof c.kpis.total_activos === "number"), "A6. cada socio con sus cifras clave");
  const cM = delMes.find((c) => c.accionista_id === matriz);
  const det = exigir(await api("GET", `/finance/cierres/${cM.id}`), "A7. detalle del cierre de la Matriz");
  check(det.datos.dashboard.balance && det.datos.dashboard.resultados && Array.isArray(det.datos.por_cobrar) && Array.isArray(det.datos.inventario) && det.datos.resultado_mensual,
    "A8. guarda balance, resultados, Por Cobrar, inventario y el Resultado mensual de la Matriz");
  const ex = await S.descargar(`/finance/cierres/${cM.id}/excel`);
  check(ex.status === 200 && ex.bytes > 3000, "A9. el Excel del cierre se descarga", { status: ex.status, bytes: ex.bytes });

  // ── B. Lo cerrado no cambia ──
  const prod = (await q("SELECT id FROM products WHERE code='ARROZ-PILADO-011'"))[0].id;
  const bod = (await q("SELECT id FROM warehouses WHERE type='FINISHED_GOODS' ORDER BY name LIMIT 1"))[0].id;
  await q(`INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, reference_type, ownership, accionista_id, created_at)
           VALUES ($1,$2,'IN',50,'simulacro','OWNED',$3, ($4::date + interval '12 hours'))`, [prod, bod, matriz, `${prev.anio}-${String(prev.mes).padStart(2, "0")}-15`]);
  const vivo = exigir(await api("GET", `/finance/balance?hasta=${finPrev}`), "B1. balance en vivo al corte");
  const foto = (await api("GET", `/finance/cierres/${cM.id}`)).data.datos.dashboard.balance;
  const invVivo = vivo.activo.corriente.inventario_detalle, invFoto = foto.activo.corriente.inventario_detalle;
  check(JSON.stringify(foto) === JSON.stringify(det.datos.dashboard.balance), "B2. un movimiento registrado después dentro del mes NO cambia la foto guardada",
    { qq_extra: 50, inventario_vivo: invVivo.total, inventario_cierre: invFoto.total });

  // ── C. Permisos ──
  const rol = (await q("SELECT id FROM roles WHERE name='OPERADOR'"))[0].id;
  const u = (await q("INSERT INTO users (name, username, password_hash, role_id, is_active) VALUES ('sim_ef','sim_ef','x',$1,true) RETURNING id", [rol]))[0].id;
  await q("INSERT INTO user_accionistas (user_id, accionista_id, allowed_modules) VALUES ($1,$2,$3)", [u, matriz, ["Estados Financieros", "EDIT:Estados Financieros"]]);
  const oper = apiComo(u, "sim_ef", "sim_ef", matriz);
  const suyos = (await oper("GET", "/finance/cierres")).data;
  check(Array.isArray(suyos) && suyos.length > 0 && suyos.every((c) => c.accionista_id === matriz), "C1. un operador con Estados Financieros ve solo los cierres de su accionista");
  const otro = delMes.find((c) => c.accionista_id !== matriz);
  if (otro) check((await oper("GET", `/finance/cierres/${otro.id}`)).status === 403, "C2. y no puede abrir el cierre de otro socio → 403");
  check((await oper("POST", "/finance/cierres", { anio: prev2.anio, mes: prev2.mes })).status === 403, "C3. cerrar un mes es solo del administrador → 403");
  check((await oper("POST", `/finance/cierres/${prev.anio}/${prev.mes}/anular`, { motivo: "prueba de permiso" })).status === 403, "C4. anular un cierre es solo del administrador → 403");

  // ── D. Anular y volver a cerrar ──
  check((await api("POST", `/finance/cierres/${prev.anio}/${prev.mes}/anular`, { motivo: "no" })).status === 400, "D1. anular sin motivo → 400");
  exigir(await api("POST", `/finance/cierres/${prev.anio}/${prev.mes}/anular`, { motivo: "faltaba registrar un ingreso" }), "D2. anular el cierre");
  exigir(await api("POST", "/finance/cierres", { anio: prev.anio, mes: prev.mes }), "D3. volver a cerrar el mes corregido");
  const l2 = (await api("GET", "/finance/cierres")).data.filter((c) => c.anio === prev.anio && c.mes === prev.mes);
  check(l2.filter((c) => c.anulado_at).length === nAcc && l2.filter((c) => !c.anulado_at).length === nAcc, "D4. la foto anulada se conserva (marcada) y hay una nueva vigente");
  const nuevo = l2.find((c) => !c.anulado_at && c.accionista_id === matriz);
  const fotoNueva = (await api("GET", `/finance/cierres/${nuevo.id}`)).data.datos.dashboard.balance.activo.corriente.inventario_detalle;
  check(Math.abs(fotoNueva.total - invVivo.total) < 0.01, "D5. la nueva foto ya incluye la corrección", { antes: invFoto.total, ahora: fotoNueva.total });

  // ── E. Avisos de integridad ──
  const ar = (await q("INSERT INTO accounts_receivable (accionista_id, reference_type, description, amount, balance, status) VALUES ($1,'sim','sim descuadre',10,15,'CONFIRMED') RETURNING id", [matriz]))[0].id;
  const conAviso = await api("POST", "/finance/cierres", { anio: prev2.anio, mes: prev2.mes });
  check(conAviso.status === 409 && /integridad/i.test(conAviso.data?.error ?? ""), "E1. con un problema de integridad, avisa antes de cerrar (409)", mostrar(conAviso));
  const forzado = exigir(await api("POST", "/finance/cierres", { anio: prev2.anio, mes: prev2.mes, confirmar_hallazgos: true }), "E2. confirmando, cierra igual");
  const l3 = (await api("GET", "/finance/cierres")).data.find((c) => c.anio === prev2.anio && c.mes === prev2.mes && !c.anulado_at);
  check(l3?.integridad?.avisos?.length > 0, "E3. el cierre queda marcado con los avisos que tenía", l3?.integridad);
  void forzado;
  await q("DELETE FROM accounts_receivable WHERE id=$1", [ar]);
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
