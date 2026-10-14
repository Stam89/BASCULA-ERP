// ⇄ CRUCE DE CUENTAS ENTRE LA MATRIZ Y UN SOCIO: lo que el socio le debe a la Matriz se compensa con lo que la
// Matriz le debe al socio, SIN caja, bajando por igual las dos caras de cada deuda. SOLO contra la copia.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const migracion = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261098_cruce_cuentas_socios.sql");
const CORTE = "2026-09-30";

try {
  await q(fs.readFileSync(migracion, "utf8"));
  await q(fs.readFileSync(migracion, "utf8"));
  const stalyn = (await q("SELECT id FROM accionistas WHERE name='STALYN'"))[0].id;
  const rovinson = (await q("SELECT id FROM accionistas WHERE name='ROVINSON'"))[0].id;
  const caja = async (acc) => Number((await q(
    `SELECT COALESCE(sum(CASE WHEN movement='INCOME' THEN amount ELSE -amount END) FILTER (WHERE reversed_at IS NULL),0)::float s
       FROM cash_movements m JOIN cash_registers r ON r.id = m.cash_register_id WHERE r.accionista_id = $1`, [acc]))[0].s);
  const res0 = exigir(await api("GET", `/receivable/cruce-socios/resumen?contraparte_id=${stalyn}`, undefined, matriz), "0. resumen inicial con STALYN");

  // Deudas cruzadas (saldos iniciales entre socios: cada uno nace con su espejo en el otro).
  const cxc = exigir(await api("POST", "/saldos-iniciales/cxc", { corte: CORTE, contraparte_tipo: "SOCIO", contraparte_id: stalyn, monto: 300, detalle: "sim: STALYN le debe a la Matriz" }, matriz), "A1. STALYN le debe $300 a la Matriz");
  const cxp = exigir(await api("POST", "/saldos-iniciales/cxp", { corte: CORTE, contraparte_tipo: "SOCIO", contraparte_id: stalyn, monto: 150, detalle: "sim: la Matriz le debe a STALYN" }, matriz), "A2. la Matriz le debe $150 a STALYN");
  void cxc; void cxp;
  const res = exigir(await api("GET", `/receivable/cruce-socios/resumen?contraparte_id=${stalyn}`, undefined, matriz), "A3. resumen");
  check(Math.abs(res.total_me_debe - res0.total_me_debe - 300) < 0.01 && Math.abs(res.total_le_debo - res0.total_le_debo - 150) < 0.01,
    "A4. me debe +$300 y le debo +$150", { me: res.total_me_debe, le: res.total_le_debo });
  check(Math.abs(res.maximo - Math.min(res.total_me_debe, res.total_le_debo)) < 0.01, "A5. se puede cruzar lo menor de los dos", res.maximo);
  const espejo = exigir(await api("GET", `/receivable/cruce-socios/resumen?contraparte_id=${matriz}`, undefined, stalyn), "A6. el mismo resumen visto por STALYN");
  check(Math.abs(espejo.total_me_debe - res.total_le_debo) < 0.01 && Math.abs(espejo.total_le_debo - res.total_me_debe) < 0.01, "A7. … al revés (lo que yo debo, él lo cobra)", espejo);

  // ── B. Cruce parcial ──
  const c0m = await caja(matriz), c0s = await caja(stalyn);
  const demas = await api("POST", "/receivable/cruce-socios", { contraparte_id: stalyn, monto: res.maximo + 1 }, matriz);
  check(demas.status === 409, "B1. no deja cruzar más que el máximo", mostrar(demas));
  const conRov = await api("POST", "/receivable/cruce-socios", { contraparte_id: rovinson }, matriz);
  const resRov = exigir(await api("GET", `/receivable/cruce-socios/resumen?contraparte_id=${rovinson}`, undefined, matriz), "B2. resumen con ROVINSON");
  check(resRov.maximo > 0.005 ? conRov.ok : conRov.status === 409, "B3. con quien no hay deudas cruzadas, no se cruza nada (409)", mostrar(conRov));
  const cr = exigir(await api("POST", "/receivable/cruce-socios", { contraparte_id: stalyn, monto: 100, nota: "sim cruce" }, matriz), "B4. se cruzan $100");
  const res2 = exigir(await api("GET", `/receivable/cruce-socios/resumen?contraparte_id=${stalyn}`, undefined, matriz), "B5. resumen después");
  check(Math.abs(res2.total_me_debe - (res.total_me_debe - 100)) < 0.01 && Math.abs(res2.total_le_debo - (res.total_le_debo - 100)) < 0.01,
    "B6. los dos lados bajan $100", { me: res2.total_me_debe, le: res2.total_le_debo });
  check(Math.abs((await caja(matriz)) - c0m) < 0.01 && Math.abs((await caja(stalyn)) - c0s) < 0.01, "B7. sin movimiento de caja en ninguno");
  const notif = (await q("SELECT titulo FROM notificaciones WHERE accionista_id = $1 AND referencia_id = $2", [stalyn, cr.id]));
  check(notif.length === 1 && /cruzó cuentas/.test(notif[0].titulo), "B8. STALYN recibe el aviso", notif);
  const lista = exigir(await api("GET", "/receivable/cruce-socios", undefined, stalyn), "B9. STALYN ve el cruce en su lista");
  check(lista.some((x) => x.id === cr.id && x.hecho_por_mi === false && x.monto === 100), "B10. … con el monto y quién lo hizo", lista[0]);

  // ── C. Integridad a mitad (espejos con el mismo saldo) ──
  const h1 = await revisar((sql) => q(sql));
  check(h1.length === 0, "C1. tras el cruce los espejos siguen cuadrando", h1.map((x) => x.regla));

  // ── D. Anular ──
  exigir(await api("POST", `/receivable/cruce-socios/${cr.id}/anular`, { motivo: "prueba" }, matriz), "D1. se anula el cruce");
  const res3 = exigir(await api("GET", `/receivable/cruce-socios/resumen?contraparte_id=${stalyn}`, undefined, matriz), "D2. resumen");
  check(Math.abs(res3.total_me_debe - res.total_me_debe) < 0.01 && Math.abs(res3.total_le_debo - res.total_le_debo) < 0.01, "D3. las deudas vuelven a como estaban", res3);
  const otra = await api("POST", `/receivable/cruce-socios/${cr.id}/anular`, { motivo: "prueba" }, matriz);
  check(otra.status === 409, "D4. no se anula dos veces", otra.status);

  // ── E. Cruce total (sin monto = el máximo) ──
  const tot = exigir(await api("POST", "/receivable/cruce-socios", { contraparte_id: stalyn }, matriz), "E1. cruce del máximo");
  check(Math.abs(tot.monto - res.maximo) < 0.01 && tot.le_debo_queda < 0.01, "E2. la Matriz queda sin deberle a STALYN y STALYN debe la diferencia", tot);

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
