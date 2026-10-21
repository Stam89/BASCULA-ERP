// 💲 El precio/QQ que se escribe en la app de báscula llega a Liquidaciones como precio sugerido (editable), también si
// se escribe DESPUÉS de ingresar el ticket; no toca pesos ni inventario, y un ticket ya liquidado no cambia
// (pedido del dueño 2026-10-21). SOLO contra la copia.
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
try {
  const { importBasculaTickets } = await import(pathToFileURL(path.join(BACKEND, "dist", "routes", "modules", "mobile-tickets.js")).href);
  // Un ingreso de COMPRA (ya ingresado, sin liquidar) que vino de la báscula
  const e = (await q(`SELECT w.id, w.accionista_id, w.quintals::float qq, w.net_weight::float neto, m.id mid, m.raw_payload p, m.mobile_updated_at
      FROM weighing_tickets w JOIN mobile_synced_tickets m ON m.weighing_ticket_id = w.id
     WHERE w.is_maquila = false AND w.quintals > 0 AND m.liquidated_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM liquidations l WHERE l.weighing_ticket_id = w.id AND l.status <> 'CANCELLED')
     ORDER BY w.created_at DESC LIMIT 1`))[0];
  check(Boolean(e), "0. hay un ingreso de compra pendiente de liquidar en la copia");
  const pend = async () => (await api("GET", "/liquidations/pending-entries", undefined, e.accionista_id)).data.find((x) => x.id === e.id);

  // 1. Sin precio en la báscula: no sugiere nada (se escribe a mano como siempre)
  await q("UPDATE mobile_synced_tickets SET raw_payload = jsonb_set(raw_payload, '{valorPagar}', '\"\"') WHERE id = $1", [e.mid]);
  check((await pend())?.precio_bascula === null, "1. sin precio en la báscula: no sugiere precio", (await pend())?.precio_bascula);

  // 2. La tablet escribe el precio DESPUÉS de ingresar el ticket → llega solo ese dato
  const stockAntes = (await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements"))[0].s;
  const payload = { ...e.p, valorPagar: "41,5", actualizadoEn: Date.now() + 60_000 };
  delete payload.cambioPosterior; delete payload.firebaseNegocioId;
  await importBasculaTickets([payload], "bascula");
  const despues = (await q("SELECT raw_payload, gross_weight::float g, quintals::float qq FROM mobile_synced_tickets WHERE id = $1", [e.mid]))[0];
  check(despues.raw_payload.valorPagar === "41,5", "2. el precio escrito después en la báscula llega al ERP", despues.raw_payload.valorPagar);
  check(!despues.raw_payload.cambioPosterior, "2. no se marca como «cambio de báscula» (los pesos no cambiaron)");
  check((await pend())?.precio_bascula === 41.5, "2. Liquidaciones lo sugiere: $41.50/QQ", (await pend())?.precio_bascula);
  const w = (await q("SELECT quintals::float qq, net_weight::float neto FROM weighing_tickets WHERE id = $1", [e.id]))[0];
  check(w.qq === e.qq && w.neto === e.neto, "2. el ingreso (QQ y peso) no cambia");
  check((await q("SELECT COALESCE(SUM(quantity),0)::float s FROM inventory_movements"))[0].s === stockAntes, "2. el inventario no se mueve");

  // 3. Se liquida con OTRO precio (editable): manda lo escrito, no lo de la báscula
  const r3 = await api("POST", "/liquidations/preview", { farmer_id: (await q("SELECT farmer_id FROM weighing_tickets WHERE id=$1", [e.id]))[0].farmer_id,
    weighing_ticket_id: e.id, quintals: e.qq, price_per_quintal: 43, other_discounts: 0 }, e.accionista_id);
  check(r3.status === 200 && Math.abs(Number(r3.data.gross_amount) - Math.round(e.qq * 43 * 100) / 100) < 0.011, "3. se puede liquidar con otro precio ($43): el bruto usa el escrito", r3.data?.gross_amount ?? r3.data);

  // 4. Un ticket YA liquidado no cambia aunque la báscula mande otro precio
  const liq = (await q(`SELECT m.id, m.raw_payload p FROM mobile_synced_tickets m WHERE m.liquidated_at IS NOT NULL
                          OR EXISTS (SELECT 1 FROM liquidations l WHERE l.weighing_ticket_id = m.weighing_ticket_id AND l.status <> 'CANCELLED') LIMIT 1`))[0];
  if (liq) {
    const antes = liq.p.valorPagar ?? "";
    // Solo los liquidados por ticket (liquidated_at) quedan fuera; los liquidados desde Liquidaciones conservan su precio liquidado aparte
    const p4 = { ...liq.p, valorPagar: "99", actualizadoEn: Date.now() + 120_000 }; delete p4.cambioPosterior; delete p4.firebaseNegocioId;
    await importBasculaTickets([p4], "bascula");
    const ahora = (await q("SELECT raw_payload->>'valorPagar' v, liquidated_at FROM mobile_synced_tickets WHERE id = $1", [liq.id]))[0];
    const liqPrecio = await q("SELECT l.price_per_quintal::float p FROM liquidations l JOIN mobile_synced_tickets m ON m.weighing_ticket_id = l.weighing_ticket_id WHERE m.id = $1 AND l.status <> 'CANCELLED'", [liq.id]);
    check(ahora.v === antes && liqPrecio.every((x) => x.p !== 99), "4. un ticket ya liquidado no cambia (ni el ticket ni su liquidación)", { antes, ahora: ahora.v, liquidaciones: liqPrecio });
  } else check(true, "4. (no hay tickets liquidados en la copia)");
} catch (err) { console.log("ERROR", err?.stack ?? err); check(false, "excepción"); } finally {
  const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0);
}
