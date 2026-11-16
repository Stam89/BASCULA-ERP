// 0️⃣ Fomento con tasa 0.00 % y entrega «sin gasto adm.» (pedido del dueño 2026-11-16): el % se pone en 0 (antes el
// mínimo era 0.1 %) y una entrega de báscula/flete/cosechadora no cobra interés (interés hasta = su propia fecha).
// Agricultor NUEVO solo en la copia. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };

try {
  const hoy = (await q("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text d"))[0].d;
  const hace = async (n) => (await q("SELECT ($1::date - $2::int)::text d", [hoy, n]))[0].d;
  const f = (await q("INSERT INTO farmers (full_name) VALUES ('SIM TASA CERO') RETURNING id, full_name"))[0];
  const fom = exigir(await api("POST", "/fomentos", { farmer_name: f.full_name, farmer_id: f.id, cuadras: 5, inicio: await hace(60), renta: 0.07 }), "0. fomento nuevo al 7 %");
  exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: await hace(60), valor: 1000, concepto: "Entrega simulacro" }), "1. entrega de $1000 hace 60 días");
  const flete = exigir(await api("POST", `/fomentos/${fom.id}/entregas`, { fecha: await hace(60), valor: 50, concepto: "FLETE" }), "2. cargo de FLETE $50");
  check(Boolean(flete.id) && String(flete.fecha ?? "").length >= 10, "3. la entrega creada devuelve su id y fecha (la pantalla los usa)", flete);
  exigir(await api("PATCH", `/fomentos/${fom.id}/entregas/${flete.id}/interes-hasta`, { fecha: String(flete.fecha).slice(0, 10) }), "4. el flete queda sin gasto adm.");
  const detalle = async () => exigir(await api("GET", `/fomentos/${fom.id}`), "detalle");
  const d1 = await detalle();
  const fl = d1.entregas.find((x) => x.id === flete.id);
  check(Math.abs(Number(fl.interes)) < 0.001, "5. el flete no cobra interés", fl.interes);
  check(Math.abs(Number(d1.gasto_adm) - 140) < 0.01, "6. solo la entrega normal cobra (60 días al 7 % = $140)", d1.gasto_adm);

  const cero = exigir(await api("PATCH", `/fomentos/${fom.id}`, { renta: 0 }), "7. poner la tasa en 0.00 %");
  check(Number(cero.renta) === 0, "8. la tasa queda en 0", cero.renta);
  const d2 = await detalle();
  check(Math.abs(Number(d2.gasto_adm)) < 0.001, "9. con 0 % el gasto adm. es $0.00", d2.gasto_adm);
  const neg = await api("PATCH", `/fomentos/${fom.id}`, { renta: -0.01 });
  check(neg.status === 400, "10. no se acepta una tasa negativa", mostrar(neg));
  exigir(await api("PATCH", `/fomentos/${fom.id}`, { renta: 0.05 }), "11. volver a 5 %");
  check(Math.abs(Number((await detalle()).gasto_adm) - 100) < 0.01, "12. con 5 % vuelve a cobrar ($100)");

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
