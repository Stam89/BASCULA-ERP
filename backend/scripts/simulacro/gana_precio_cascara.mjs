// 🏆 Gana: precio de compra de la cáscara a mano mientras la partida no está liquidada (pedido del dueño 2026-11-24). No toca
// liquidaciones, cuentas ni inventario; con la liquidación hecha vale el precio liquidado. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const b = (await q(`SELECT b.id, l.accionista_id acc FROM processing_batches b JOIN lots l ON l.id = b.lot_id JOIN processing_batch_drying_lots d ON d.processing_batch_id = b.id
                       WHERE b.finished_at IS NOT NULL AND b.status <> 'CANCELLED' GROUP BY 1, 2
                      HAVING count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM liquidations x WHERE x.weighing_ticket_id = d.weighing_ticket_id AND x.status <> 'CANCELLED')) > 1
                         AND count(*) FILTER (WHERE EXISTS (SELECT 1 FROM liquidations x WHERE x.weighing_ticket_id = d.weighing_ticket_id AND x.status <> 'CANCELLED')) > 0 LIMIT 1`))[0];
  if (!b) throw new Error("la copia no tiene una pilada con partidas liquidadas y sin liquidar");
  const huella = async () => (await q(`SELECT (SELECT count(*) FROM liquidations)::int l, (SELECT COALESCE(sum(balance),0) FROM accounts_payable)::float p, (SELECT count(*) FROM inventory_movements)::int i,
                                              (SELECT count(*) FROM cash_movements)::int c`))[0];
  const antes = await huella();
  const lote = async () => exigir(await api("GET", "/processing-batches/history", undefined, b.acc), "historial").find((x) => x.id === b.id);
  const poner = (body, acc = b.acc) => api("PATCH", `/processing-batches/${b.id}/precio-cascara`, body, acc);
  const e0 = (await lote()).entradas;
  const libres = e0.filter((p) => p.price_per_quintal == null), liq = e0.filter((p) => p.price_per_quintal != null);
  exigir(await poner({ partida_id: libres[0].id, precio: 33.5 }), "1. precio a mano en una partida sin liquidar");
  const e1 = (await lote()).entradas;
  check(Number(e1.find((p) => p.id === libres[0].id).precio_manual) === 33.5 && e1.filter((p) => p.precio_manual != null).length === 1, "2. queda solo en esa");
  check((await poner({ partida_id: liq[0].id, precio: 1 })).status === 409, "3. en una ya liquidada no deja");
  const todas = exigir(await poner({ precio: 32 }), "4. el mismo precio para las que faltan");
  check(todas.partidas.length === libres.length - 1 && !todas.partidas.includes(libres[0].id), "5. solo las que no tenían precio", todas.partidas.length);
  const e2 = (await lote()).entradas;
  check(e2.filter((p) => Number(p.precio_manual) === 32).length === libres.length - 1 && Number(e2.find((p) => p.id === libres[0].id).precio_manual) === 33.5 && e2.filter((p) => p.price_per_quintal != null).every((p) => p.precio_manual == null), "6. ni las liquidadas ni lo ya escrito se tocan");
  exigir(await poner({ partida_id: libres[0].id, precio: null }), "7. borrar el de una");
  check((await lote()).entradas.find((p) => p.id === libres[0].id).precio_manual == null, "8. vuelve a pendiente");
  check((await poner({ partida_id: libres[0].id, precio: -1 })).status === 400, "9. negativo no");
  const otro = (await q("SELECT id FROM accionistas WHERE id <> $1 LIMIT 1", [b.acc]))[0].id;
  check((await poner({ precio: 5 }, otro)).status === 403, "10. otro socio no puede");
  const solo = (await q(`SELECT b.id, l.accionista_id acc FROM processing_batches b JOIN lots l ON l.id = b.lot_id WHERE b.finished_at IS NOT NULL AND b.status <> 'CANCELLED'
                          AND NOT EXISTS (SELECT 1 FROM processing_batch_drying_lots d WHERE d.processing_batch_id = b.id) LIMIT 1`))[0];
  if (solo) {
    exigir(await api("PATCH", `/processing-batches/${solo.id}/precio-cascara`, { precio: 30 }, solo.acc), "11. pilada sin partidas: un precio para todo");
    const h = exigir(await api("GET", "/processing-batches/history", undefined, solo.acc), "historial").find((x) => x.id === solo.id);
    check(Number(h.precio_cascara_manual) === 30, "12. queda guardado");
  }
  const despues = await huella();
  check(JSON.stringify(antes) === JSON.stringify(despues), "13. no movió liquidaciones, cuentas, inventario ni caja", despues);
  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
