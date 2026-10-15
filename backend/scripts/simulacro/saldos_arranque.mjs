// 🚀 Saldos iniciales al ARRANQUE (14/10/2026): se aceptan esa fecha y los fines de mes; otra fecha no. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, matriz } = S;
try {
  const g = await api("GET", "/saldos-iniciales", undefined, matriz);
  check(g.ok && g.data.corte_arranque === "2026-10-14", "A1. el sistema ofrece el corte de arranque 14/10/2026", g.data?.corte_arranque);
  const ok = await api("POST", "/saldos-iniciales/cxc", { corte: "2026-10-14", contraparte_tipo: "CLIENTE", nombre: "SIM CLIENTE ARRANQUE", monto: 100 }, matriz);
  check(ok.status === 201, "A2. Por cobrar al 14/10/2026 se acepta", ok.status);
  const fm = await api("POST", "/saldos-iniciales/cxp", { corte: "2026-09-30", contraparte_tipo: "PROVEEDOR", nombre: "SIM PROV FIN MES", monto: 50 }, matriz);
  check(fm.status === 201, "A3. fin de mes (30/09) se sigue aceptando", fm.status);
  const mal = await api("POST", "/saldos-iniciales/cxc", { corte: "2026-10-13", contraparte_tipo: "CLIENTE", nombre: "SIM X", monto: 10 }, matriz);
  check(mal.status === 400, "A4. otra fecha (13/10) se rechaza", mal.status);
  const fut = await api("POST", "/saldos-iniciales/cxc", { corte: "2026-10-31", contraparte_tipo: "CLIENTE", nombre: "SIM X", monto: 10 }, matriz);
  check(fut.status === 400, "A5. un fin de mes futuro (31/10) todavía no", fut.status);
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
