// 📦 «Lotes guardados» también para la cáscara seca del saldo inicial (pedido del dueño 2026-10-29): los lotes SI-…
// aparecen en Reportes › Lotes guardados, se guardan con ubicación (salen de Producción › Desde Stock), se actualiza
// la ubicación y se devuelven a proceso. Usa los lotes reales de la copia. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const lote = (await q("SELECT id, lot_code, accionista_id FROM lots WHERE saldo_inicial AND status = 'WEIGHED' ORDER BY lot_code LIMIT 1"))[0];
  if (!lote) throw new Error("la copia no tiene lotes de saldo inicial");
  const acc = lote.accionista_id;
  const ver = async () => exigir(await api("GET", "/reports/arianos", undefined, acc), "lista");
  const stock = async () => exigir(await api("GET", "/lots/dry-in-storage", undefined, acc), "stock").some((l) => l.id === lote.id);
  const a0 = await ver();
  check(a0.pendientes.some((r) => r.id === lote.id && r.saldo_inicial && Number(r.quintals) > 0), `1. ${lote.lot_code} aparece en «Arroz seco sin procesar»`);
  check(await stock(), "2. y está en Producción › Desde Stock");
  exigir(await api("POST", "/reports/arianos/apartar", { ids: [lote.id], apartar: true, ubicacion: "Bodega 2 fondo" }, acc), "3. guardarlo con ubicación");
  const a1 = await ver();
  check(a1.apartados.some((r) => r.id === lote.id && r.ubicacion_arianos === "Bodega 2 fondo"), "4. pasa a «Lotes guardados» con su ubicación");
  check(!(await stock()), "5. sale de Producción › Desde Stock");
  exigir(await api("POST", "/reports/arianos/ubicacion", { id: lote.id, ubicacion: "Galpón" }, acc), "6. cambiar la ubicación");
  check((await ver()).apartados.some((r) => r.id === lote.id && r.ubicacion_arianos === "Galpón"), "7. ubicación actualizada");
  exigir(await api("POST", "/reports/arianos/apartar", { ids: [lote.id], apartar: false }, acc), "8. devolver a proceso");
  check(await stock(), "9. vuelve a Producción › Desde Stock");
  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
