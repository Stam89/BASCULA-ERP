// 🚚 Cola de despachos: en la MATRIZ (bodega) se ven los pedidos pendientes de todos; en un socio, solo los suyos
// (pedido del dueño 2026-10-21). SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
try {
  const accs = await q("SELECT id, name, tipo FROM accionistas");
  const pend = await q("SELECT accionista_id, count(*)::int n FROM sales_orders WHERE status='PENDING' GROUP BY 1");
  const total = pend.reduce((s, p) => s + p.n, 0);
  for (const a of accs) {
    const r = await api("GET", "/orders/cola-global", undefined, a.id);
    const ajenos = r.data.filter((o) => o.accionista_id !== a.id).length;
    if (a.tipo === "MATRIZ") check(r.data.length === total, `${a.name} (Matriz/bodega) ve TODOS los pendientes`, { ve: r.data.length, total });
    else check(ajenos === 0 && r.data.length === (pend.find((p) => p.accionista_id === a.id)?.n ?? 0), `${a.name} solo ve SUS pedidos`, { ve: r.data.length, ajenos });
  }
} finally {
  const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0);
}
