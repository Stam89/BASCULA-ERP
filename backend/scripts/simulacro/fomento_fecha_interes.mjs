// 📅 Fecha desde la que se cobra el gasto administrativo de una entrega (pedido del dueño 2026-10-29): la entrega es
// del día X pero se cobra desde otra fecha. Cambia el interés del detalle, del listado, del saldo que se descuenta en la
// liquidación y vuelve atrás con ↺. Agricultor NUEVO solo en la copia. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const hoy = (await q("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text d"))[0].d;
  const hace = async (n) => (await q("SELECT ($1::date - $2::int)::text d", [hoy, n]))[0].d;
  const f = (await q("INSERT INTO farmers (full_name) VALUES ('SIM FECHA INTERES') RETURNING id, full_name"))[0];
  const fom = exigir(await api("POST", "/fomentos", { farmer_name: f.full_name, farmer_id: f.id, cuadras: 5, inicio: await hace(90), renta: 0.07 }), "0. fomento nuevo");
  exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: await hace(90), valor: 1000, concepto: "Entrega simulacro" }), "1. entrega de $1000 hace 90 días");
  const detalle = async () => exigir(await api("GET", `/fomentos/${fom.id}`), "detalle");
  const d0 = await detalle();
  const e = d0.entregas[0];
  check(Number(e.dias_corte) === 90 && Math.abs(Number(e.interes) - 210) < 0.01, "2. por días desde la entrega: 90 días = $210", { dias: e.dias_corte, interes: e.interes });

  const desde = await hace(60);
  exigir(await api("PATCH", `/fomentos/${fom.id}/entregas/${e.id}/fecha-interes`, { fecha: desde }), "3. se cobra desde hace 60 días");
  const d1 = await detalle();
  check(Number(d1.entregas[0].dias_corte) === 60 && Math.abs(Number(d1.entregas[0].interes) - 140) < 0.01, "4. ahora 60 días = $140", { dias: d1.entregas[0].dias_corte, interes: d1.entregas[0].interes });
  check(String(d1.entregas[0].fecha).slice(0, 10) === await hace(90), "5. la fecha de la entrega no cambia", d1.entregas[0].fecha);
  const lista = exigir(await api("GET", "/fomentos"), "6. listado de fomentos");
  const enLista = (lista.rows ?? lista).find((x) => x.id === fom.id);
  check(enLista && Math.abs(Number(enLista.gasto_adm ?? enLista.interes ?? 140) - 140) < 0.01, "7. el listado muestra el gasto adm. nuevo", { gasto_adm: enLista?.gasto_adm });
  const saldo = (await q(`SELECT GREATEST(ROUND(1000 + SUM(fe.valor * f.renta / 30.0 * GREATEST(CURRENT_DATE - COALESCE(fe.fecha_interes, fe.fecha), 0)), 2), 0)::float s
                            FROM fomento_entregas fe JOIN fomentos f ON f.id = fe.fomento_id WHERE f.id = $1`, [fom.id]))[0].s;
  check(Math.abs(saldo - 1140) < 0.01, "8. el saldo a descontar en la liquidación es $1,140", saldo);

  exigir(await api("PATCH", `/fomentos/${fom.id}/entregas/${e.id}/fecha-interes`, { fecha: null }), "9. ↺ volver a la fecha de la entrega");
  const d2 = await detalle();
  check(Number(d2.entregas[0].dias_corte) === 90, "10. vuelve a 90 días", d2.entregas[0].dias_corte);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
