// 💲 Venta Detalle por QQ: descuento en DÓLARES por defecto y por cliente ($1, $2…).
// 🌾 Saldos iniciales: producto que empieza en NEGATIVO (arroz tomado de un servicio de pilada). SOLO contra la copia.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 260)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const CORTE = "2026-09-30";
const migracion = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/migrations/20261092_descuento_qq_cliente.sql");

try {
  await q(fs.readFileSync(migracion, "utf8"));
  await q(fs.readFileSync(migracion, "utf8")); // idempotente: dos veces no falla
  // ── A. Descuento por QQ ──
  const cfg = exigir(await api("GET", "/products/venta-detalle-config", undefined, matriz), "A1. se lee el descuento por QQ por defecto");
  check(cfg.descuento_qq_defecto === 1, "A2. arranca en $1.00 (ya no un centavo)", cfg);
  const put = exigir(await api("PUT", "/products/venta-detalle-config", { descuento_qq_defecto: 1.5 }, matriz), "A3. se cambia a $1.50");
  check(put.descuento_qq_defecto === 1.5, "A4. … guardado", put);
  const neg = await api("PUT", "/products/venta-detalle-config", { descuento_qq_defecto: -1 }, matriz);
  check(neg.status === 400, "A5. un descuento negativo se rechaza (400)", neg.status);
  const cli = exigir(await api("POST", "/customers", { full_name: "SIM CLIENTE DESCUENTO" }, matriz), "A6. cliente nuevo");
  const d2 = exigir(await api("PATCH", `/customers/${cli.id}/descuento-qq`, { descuento_qq: 2 }, matriz), "A7. el cliente tiene $2 de descuento por QQ");
  check(d2.descuento_qq === 2, "A8. … guardado", d2);
  const lista = exigir(await api("GET", "/customers", undefined, matriz), "A9. la lista de clientes");
  check(lista.find((c) => c.id === cli.id)?.descuento_qq === 2, "A10. … trae su descuento (Caja lo aplica al elegirlo)");
  const otro = lista.find((c) => c.id !== cli.id);
  check(!otro || otro.descuento_qq === null, "A11. un cliente sin configurar viene con null (usa el por defecto)", otro?.descuento_qq);
  const quitar = exigir(await api("PATCH", `/customers/${cli.id}/descuento-qq`, { descuento_qq: null }, matriz), "A12. Quitar su descuento");
  check(quitar.descuento_qq === null, "A13. … vuelve a usar el por defecto", quitar);
  await api("PUT", "/products/venta-detalle-config", { descuento_qq_defecto: 1 }, matriz);

  // ── B. Saldo inicial de producto en NEGATIVO ──
  const p011 = (await q("SELECT id FROM products WHERE code = 'ARROZ-PILADO-011'"))[0];
  const cascara = (await q("SELECT id FROM products WHERE product_type = 'RAW_MATERIAL' AND is_active LIMIT 1"))[0];
  const stock = async () => Number((await q("SELECT COALESCE(sum(quantity),0)::float s FROM inventory_movements WHERE product_id = $1 AND accionista_id = $2 AND ownership = 'OWNED'", [p011.id, matriz]))[0].s);
  const s0 = await stock();
  const sinDetalle = await api("POST", "/saldos-iniciales/inventario", { corte: CORTE, product_id: p011.id, cantidad: -5 }, matriz);
  check(sinDetalle.status === 400, "B1. en negativo SIN detalle se rechaza (hay que decir por qué)", mostrar(sinDetalle));
  const casNeg = await api("POST", "/saldos-iniciales/inventario", { corte: CORTE, product_id: cascara.id, cantidad: -5, detalle: "prueba" }, matriz);
  check(casNeg.status === 400, "B2. la cáscara NO puede empezar en negativo (es un lote físico)", mostrar(casNeg));
  const cero = await api("POST", "/saldos-iniciales/inventario", { corte: CORTE, product_id: p011.id, cantidad: 0, detalle: "x" }, matriz);
  check(cero.status === 400, "B3. cantidad 0 se rechaza", cero.status);
  const si = exigir(await api("POST", "/saldos-iniciales/inventario", { corte: CORTE, product_id: p011.id, cantidad: -5, detalle: "arroz del pilado de Juan usado en el pedido 123" }, matriz), "B4. Producto 0.11 empieza en −5 QQ con su motivo");
  check(Math.abs((await stock()) - (s0 - 5)) < 0.001, "B5. el inventario baja 5 QQ", { antes: s0, ahora: await stock() });
  const fila = (await q("SELECT cantidad::float c, detalle FROM saldos_iniciales WHERE id = $1", [si.id]))[0];
  check(fila.c === -5 && /pilado de Juan/.test(fila.detalle), "B6. el saldo inicial queda en −5 con su detalle", fila);
  const pos = exigir(await api("POST", "/saldos-iniciales/inventario", { corte: CORTE, product_id: p011.id, cantidad: 3 }, matriz), "B7. un saldo positivo sigue igual que siempre");
  check(Math.abs((await stock()) - (s0 - 2)) < 0.001, "B8. … el inventario sube 3 QQ");
  exigir(await api("POST", `/saldos-iniciales/${si.id}/anular`, { motivo: "prueba" }, matriz), "B9. se anula el saldo negativo");
  check(Math.abs((await stock()) - (s0 + 3)) < 0.001, "B10. … el inventario recupera los 5 QQ", { ahora: await stock(), esperado: s0 + 3 });
  exigir(await api("POST", `/saldos-iniciales/${pos.id}/anular`, { motivo: "prueba" }, matriz), "B11. se anula el positivo");
  check(Math.abs((await stock()) - s0) < 0.001, "B12. el inventario queda como al inicio");

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
