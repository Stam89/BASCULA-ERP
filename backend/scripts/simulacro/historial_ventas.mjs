// 📊 Historial de ventas de todos los socios con sacos descontados y cobro de la Matriz por sacos. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const n = Number((await q("SELECT count(*)::int n FROM sales"))[0].n);
  const h = exigir(await api("GET", "/sales/historial", undefined, matriz), "A1. historial con la Matriz activa");
  check(h.length === n, `A2. trae las ${n} ventas de TODOS los socios (no solo la Matriz)`, h.map((v) => `${v.accionista_name} ${v.sale_number}`));
  const socios = new Set(h.map((v) => v.accionista_name));
  console.log("   socios:", [...socios].join(", "));
  for (const v of h) {
    console.log(`   ${v.accionista_name} ${v.sale_number} ${v.customer_name} $${v.total_amount} · líneas: ${v.items.map((l) => `${l.qq} ${l.producto} ${l.presentacion ?? ""}`).join(" + ")} · sacos: ${v.sacos.map((s) => `${s.sacos} ${s.tipo}`).join(", ") || "—"} · cobro sacos: ${v.cargo_sacos ? `$${v.cargo_sacos.monto} ${JSON.stringify(v.cargo_sacos.detalle)}` : "—"}`);
  }
  const conCargo = h.find((v) => v.cargo_sacos);
  if (conCargo) {
    const suma = Object.values(conCargo.cargo_sacos.detalle).reduce((a, d) => a + d.subtotal, 0);
    check(Math.abs(suma - conCargo.cargo_sacos.monto) < 0.01, `A3. el cobro de sacos ${conCargo.cargo_sacos.monto} = suma de su detalle por tramo`, conCargo.cargo_sacos.detalle);
  }
  const f = exigir(await api("GET", "/sales/historial?desde=2099-01-01", undefined, matriz), "A4. filtro de fechas");
  check(f.length === 0, "A5. sin ventas en fechas futuras", f.length);
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
