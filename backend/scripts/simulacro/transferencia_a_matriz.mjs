// 🏦 «Llegó a la Matriz» (pedido del dueño 2026-11-09): un pedido de un socio despachado con transferencia, pero el cliente
// le depositó a la Matriz. En un paso: el cliente deja de deber, el dinero entra a la caja de la Matriz y la Matriz le
// queda debiendo al socio. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false, cerrarCajas: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const socio = (await q(`SELECT a.id, a.name FROM accionistas a
                           WHERE a.tipo <> 'MATRIZ' AND a.is_active
                             AND EXISTS (SELECT 1 FROM inventory_stock s JOIN products p ON p.id = s.product_id JOIN warehouses w ON w.id = s.warehouse_id
                                          WHERE s.accionista_id = a.id AND p.code = 'ARROCILLO-34' AND w.type = 'FINISHED_GOODS' AND s.ownership = 'OWNED'
                                          GROUP BY s.accionista_id HAVING SUM(s.quantity) > 3)
                           ORDER BY (SELECT COALESCE(SUM(s2.quantity), 0) FROM inventory_stock s2 WHERE s2.accionista_id = a.id AND s2.ownership = 'OWNED') DESC LIMIT 1`))[0];
  if (!socio) throw new Error("la copia no tiene un socio con arrocillo 3/4 en la piladora");
  const cajaM = (await q("SELECT id FROM cash_registers WHERE accionista_id = $1 AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1", [S.matriz]))[0];
  if (!cajaM) throw new Error("la Matriz no tiene caja abierta en la copia");
  const W = (await q("SELECT id FROM warehouses WHERE type = 'FINISHED_GOODS' LIMIT 1"))[0].id;
  const P = Object.fromEntries((await q("SELECT code, id FROM products")).map((x) => [x.code, x.id]));
  const flor = P["ARROCILLO-34"];
  const cli = exigir(await api("POST", "/customers", { full_name: "CLIENTE SIM TRANSFERENCIA" }, socio.id), "1. cliente");
  const o = exigir(await api("POST", "/orders", { customer_id: cli.id, payment_method: "TRANSFER",
    items: [{ product_id: flor, presentation_name: "100lb", inventory_product_id: P["ARROCILLO-34"], quantity: 2, unit_price: 45 }] }, socio.id), "2. pedido del socio");
  exigir(await api("PATCH", `/orders/${o.id}/prepare`, { prepared: true, warehouse_id: W }, socio.id), "3. preparar");
  exigir(await api("POST", `/orders/${o.id}/deliver`, { payment_method: "TRANSFER", warehouse_id: W }, socio.id), "4. despachar con transferencia");
  const lista = exigir(await api("GET", "/receivable/por-confirmar", undefined, socio.id), "5. transferencias por confirmar");
  const t = lista.find((x) => x.order_number === o.order_number);
  check(!!t && t.monto === 90, "6. el pedido está por confirmar por $90", t);

  const saldoM = async () => Number((await q(`SELECT COALESCE(SUM(CASE WHEN movement = 'INCOME' THEN amount ELSE -amount END), 0) s
                                               FROM cash_movements WHERE cash_register_id = $1 AND reversed_at IS NULL AND reversal_of IS NULL`, [cajaM.id]))[0].s);
  const antes = await saldoM();
  const enMatriz = await api("POST", `/receivable/${t.id}/llego-a-matriz`, {}, S.matriz);
  check(!enMatriz.ok, "7. desde la Matriz no se puede (la cuenta es del socio)", mostrar(enMatriz));
  exigir(await api("POST", `/receivable/${t.id}/llego-a-matriz`, {}, socio.id), "8. «Llegó a la Matriz»");

  const ar = (await q("SELECT balance::float b, por_confirmar, description FROM accounts_receivable WHERE id = $1", [t.id]))[0];
  check(ar.b === 0 && ar.por_confirmar === null && /llegó a la Matriz/.test(ar.description), "9. el cliente ya no debe y la cuenta dice que llegó a la Matriz", ar);
  const despues = await saldoM();
  check(Math.round((despues - antes) * 100) / 100 === 90, "10. entraron $90 a la caja de la Matriz", { antes, despues });
  const mov = (await q("SELECT category, medio FROM cash_movements WHERE cash_register_id = $1 ORDER BY created_at DESC LIMIT 1", [cajaM.id]))[0];
  const tipoM = (await q("SELECT tipo FROM cash_registers WHERE id = $1", [cajaM.id]))[0].tipo;
  check(tipoM !== "MIXTO" || mov?.medio === "BANCO", "11. en una caja mixta entra por el banco (no a la gaveta)", { tipoM, mov });
  const deuda = (await q(`SELECT (SELECT SUM(balance)::float FROM accounts_receivable WHERE accionista_id = $1 AND reference_type = 'cobro_por_socio' AND created_at > now() - interval '5 minutes') cxc,
                                 (SELECT SUM(balance)::float FROM accounts_payable WHERE accionista_id = $2 AND reference_type = 'cobro_por_socio' AND created_at > now() - interval '5 minutes') cxp`,
    [socio.id, S.matriz]))[0];
  check(deuda.cxc === 90 && deuda.cxp === 90, `12. la Matriz le debe $90 a ${socio.name} (CxC del socio ↔ CxP de la Matriz)`, deuda);
  const lista2 = exigir(await api("GET", "/receivable/por-confirmar", undefined, socio.id), "13. lista después");
  check(!lista2.some((x) => x.id === t.id), "14. ya no aparece por confirmar");
  const otra = await api("POST", `/receivable/${t.id}/llego-a-matriz`, {}, socio.id);
  check(otra.status === 404, "15. repetirlo no hace nada", mostrar(otra));

  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
