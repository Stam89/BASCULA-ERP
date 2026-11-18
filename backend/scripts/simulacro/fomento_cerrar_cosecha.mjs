// 📦 Cerrar cosecha a mano (pedido del dueño 2026-11-18): congela el gasto adm., archiva el fomento y pasa el saldo a un
// fomento nuevo como «Saldo anterior»; ↩ reabrir lo deshace. Agricultor NUEVO solo en la copia. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

try {
  const hoy = (await q("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text d"))[0].d;
  const hace = async (n) => (await q("SELECT ($1::date - $2::int)::text d", [hoy, n]))[0].d;
  const f = (await q("INSERT INTO farmers (full_name) VALUES ('SIM CERRAR COSECHA') RETURNING id, full_name"))[0];
  const fom = exigir(await api("POST", "/fomentos", { farmer_name: f.full_name, farmer_id: f.id, cuadras: 5, inicio: await hace(30), renta: 0.07 }), "0. fomento nuevo al 7 %");
  exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: await hace(30), valor: 1000, concepto: "Entrega simulacro" }), "1. entrega de $1000 hace 30 días");
  exigir(await api("POST", `/fomentos/${fom.id}/pagos`, { fecha: hoy, valor: 300, concepto: "Abono simulacro" }), "2. abono de $300");
  const det = async (id) => exigir(await api("GET", `/fomentos/${id}`), "detalle");
  const d0 = await det(fom.id);
  check(cerca(d0.deuda_total, 770), "3. debe $1000 + $70 gasto adm. − $300 = $770", d0.deuda_total);

  const r = exigir(await api("POST", `/fomentos/${fom.id}/cerrar-cosecha`, { pasar_saldo: true }), "4. 📦 cerrar la cosecha");
  check(cerca(r.saldo, 770) && r.nuevo_fomento_id, "5. pasa $770 a un fomento nuevo", r);
  const d1 = await det(fom.id);
  check(d1.status === "CERRADO_LIQUIDACION" && d1.liquidado_at, "6. el fomento queda archivado con fecha de cierre", { st: d1.status, l: d1.liquidado_at });
  check(cerca(d1.deuda_total, 0) && cerca(d1.gasto_adm, 70), "7. queda en $0 y el gasto adm. congelado ($70)", { deuda: d1.deuda_total, g: d1.gasto_adm });
  const n = await det(r.nuevo_fomento_id);
  check(n.status === "ACTIVOS" && n.entregas.length === 1 && n.entregas[0].es_saldo_anterior && cerca(n.entregas[0].valor, 770), "8. el nuevo tiene el saldo anterior de $770 (ítem 1)", n.entregas);
  check(cerca(n.deuda_total, 770), "9. el nuevo debe $770 (saldo anterior sin días)", n.deuda_total);
  const otra = await api("POST", `/fomentos/${fom.id}/cerrar-cosecha`, {});
  check(otra.status === 409, "10. no se cierra dos veces", mostrar(otra));
  const caja = (await q("SELECT count(*)::int n FROM cash_movements WHERE reference_type IN ('fomento_pagos','fomento_entregas') AND reference_id IN (SELECT id FROM fomento_pagos WHERE fomento_id = $1 AND concepto LIKE 'Traspaso%')", [fom.id]))[0].n;
  check(caja === 0, "11. el traspaso no mueve la caja", caja);
  const ints = exigir(await api("GET", `/fomentos/intereses?desde=${hoy}&hasta=${hoy}`), "12. reporte de intereses");
  const fila = JSON.stringify(ints).includes(fom.id);
  check(fila, "13. el gasto adm. congelado aparece como interés ganado al cerrar");

  exigir(await api("POST", `/fomentos/${fom.id}/reabrir-cosecha`, {}), "14. ↩ reabrir la cosecha");
  const d2 = await det(fom.id);
  check(d2.status === "ACTIVOS" && !d2.liquidado_at && cerca(d2.deuda_total, 770), "15. vuelve a activo debiendo $770", { st: d2.status, deuda: d2.deuda_total });
  const quedo = (await q("SELECT count(*)::int n FROM fomentos WHERE id = $1", [r.nuevo_fomento_id]))[0].n;
  check(quedo === 0, "16. el fomento nuevo del saldo se quitó", quedo);

  // Con movimientos en la nueva cosecha ya no se reabre.
  const r2 = exigir(await api("POST", `/fomentos/${fom.id}/cerrar-cosecha`, { pasar_saldo: true }), "17. cerrar otra vez");
  exigir(await api("PATCH", `/fomentos/${r2.nuevo_fomento_id}`, { cuadras: 5 }), "17b. la cosecha nueva con sus cuadras");
  exigir(await api("POST", `/fomentos/${r2.nuevo_fomento_id}/entregas`, { fecha: hoy, valor: 100, concepto: "Entrega nueva cosecha" }), "18. entrega en la cosecha nueva");
  const no = await api("POST", `/fomentos/${fom.id}/reabrir-cosecha`, {});
  check(no.status === 409, "19. con entregas en la nueva, no se reabre la anterior", mostrar(no));

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
