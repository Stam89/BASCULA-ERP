// Nombres de cáscara con tilde: el cambio solo afecta el texto; inventario y procesos siguen por código. SOLO copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar } from "./consistencia.mjs";
import fs from "fs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q } = S;
try {
  const antes = await q("SELECT code, COALESCE(SUM(s.quantity),0)::float qq FROM products p LEFT JOIN inventory_stock s ON s.product_id=p.id WHERE p.code LIKE 'CASCARA%' GROUP BY code ORDER BY code");
  await q(fs.readFileSync(new URL("../../../database/migrations/20261111_cascara_con_tilde.sql", import.meta.url), "utf8"));
  await q(fs.readFileSync(new URL("../../../database/migrations/20261111_cascara_con_tilde.sql", import.meta.url), "utf8"));
  const n = await q("SELECT code, name FROM products WHERE code LIKE 'CASCARA%' ORDER BY code");
  check(n[0].name === "Cáscara 0.11" && n[1].name === "Cáscara Corriente", "1. los dos productos quedan con tilde (aplicado dos veces, sin error)", n);
  const despues = await q("SELECT code, COALESCE(SUM(s.quantity),0)::float qq FROM products p LEFT JOIN inventory_stock s ON s.product_id=p.id WHERE p.code LIKE 'CASCARA%' GROUP BY code ORDER BY code");
  check(JSON.stringify(antes) === JSON.stringify(despues), "2. el inventario de cáscara no cambia", despues);
  const inv = await api("GET", "/inventory/products");
  check(inv.ok && JSON.stringify(inv.data).includes("Cáscara 0.11"), "3. el catálogo de productos muestra el nombre nuevo", inv.status);
  const h = (await revisar((sql) => q(sql))).filter((x) => !/báscula cambió/i.test(x.regla));
  check(h.length === 0, "Z. controles de integridad", h.map((x) => x.regla));
} catch (e) { console.log("⛔", e.message); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
