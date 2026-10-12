// CxC + CxP de la misma persona: cuenta neta y comprobante detallado.
// Corre únicamente contra la copia temporal creada por sim_base.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";

const S = await montar();
const { api, q, matriz } = S;
const migracion = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261090_campo_cuentas_consolidadas.sql");
const exigir = (r, msg) => { check(r.ok, msg, r.data); if (!r.ok) throw new Error(msg); return r.data; };

try {
  await q(fs.readFileSync(migracion, "utf8"));
  const sufijo = Date.now();
  const persona = exigir(await api("POST", "/campo/clientes", { nombre: `SIM CUENTA ${sufijo}`, tipo: "externo" }, matriz), "1. persona temporal creada");
  const activo = (await q("SELECT id FROM campo_activos WHERE activo ORDER BY created_at LIMIT 1"))[0];
  check(Boolean(activo), "2. existe una máquina activa en la copia");
  exigir(await api("POST", "/campo/servicios", {
    fecha: "2026-10-01", cliente_id: persona.id, activo_id: activo.id,
    tipo: "flete", valor: 150, notas: "Flete Guía SIM-001"
  }, matriz), "3. CxC de $150 creada");
  exigir(await api("POST", "/campo/servicios", {
    fecha: "2026-10-02", cliente_id: persona.id, activo_id: activo.id,
    tipo: "cosecha", valor: 25, notas: "Cosecha Parte SIM-002"
  }, matriz), "4. segunda CxC de $25 creada");
  exigir(await api("POST", "/campo/cxp", {
    fecha: "2026-10-03", cliente_id: persona.id, acreedor: persona.nombre,
    concepto: "Reembolso combustible SIM", monto: 90
  }, matriz), "5. CxP vinculada de $90 creada");

  const puenteAntes = Number((await q("SELECT COALESCE(SUM(CASE WHEN m.signo='entrada' THEN m.monto ELSE -m.monto END),0)::float s FROM campo_movimientos m JOIN campo_cuentas c ON c.id=m.cuenta_id WHERE c.nombre='CRUCE PILADORA'"))[0].s);
  const lista = exigir(await api("GET", "/campo/cuentas-consolidadas", undefined, matriz), "6. consulta de cuenta consolidada");
  const cuenta = lista.cuentas.find((x) => x.cliente_id === persona.id);
  check(cuenta?.por_cobrar === 175 && cuenta?.por_pagar === 90 && cuenta?.saldo_neto === 85 && cuenta?.compensable === 90,
    "7. muestra una sola cuenta: $175 CxC - $90 CxP = $85 por cobrar", cuenta);

  const recibo = exigir(await api("POST", `/campo/cuentas-consolidadas/${persona.id}/compensar`, { fecha: "2026-10-04" }, matriz), "8. compensación ejecutada");
  check(recibo.monto === 90 && recibo.cxc.length === 1 && recibo.cxp.length === 1 && recibo.saldo_neto === 85,
    "9. comprobante conserva el detalle de ambos lados", recibo);
  const cuentaDesp = (exigir(await api("GET", "/campo/cuentas-consolidadas", undefined, matriz), "10. cuenta recalculada").cuentas).find((x) => x.cliente_id === persona.id);
  check(cuentaDesp?.por_cobrar === 85 && cuentaDesp?.por_pagar === 0 && cuentaDesp?.saldo_neto === 85,
    "11. queda únicamente el saldo neto real de $85", cuentaDesp);
  const puenteDesp = Number((await q("SELECT COALESCE(SUM(CASE WHEN m.signo='entrada' THEN m.monto ELSE -m.monto END),0)::float s FROM campo_movimientos m JOIN campo_cuentas c ON c.id=m.cuenta_id WHERE c.nombre='CRUCE PILADORA'"))[0].s);
  check(puenteDesp === puenteAntes, "12. la compensación no movió Caja ni alteró el saldo de la cuenta puente", { puenteAntes, puenteDesp });
  const reimpreso = exigir(await api("GET", `/campo/cuentas-consolidadas/comprobantes/${recibo.id}`, undefined, matriz), "13. comprobante recuperable para reimpresión");
  check(reimpreso.cxc[0]?.detalle === "Flete Guía SIM-001" && reimpreso.cxp[0]?.detalle === "Reembolso combustible SIM",
    "14. el recibo reimpreso explica de qué eran las deudas", reimpreso);
} catch (e) {
  console.log("⛔", e.message);
} finally {
  const fallas = resumen(); await S.cerrar(); process.exit(fallas ? 1 : 0);
}
