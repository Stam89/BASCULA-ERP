// 📅 Fecha HASTA la que se cobra el gasto administrativo de una entrega (pedido del dueño 2026-10-29): la entrega es
// del 29/07 y se le cobra hasta el 28/08; después ya no sube. Cambia el interés del detalle, del listado y del saldo
// que se descuenta en la liquidación; vacío (↺) vuelve a «hasta hoy». Agricultor NUEVO solo en la copia. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const hoy = (await q("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text d"))[0].d;
  const hace = async (n) => (await q("SELECT ($1::date - $2::int)::text d", [hoy, n]))[0].d;
  const f = (await q("INSERT INTO farmers (full_name) VALUES ('SIM FECHA INTERES') RETURNING id, full_name"))[0];
  const fom = exigir(await api("POST", "/fomentos", { farmer_name: f.full_name, farmer_id: f.id, cuadras: 5, inicio: await hace(90), renta: 0.07 }), "0. fomento nuevo");
  exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: await hace(90), valor: 1000, concepto: "Entrega simulacro" }), "1. entrega de $1000 hace 90 días");
  const detalle = async () => exigir(await api("GET", `/fomentos/${fom.id}`), "detalle");
  const e = (await detalle()).entregas[0];
  check(Number(e.dias_corte) === 90 && Math.abs(Number(e.interes) - 210) < 0.01, "2. por días hasta hoy: 90 días = $210", { dias: e.dias_corte, interes: e.interes });

  // Como el ejemplo del dueño: se cobra un mes (30 días) desde la entrega.
  const hasta = await hace(60);
  exigir(await api("PATCH", `/fomentos/${fom.id}/entregas/${e.id}/interes-hasta`, { fecha: hasta }), "3. se cobra hasta 30 días después de la entrega");
  const d1 = await detalle();
  check(Number(d1.entregas[0].dias_corte) === 30 && Math.abs(Number(d1.entregas[0].interes) - 70) < 0.01, "4. ahora 30 días = $70 (ya no sube)", { dias: d1.entregas[0].dias_corte, interes: d1.entregas[0].interes });
  check(String(d1.entregas[0].fecha).slice(0, 10) === await hace(90), "5. la fecha de la entrega no cambia", d1.entregas[0].fecha);
  const lista = exigir(await api("GET", "/fomentos"), "6. listado de fomentos");
  const enLista = (lista.rows ?? lista).find((x) => x.id === fom.id);
  check(enLista && Math.abs(Number(enLista.gasto_adm) - 70) < 0.01, "7. el listado muestra el gasto adm. nuevo", { gasto_adm: enLista?.gasto_adm });
  const antes = await api("PATCH", `/fomentos/${fom.id}/entregas/${e.id}/interes-hasta`, { fecha: await hace(100) });
  check(antes.status === 400, "8. no se acepta una fecha antes de la entrega", mostrar(antes));

  exigir(await api("PATCH", `/fomentos/${fom.id}/entregas/${e.id}/interes-hasta`, { fecha: null }), "9. ↺ volver a «hasta hoy»");
  const d2 = await detalle();
  check(Number(d2.entregas[0].dias_corte) === 90, "10. vuelve a 90 días", d2.entregas[0].dias_corte);

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
