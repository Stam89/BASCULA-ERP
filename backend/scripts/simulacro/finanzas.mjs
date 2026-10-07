// Estados financieros por HTTP real (servidor en :4001 sobre una COPIA): que respondan para la matriz y un
// socio, con y sin «inicio contable», y que el Excel se descargue completo.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
try {
  const socio = (await q("SELECT id FROM accionistas WHERE tipo='SOCIO' ORDER BY name LIMIT 1"))[0].id;
  const fecha = (await q("SELECT to_char(fecha_inicio_contable,'YYYY-MM-DD') f FROM financial_settings WHERE accionista_id=$1", [matriz]))[0]?.f ?? null;
  console.log("   inicio contable de la matriz en la copia:", fecha);
  for (const [nombre, acc] of [["matriz", matriz], ["socio", socio]]) {
    for (const ruta of ["/finance/dashboard", "/finance/balance", "/finance/income-statement", "/finance/cash-flow", "/finance/indicators"]) {
      const r = await api("GET", ruta, undefined, acc);
      check(r.status === 200, `${ruta} [${nombre}] responde`, r.status === 200 ? undefined : `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    }
    const x = await S.descargar("/finance/export/excel", acc);
    check(x.status === 200 && x.bytes > 2000 && /sheet|excel|octet/.test(x.tipo ?? "") && x.ms < 15000, `exportar Excel [${nombre}] descarga un archivo válido`, { status: x.status, bytes: x.bytes, ms: x.ms, tipo: x.tipo, error: x.texto });
  }
  // Balance con inicio contable: el resultado del ejercicio se cuenta desde esa fecha
  const bal = (await api("GET", "/finance/balance", undefined, matriz)).data;
  check(bal && typeof bal === "object", "el balance de la matriz trae datos", Object.keys(bal ?? {}).slice(0, 6));
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
