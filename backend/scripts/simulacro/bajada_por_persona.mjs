// 🚚 Bajada de carro POR PERSONA en «Pagar la semana» (pedido del dueño 2026-11-19): si a alguien no se le paga su
// bajada, queda pendiente y sale en la semana siguiente; a los demás sí se les paga. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const caja = exigir(await api("POST", "/cash/registers/open", { name: "Caja CEYRO sim", tipo: "EFECTIVO", opening_balance_cash: 2000 }, matriz), "0. caja de CEYRO");
  // Usa las bajadas pendientes que ya tiene la copia (cada una nace de un ticket de báscula).
  const hasta = "2026-11-20";
  const v = exigir(await api("GET", `/nomina-semanal/vista?hasta=${hasta}`, undefined, matriz), "1. lista del viernes 20/11");
  const baj = v.personas.filter((p) => p.grupo === "bajada" && p.neto > 0);
  check(baj.length >= 2, "2. hay al menos dos personas con bajada pendiente", baj.map((p) => p.nombre));
  const [uno, dos] = baj;
  check(uno.clave !== dos.clave && uno.clave.startsWith("bajada|"), "3. cada persona de bajada tiene su propia casilla", [uno.clave, dos.clave]);
  const nombre = (p) => p.nombre;
  const ids = async (n) => (await q("SELECT id, paid_at IS NOT NULL pagado FROM cuadrilla_entries WHERE origen='BASCULA' AND worker_name=$1 AND (paid_at IS NULL OR paid_at > now() - interval '1 minute') AND work_date <= $2::date", [n, hasta]));
  // Solo se paga a «dos»: todos los demás quedan fuera.
  const excluir = v.personas.filter((p) => p !== dos).map((p) => p.clave);
  const r = exigir(await api("POST", "/nomina-semanal/pagar", { hasta, cash_register_id: caja.id, confirmar_neto: dos.neto, excluir }, matriz), `4. pagar solo a ${nombre(dos)} (${dos.neto})`);
  check(r2(r.totales.neto) === r2(dos.neto), "5. se pagó solo su monto", r.totales);
  const eUno = await ids(uno.nombre), eDos = await ids(dos.nombre);
  check(eUno.length > 0 && eUno.every((x) => !x.pagado) && eDos.every((x) => x.pagado), "6. el desmarcado sigue pendiente; el marcado quedó pagado", { eUno, eDos });
  const mov = await q("SELECT amount::float a, description FROM cash_movements WHERE cash_register_id=$1 AND description LIKE 'Pago bajada%'", [caja.id]);
  check(mov.length === 1 && r2(mov[0].a) === r2(dos.neto) && !mov[0].description.includes(uno.nombre + " $"), "7. el egreso es solo del marcado", mov);
  const v2 = exigir(await api("GET", `/nomina-semanal/vista?hasta=2026-11-27`, undefined, matriz), "8. lista de la semana siguiente (27/11)");
  const sigue = v2.personas.find((p) => p.grupo === "bajada" && p.nombre === uno.nombre);
  check(sigue && sigue.neto >= uno.neto - 0.001, "9. la bajada pendiente aparece en la semana siguiente", sigue);
  // Compatibilidad: «bajada» a secas deja fuera toda la bajada.
  const todos = v2.personas.filter((p) => p.grupo !== "bajada").map((p) => p.clave);
  const nada = await api("POST", "/nomina-semanal/pagar", { hasta: "2026-11-27", cash_register_id: caja.id, confirmar_neto: 0, excluir: [...todos, "bajada"] }, matriz);
  check(nada.status === 400, "10. «bajada» a secas sigue dejando fuera toda la bajada", mostrar(nada));

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
