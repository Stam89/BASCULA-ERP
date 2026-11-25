// 📊 Resumen del mes (Inicio): los números del panel tienen que ser los de las tablas. El 2026-11-25 se encontró que las
// ventas se multiplicaban por los productos de cada venta y que lo «seco» se contaba dos veces. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q, matriz } = S;
const r2 = (n) => Math.round(Number(n) * 100) / 100;
try {
  const mes = "2026-11";
  const r = await api("GET", `/dashboard/panel?month=${mes}`, undefined, matriz);
  check(r.ok, "0. responde", r.status);
  const p = r.data;
  const v = await q(`SELECT accionista_id id, sum(total_amount)::float t, count(*)::int n FROM sales WHERE sale_status <> 'CANCELLED' AND created_at::date BETWEEN '2026-11-01' AND '2026-11-30' GROUP BY 1`);
  const vq = await q(`SELECT s.accionista_id id, sum(i.quantity)::float qq FROM sales s JOIN sale_items i ON i.sale_id = s.id WHERE s.sale_status <> 'CANCELLED' AND s.created_at::date BETWEEN '2026-11-01' AND '2026-11-30' GROUP BY 1`);
  const de = (l, id) => l.find((x) => x.id === id);
  check(p.per_accionista.every((a) => r2(a.ventas_total) === r2(de(v, a.id)?.t ?? 0) && a.ventas_cnt === (de(v, a.id)?.n ?? 0)), "1. ventas por socio = ventas reales (sin multiplicar)", p.per_accionista.map((a) => [a.name, a.ventas_total, de(v, a.id)?.t]));
  check(p.per_accionista.every((a) => r2(a.ventas_qq) === r2(de(vq, a.id)?.qq ?? 0)), "2. quintales vendidos = los de los productos");
  check(r2(p.kpis.ventas) === r2(p.per_accionista.reduce((s, a) => s + a.ventas_total, 0)), "3. el total es la suma");
  check(r2(p.serie.find((s) => s.month === mes)?.ventas) === r2(p.kpis.ventas), "4. el gráfico y la tarjeta dicen lo mismo", [p.serie.find((s) => s.month === mes)?.ventas, p.kpis.ventas]);
  const inv = await q(`SELECT m.accionista_id id, sum(m.quantity) FILTER (WHERE p.product_type = 'RAW_MATERIAL')::float casc,
      sum(m.quantity) FILTER (WHERE p.code = 'ARROZ-ENVEJECIDO')::float env, sum(m.quantity) FILTER (WHERE p.code = 'RECHAZO')::float rec
    FROM inventory_movements m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id WHERE m.ownership = 'OWNED' AND w.type <> 'EXTERNO' GROUP BY 1`);
  check(p.per_accionista.every((a) => r2(a.cascara_011 + a.cascara_corriente) === r2(de(inv, a.id)?.casc ?? 0)), "5. cáscara = inventario");
  check(p.per_accionista.every((a) => r2(a.envejecido) === r2(de(inv, a.id)?.env ?? 0) && r2(a.rechazo) === r2(de(inv, a.id)?.rec ?? 0)), "6. envejecido y rechazo también se muestran");
  check(p.per_accionista.every((a) => a.seco_011 + a.seco_corriente <= a.cascara_011 + a.cascara_corriente + 0.01), "7. lo seco es parte de la cáscara (nunca más)", p.per_accionista.map((a) => [a.name, a.seco_011, a.cascara_011]));
  check(p.per_accionista.every((a) => r2(a.inventario_qq) === r2([a.cascara_011, a.cascara_corriente, a.producto_011, a.producto_corriente, a.envejecido, a.arrocillo_34, a.arrocillo_fino, a.polvillo, a.rechazo, a.otros].reduce((s, n) => s + Math.max(0, n), 0))), "8. el total no cuenta lo seco dos veces");
  const cli = (await q(`SELECT COALESCE(sum(d.total_quintals),0)::float s FROM drying_tunnel_reports d JOIN lots l ON l.id = d.lot_id WHERE d.status = 'COMPLETED' AND NOT d.apartado_arianos
      AND COALESCE(l.operation_type, CASE WHEN l.is_maquila THEN 'SECADO_PILADO' ELSE 'COMPRA' END) <> 'COMPRA'
      AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.status <> 'CANCELLED' AND (b.drying_report_id = d.id OR b.id IN (SELECT processing_batch_id FROM processing_batch_drying_lots x WHERE x.drying_report_id = d.id)))`))[0].s;
  check(r2(p.per_accionista.reduce((s, a) => s + a.seco_clientes, 0)) === r2(cli), "9. el arroz de clientes va aparte", cli);
  const af = (await q(`SELECT COALESCE(sum(m.quantity),0)::float s FROM inventory_movements m JOIN warehouses w ON w.id = m.warehouse_id WHERE m.ownership = 'OWNED' AND w.type = 'EXTERNO'`))[0].s;
  check(r2(p.per_accionista.reduce((s, a) => s + a.alla, 0)) === r2(af), "10. lo que está afuera, aparte", af);
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
