// 📍 Saldo inicial de arroz pilado con presentación y «Allá» (pedido del dueño 2026-10-29): se carga producto en
// bultos de arroba y queda en «Allá: <proveedor>» de selección/envejecimiento; la cáscara no puede quedar allá.
// SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia", liberarTuneles: false });
const { api, q } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
try {
  const acc = (await q("SELECT id FROM accionistas WHERE tipo = 'SOCIO' ORDER BY code LIMIT 1"))[0].id;
  const cp = exigir(await api("GET", "/saldos-iniciales/contrapartes", undefined, acc), "0. contrapartes");
  check(Array.isArray(cp.externos) && cp.externos.length > 0 && Array.isArray(cp.presentaciones), "1. trae los proveedores de selección/envejecimiento y las presentaciones", { externos: cp.externos?.length });
  const prov = cp.externos[0];
  const prod = (await q("SELECT id FROM products WHERE code = 'ARROZ-PILADO-011'"))[0].id;
  const casc = (await q("SELECT id FROM products WHERE code = 'CASCARA-011'"))[0].id;
  const r = exigir(await api("POST", "/saldos-iniciales/inventario", { corte: "2026-10-14", product_id: prod, cantidad: 25, external_provider_id: prov.id, detalle: "100 bultos de 25 lb (@ arroba)" }, acc), "2. cargar 25 QQ (100 @) que están allá");
  check(String(r.bodega).startsWith("Allá:"), "3. queda en la bodega «Allá» del proveedor", r.bodega);
  const alla = (await q(`SELECT COALESCE(SUM(m.quantity),0)::float s FROM inventory_movements m JOIN warehouses w ON w.id = m.warehouse_id
                          WHERE w.external_provider_id = $1 AND m.product_id = $2 AND m.accionista_id = $3 AND m.reference_type = 'saldo_inicial'`, [prov.id, prod, acc]))[0].s;
  check(Math.abs(alla - 25) < 0.01, "4. el inventario allá suma 25 QQ", alla);
  const u = exigir(await api("GET", "/selection/ubicacion", undefined, acc), "5. Selección › ubicación");
  const fila = (u.productos ?? u).find?.((x) => x.product_id === prod);
  check(!fila || (fila.alla_total ?? 0) >= 25 - 0.01, "6. Selección lo muestra «allá»", fila);
  const mal = await api("POST", "/saldos-iniciales/inventario", { corte: "2026-10-14", product_id: casc, cantidad: 5, external_provider_id: prov.id }, acc);
  check(mal.status === 400, "7. la cáscara no puede quedar «allá»", mostrar(mal));
  const h = (await revisar(q)).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. integridad sin hallazgos", h.map((x) => x.regla + " " + JSON.stringify(x.filas ?? x.error).slice(0, 250)));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); check(false, "excepción"); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
