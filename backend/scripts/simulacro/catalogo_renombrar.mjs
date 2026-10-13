// 🧺📦 Catálogo de productos y sacos: corregir el NOMBRE (producto + sus sacos, enlaces por id intactos) y
// eliminar el último saco de una marca la DESACTIVA (deja de salir en Ventas y selectores). SOLO contra la copia.
import { montar, check, resumen } from "./sim_base.mjs";
import { revisar, TOTAL_REGLAS } from "./consistencia.mjs";
const S = await montar({ copiar: process.argv[2] !== "nocopia" });
const { api, q, matriz } = S;
const mostrar = (r) => `${r.status} ${typeof r.data === "string" ? r.data.slice(0, 160) : JSON.stringify(r.data).slice(0, 300)}`;
const exigir = (r, msg) => { check(r.ok, msg, r.ok ? undefined : mostrar(r)); if (!r.ok) throw new Error("detenido en: " + msg); return r.data; };
const sacosDe = (pid) => q("SELECT id, tipo, marca, activo FROM sack_inventory WHERE product_id = $1 ORDER BY peso_lb DESC", [pid]);
const prod = async (pid) => (await q("SELECT name, code, is_active FROM products WHERE id = $1", [pid]))[0];

try {
  // ── A. Renombrar una marca desde el Catálogo de productos ──
  const alta = exigir(await api("POST", "/products/catalogo", { tipo: "PACKAGED_GOOD", nombre: "Sim Marca", calidad: "0.11", pesos: [100, 25] }, matriz), "A0. se crea la marca «Sim Marca» con sacos de 100 y 25 LB");
  const pid = alta.producto.id;
  const codigo = alta.producto.code;
  const ren = exigir(await api("PATCH", `/products/${pid}`, { name: "Sim Marca Nueva" }, matriz), "A1. ✎ Editar → nombre «Sim Marca Nueva»");
  check(ren.name === "Sim Marca Nueva" && ren.code === codigo, "A2. el producto devuelto ya tiene el nombre nuevo y el MISMO código", ren);
  const s1 = await sacosDe(pid);
  check(s1.length === 2 && s1.every((s) => s.marca === "Sim Marca Nueva") && s1[0].tipo === "Sim Marca Nueva 100 LB" && s1[1].tipo === "Sim Marca Nueva 25 LB",
    "A3. sus sacos pasan a «Sim Marca Nueva 100 LB / 25 LB» (mismo id)", s1);
  const cat = exigir(await api("GET", "/products/catalogo", undefined, matriz), "A4. el catálogo se vuelve a leer");
  check(cat.find((f) => f.id === pid)?.name === "Sim Marca Nueva" && cat.find((f) => f.id === pid)?.sacos === 2, "A5. … y la tabla muestra el nombre nuevo con sus 2 sacos");
  const dup = await api("PATCH", `/products/${pid}`, { name: "flor" }, matriz);
  const hayFlor = (await q("SELECT 1 FROM products WHERE lower(name) = 'flor'")).length > 0;
  check(!hayFlor || dup.status === 409, "A6. no deja ponerle el nombre de otro producto («Flor») → 409", mostrar(dup));
  const corto = await api("PATCH", `/products/${pid}`, { name: "x" }, matriz);
  check(corto.status === 400, "A7. nombre de 1 letra se rechaza (400)", corto.status);
  const mixto = exigir(await api("PATCH", `/products/${pid}`, { name: "Sim Marca Nueva", price_per_pound: 0.5 }, matriz), "A8. guardar tarifa con el mismo nombre sigue funcionando");
  check(mixto.price_per_pound === 0.5 && mixto.name === "Sim Marca Nueva", "A9. … tarifa guardada, nombre igual", mixto);

  // ── B. Renombrar desde el Catálogo de sacos ──
  const r2 = exigir(await api("PATCH", `/sacks/${s1[1].id}/nombre`, { nombre: "  Sim   Marca  B " }, matriz), "B1. ✎ Nombre en el saco de 25 LB → «Sim Marca B»");
  check(r2.despues === "Sim Marca B" && r2.sacos === 2, "B2. renombra la marca entera (2 sacos), con los espacios limpios", r2);
  check((await prod(pid)).name === "Sim Marca B" && (await sacosDe(pid)).every((s) => s.tipo.startsWith("Sim Marca B ")), "B3. producto y sacos quedan «Sim Marca B»");
  const generico = (await q("SELECT id FROM sack_inventory WHERE accionista_id IS NULL AND categoria IN ('GENERICO','SUBPRODUCTO') LIMIT 1"))[0];
  if (generico) {
    const rg = await api("PATCH", `/sacks/${generico.id}/nombre`, { nombre: "Otro nombre" }, matriz);
    check(rg.status === 400, "B4. un saco genérico / de subproducto (nombre del sistema) no se renombra (400)", mostrar(rg));
  }

  // ── C. Eliminar los sacos: el último desactiva la marca ──
  const sx = await sacosDe(pid);
  const d1 = exigir(await api("DELETE", `/sacks/${sx[0].id}`, undefined, matriz), "C1. se elimina el saco de 100 LB");
  check(d1.marca_desactivada === false && (await prod(pid)).is_active === true, "C2. la marca sigue activa (aún tiene el de 25 LB)", d1);
  const d2 = exigir(await api("DELETE", `/sacks/${sx[1].id}`, undefined, matriz), "C3. se elimina el último saco (25 LB)");
  check(d2.marca_desactivada === true && (await prod(pid)).is_active === false, "C4. la marca queda DESACTIVADA (sin sacos no se puede vender)", d2);
  const lista = exigir(await api("GET", "/products", undefined, matriz), "C5. lista de productos (la que usan Ventas y los selectores)");
  check(lista.find((p) => p.id === pid)?.is_active === false, "C6. … la marca viene como inactiva (los selectores la ocultan)");
  const pres = await q("SELECT count(*)::int n FROM product_presentations WHERE product_id = $1", [pid]);
  check(pres[0].n === 2, "C7. sus presentaciones se conservan (no quedan pedidos huérfanos)", pres[0]);

  // ── D. Volver a agregar su saco la reactiva ──
  exigir(await api("POST", "/sacks", { categoria: "MARCA", marca: "Sim Marca B", calidad: "0.11", pesos: [100] }, matriz), "D1. se vuelve a agregar «Sim Marca B 100 LB»");
  check((await prod(pid)).is_active === true && (await sacosDe(pid)).length === 1, "D2. la marca vuelve a estar activa con su saco");

  // ── E. Marca con historial: desactivar su único saco (PATCH activo=false) y reactivarlo ──
  const sh = (await sacosDe(pid))[0];
  await q("INSERT INTO sack_movements (sack_id, movement, cantidad, concepto) VALUES ($1, 'ENTRADA', 5, 'sim'), ($1, 'SALIDA', 5, 'sim')", [sh.id]);
  const d3 = exigir(await api("DELETE", `/sacks/${sh.id}`, undefined, matriz), "E1. eliminar un saco con kárdex lo DESACTIVA");
  check(d3.resultado === "DESACTIVADO" && d3.marca_desactivada === true && (await prod(pid)).is_active === false, "E2. … y la marca se desactiva", d3);
  exigir(await api("PATCH", `/sacks/${sh.id}`, { activo: true }, matriz), "E3. Reactivar el saco");
  check((await prod(pid)).is_active === true, "E4. … reactiva también la marca");

  // ── F. Marca con pedido pendiente: el saco se quita pero la marca NO se desactiva (se avisa) ──
  const altaF = exigir(await api("POST", "/products/catalogo", { tipo: "PACKAGED_GOOD", nombre: "Sim Con Stock", calidad: "CORRIENTE", pesos: [100] }, matriz), "F0. marca «Sim Con Stock»");
  const pidF = altaF.producto.id;
  const pendiente = (await q(
    `SELECT o.id FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id WHERE o.status = 'PENDING' LIMIT 1`))[0];
  if (pendiente) {
    // Se simula un pedido pendiente con esta marca apuntando un renglón existente de la copia.
    const it = (await q("SELECT id, product_id FROM sales_order_items WHERE order_id = $1 LIMIT 1", [pendiente.id]))[0];
    await q("UPDATE sales_order_items SET product_id = $2 WHERE id = $1", [it.id, pidF]);
    const sF = (await sacosDe(pidF))[0];
    const dF = exigir(await api("DELETE", `/sacks/${sF.id}`, undefined, matriz), "F1. se elimina el único saco de una marca con pedido pendiente");
    check(dF.marca_desactivada === false && typeof dF.aviso_marca === "string" && (await prod(pidF)).is_active === true,
      "F2. la marca NO se desactiva y se avisa el motivo (pedido pendiente)", dF);
    await q("UPDATE sales_order_items SET product_id = $2 WHERE id = $1", [it.id, it.product_id]);
  } else {
    check(true, "F1-F2. (la copia no tiene pedidos pendientes: se omite)");
  }
  // Con stock: tampoco se desactiva (primero se deja en 0 con un ajuste).
  exigir(await api("POST", "/sacks", { categoria: "MARCA", marca: "Sim Con Stock", calidad: "CORRIENTE", pesos: [25] }, matriz), "F3. otro saco para «Sim Con Stock»");
  const wh = (await q("SELECT id FROM warehouses ORDER BY name LIMIT 1"))[0];
  const mv = (await q("INSERT INTO inventory_movements (product_id, warehouse_id, movement, quantity, notes) VALUES ($1, $2, 'ADJUSTMENT', 3, 'sim') RETURNING id", [pidF, wh.id]))[0];
  for (const s of (await sacosDe(pidF)).filter((x) => x.activo)) {
    const d = exigir(await api("DELETE", `/sacks/${s.id}`, undefined, matriz), `F4. se elimina «${s.tipo}»`);
    if (!(await sacosDe(pidF)).some((x) => x.activo)) {
      check(d.marca_desactivada === false && /inventario/.test(d.aviso_marca ?? "") && (await prod(pidF)).is_active === true,
        "F5. con 3 QQ en inventario la marca NO se desactiva y se avisa «déjalo en 0»", d);
    }
  }
  await q("DELETE FROM inventory_movements WHERE id = $1", [mv.id]);

  // ── G. Saco PROPIO del socio con envejecido ──
  const socio = (await q("SELECT id FROM accionistas WHERE tipo='SOCIO' AND COALESCE(modulo_envejecido_habilitado, puede_envejecer, false) LIMIT 1"))[0];
  if (socio) {
    exigir(await api("POST", "/sacks", { categoria: "PROPIO", marca: "Sim Propio", pesos: [100, 25] }, socio.id), "G1. el socio agrega «Sim Propio» 100 y 25 LB");
    const sp = (await q("SELECT id FROM sack_inventory WHERE accionista_id = $1 AND marca = 'Sim Propio' LIMIT 1", [socio.id]))[0];
    const rp = exigir(await api("PATCH", `/sacks/${sp.id}/nombre`, { nombre: "Sim Propio Dos" }, socio.id), "G2. lo renombra a «Sim Propio Dos»");
    const filas = await q("SELECT tipo FROM sack_inventory WHERE accionista_id = $1 AND marca = 'Sim Propio Dos' ORDER BY peso_lb DESC", [socio.id]);
    check(rp.sacos === 2 && filas.map((f) => f.tipo).join("|") === "Sim Propio Dos 100 LB|Sim Propio Dos 25 LB", "G3. sus dos pesos quedan renombrados", filas);
    const ajeno = await api("PATCH", `/sacks/${sp.id}/nombre`, { nombre: "Hack" }, matriz);
    check(ajeno.status === 403, "G4. la Matriz no puede renombrar el saco propio del socio (403)", ajeno.status);
  }

  const h = await revisar((sql) => q(sql));
  check(h.length === 0, `Z. los ${TOTAL_REGLAS} controles de integridad se cumplen`, h.map((x) => x.error ? `${x.regla}: ${x.error}` : `${x.regla} → ${JSON.stringify(x.filas)}`));
} catch (e) { console.log("⛔", e.message, e.stack?.split("\n")[1]); } finally { const f = resumen(); await S.cerrar(); process.exit(f ? 1 : 0); }
