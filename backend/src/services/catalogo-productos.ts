// ── Catálogo de productos (Configuración → 🧺 Catálogo de productos) ─────────
// Crea un producto Y lo enlaza con lo que necesita para funcionar, en una sola
// transacción:
//  · MARCA / EMPACADO (PACKAGED_GOOD): el producto + sus PRESENTACIONES (pesos) +
//    un SACO por cada peso (sin saco propio la marca no puede empacar) + la
//    CALIDAD (0.11 o Corriente), que dice con qué arroz base se respalda el stock
//    al vender. Es el mismo alta que «📦 Catálogo de sacos → Nueva marca».
//  · TERMINADO / SUBPRODUCTO: el producto + presentaciones opcionales + tarifa por
//    libra y si se vende al detalle en el mostrador (Caja → Venta Detalle).
//  · MATERIA PRIMA: solo el producto.
// Nada se borra. El CÓDIGO queda fijo; el NOMBRE se puede corregir con
// `renombrarProducto` (pedidos, kárdex y sacos se enlazan por id; los sacos de una
// marca llevan el nombre en `marca`/`tipo` y se renombran en la misma transacción).
import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";

export type TipoProducto = "FINISHED_GOOD" | "PACKAGED_GOOD" | "BYPRODUCT" | "RAW_MATERIAL";
export const TIPOS_PRODUCTO: readonly TipoProducto[] = ["FINISHED_GOOD", "PACKAGED_GOOD", "BYPRODUCT", "RAW_MATERIAL"];
export type Calidad = "0.11" | "CORRIENTE";

export const PESOS_MARCA_POR_DEFECTO = [100, 50, 25, 10];
const MAX_PRESENTACIONES = 8;

/** «Lira Azul» → «LIRA-AZUL» (sin tildes, solo A-Z 0-9 y guiones). */
export function slugCodigo(texto: string): string {
  return texto.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Código sugerido por tipo (sigue la convención del catálogo: ARROZ-…, MP-… ). */
export function codigoSugerido(nombre: string, tipo: TipoProducto): string {
  const base = slugCodigo(nombre);
  if (!base) return "";
  if (tipo === "PACKAGED_GOOD" || tipo === "FINISHED_GOOD") return `ARROZ-${base}`;
  if (tipo === "RAW_MATERIAL") return `MP-${base}`;
  return base;
}

/** Pesos (lb) válidos, sin repetir, de mayor a menor. 400 si alguno no sirve. */
export function normalizarPesos(pesos: number[] | undefined): number[] {
  const out = [...new Set((pesos ?? []).map((p) => Math.round(Number(p) * 1000) / 1000))];
  if (out.some((p) => !Number.isFinite(p) || p <= 0 || p > 1000)) {
    throw new ApiError(400, "Los pesos de presentación deben estar entre 0 y 1000 libras.");
  }
  if (out.length > MAX_PRESENTACIONES) throw new ApiError(400, `Máximo ${MAX_PRESENTACIONES} presentaciones por producto.`);
  return out.sort((a, b) => b - a);
}

const pesoTxt = (p: number) => String(Number(p));

// ─────────────────────────────────────────────────────────────────────────────
// ALTA DE UNA MARCA (o saco genérico) con presentaciones y sacos por peso.
// Es el cuerpo de «POST /sacks» de la Matriz, movido aquí SIN cambiar su
// comportamiento para que «Catálogo de sacos» y «Catálogo de productos» creen lo
// mismo de la misma forma.
// ─────────────────────────────────────────────────────────────────────────────
export type AltaSacos = {
  categoria: "MARCA" | "GENERICO";
  marca?: string | null;
  calidad?: Calidad | null;
  pesos: number[];
  stock_minimo: number;
  precio_compra_default: number;
  precio_venta_cliente: number;
};

export async function altaMarcaOGenerico(
  client: PoolClient,
  body: AltaSacos
): Promise<{ creados: string[]; existentes: string[]; productId: string | null; marca: string | null }> {
  let productId: string | null = null;
  let marca: string | null = null;
  if (body.categoria === "MARCA") {
    marca = (body.marca ?? "").replace(/\s+/g, " ").trim();
    const prod = await client.query(
      "SELECT id, name FROM products WHERE upper(name) = upper($1) ORDER BY is_active DESC LIMIT 1",
      [marca]
    );
    if (prod.rowCount) {
      productId = prod.rows[0].id;
      marca = prod.rows[0].name;
      await client.query("UPDATE products SET is_active = true WHERE id = $1", [productId]);
    } else {
      const code = `ARROZ-${marca.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      const choca = await client.query("SELECT 1 FROM products WHERE upper(code) = $1", [code]);
      const created = await client.query(
        `INSERT INTO products (code, name, product_type, unit, is_active)
         VALUES ($1, $2, 'PACKAGED_GOOD', 'QQ', true) RETURNING id`,
        [choca.rowCount ? `${code}-${Date.now().toString(36).slice(-4).toUpperCase()}` : code, marca]
      );
      productId = created.rows[0].id;
    }
  }

  const creados: string[] = [];
  const existentes: string[] = [];
  for (const peso of [...new Set(body.pesos)]) {
    const txt = String(peso);
    const tipo = body.categoria === "MARCA" ? `${marca} ${txt} LB` : `Saco ${txt} LB`;
    if (productId) {
      const pres = await client.query(
        "SELECT 1 FROM product_presentations WHERE product_id = $1 AND weight_lb = $2",
        [productId, peso]
      );
      if (!pres.rowCount) {
        await client.query(
          "INSERT INTO product_presentations (product_id, name, weight_lb) VALUES ($1, $2, $3)",
          [productId, `${txt}lb`, peso]
        );
      }
    }
    const prev = productId
      ? await client.query("SELECT id, activo FROM sack_inventory WHERE product_id = $1 AND peso_lb = $2", [productId, peso])
      : await client.query("SELECT id, activo FROM sack_inventory WHERE categoria = 'GENERICO' AND peso_lb = $1 AND accionista_id IS NULL", [peso]);
    if (prev.rowCount) {
      if (prev.rows[0].activo) { existentes.push(tipo); continue; }
      await client.query(
        `UPDATE sack_inventory SET activo = true, calidad = COALESCE($2, calidad), stock_minimo = $3,
                precio_compra_default = $4, precio_venta_cliente = $5, updated_at = now() WHERE id = $1`,
        [prev.rows[0].id, body.calidad ?? null, body.stock_minimo, body.precio_compra_default, body.precio_venta_cliente]
      );
      creados.push(`${tipo} (reactivado)`);
      continue;
    }
    await client.query(
      `INSERT INTO sack_inventory
         (tipo, stock, categoria, marca, calidad, peso_lb, product_id, stock_minimo, precio_compra_default, precio_venta_cliente)
       VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tipo, body.categoria, marca, body.calidad ?? null, peso, productId, body.stock_minimo,
       body.precio_compra_default, body.precio_venta_cliente]
    );
    creados.push(tipo);
  }
  return { creados, existentes, productId, marca };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO
// ─────────────────────────────────────────────────────────────────────────────
const SELECT_CATALOGO = `
  SELECT p.id, p.code, p.name, p.product_type, p.unit, p.is_active,
         p.price_per_pound::float AS price_per_pound, p.venta_detalle,
         COALESCE((SELECT json_agg(json_build_object('id', pp.id, 'name', pp.name, 'weight_lb', pp.weight_lb::float) ORDER BY pp.weight_lb DESC)
                     FROM product_presentations pp WHERE pp.product_id = p.id), '[]'::json) AS presentaciones,
         (SELECT COUNT(*)::int FROM sack_inventory s WHERE s.product_id = p.id AND s.activo AND s.accionista_id IS NULL) AS sacos,
         (SELECT MAX(s.calidad) FROM sack_inventory s WHERE s.product_id = p.id AND s.calidad IS NOT NULL) AS calidad,
         COALESCE((SELECT SUM(m.quantity)::float FROM inventory_movements m WHERE m.product_id = p.id), 0) AS stock_total,
         EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id) AS con_movimientos
    FROM products p`;

export async function listarCatalogo(client: { query: PoolClient["query"] }, id?: string) {
  const r = id
    ? await client.query(`${SELECT_CATALOGO} WHERE p.id = $1`, [id])
    : await client.query(`${SELECT_CATALOGO} ORDER BY p.is_active DESC,
        CASE p.product_type WHEN 'RAW_MATERIAL' THEN 0 WHEN 'FINISHED_GOOD' THEN 1 WHEN 'PACKAGED_GOOD' THEN 2 ELSE 3 END, p.name`);
  return r.rows;
}

export type NuevoProductoCatalogo = {
  tipo: TipoProducto;
  nombre: string;
  codigo?: string;
  unidad: string;
  /** Solo marcas: con qué arroz base se respalda (0.11 o Corriente). */
  calidad?: Calidad | null;
  pesos: number[];
  stock_minimo: number;
  precio_compra_default: number;
  precio_venta_cliente: number;
  price_per_pound: number;
  venta_detalle: boolean;
};

export type ResultadoAlta = {
  id: string;
  reactivado: boolean;
  presentaciones: string[];
  sacos_creados: string[];
  sacos_existentes: string[];
};

export async function crearProductoCatalogo(client: PoolClient, body: NuevoProductoCatalogo): Promise<ResultadoAlta> {
  const nombre = body.nombre.replace(/\s+/g, " ").trim();
  if (nombre.length < 2) throw new ApiError(400, "Escribe el nombre del producto.");
  const codigo = body.codigo?.trim() ? slugCodigo(body.codigo) : codigoSugerido(nombre, body.tipo);
  if (codigo.length < 2) throw new ApiError(400, "El código del producto no es válido (solo letras, números y guiones).");
  const unidad = (body.unidad || "QQ").trim().toUpperCase().slice(0, 20) || "QQ";
  const esMarca = body.tipo === "PACKAGED_GOOD";

  if (esMarca && !body.calidad) {
    throw new ApiError(400, "Elige el arroz base de la marca (0.11 o Corriente): de ahí sale el stock con el que se vende.");
  }
  if (body.venta_detalle && body.tipo === "RAW_MATERIAL") throw new ApiError(400, "La materia prima no se vende al detalle.");
  if (body.venta_detalle && !(body.price_per_pound > 0)) {
    throw new ApiError(400, "Para vender al detalle pon primero la tarifa por libra.");
  }
  const pesos = normalizarPesos(body.pesos.length ? body.pesos : esMarca ? PESOS_MARCA_POR_DEFECTO : body.tipo === "BYPRODUCT" ? [100] : []);

  const existente = (await client.query(
    `SELECT id, code, name, product_type, is_active FROM products
      WHERE lower(code) = lower($1) OR lower(name) = lower($2)
      ORDER BY is_active DESC LIMIT 1`,
    [codigo, nombre]
  )).rows[0];
  let id: string;
  let reactivado = false;
  if (existente) {
    if (existente.is_active !== false) {
      throw new ApiError(409, `Ya existe «${existente.name}» (código ${existente.code}). Búscalo en la lista para editarlo.`);
    }
    if (existente.product_type !== body.tipo) {
      throw new ApiError(409, `«${existente.name}» existe desactivado con otro tipo. Reactívalo desde la lista en vez de crearlo de nuevo.`);
    }
    id = existente.id;
    reactivado = true;
    await client.query(
      "UPDATE products SET is_active = true, unit = $2, price_per_pound = $3, venta_detalle = $4 WHERE id = $1",
      [id, unidad, body.price_per_pound, body.venta_detalle]
    );
  } else {
    id = (await client.query(
      `INSERT INTO products (code, name, product_type, unit, is_active, price_per_pound, venta_detalle)
       VALUES ($1, $2, $3, $4, true, $5, $6) RETURNING id`,
      [codigo, nombre, body.tipo, unidad, body.price_per_pound, body.venta_detalle]
    )).rows[0].id;
  }

  let sacosCreados: string[] = [];
  let sacosExistentes: string[] = [];
  if (esMarca) {
    // Presentaciones + un saco por peso + calidad: el mismo alta de «Catálogo de sacos».
    const alta = await altaMarcaOGenerico(client, {
      categoria: "MARCA", marca: nombre, calidad: body.calidad ?? null, pesos,
      stock_minimo: body.stock_minimo, precio_compra_default: body.precio_compra_default, precio_venta_cliente: body.precio_venta_cliente
    });
    sacosCreados = alta.creados;
    sacosExistentes = alta.existentes;
  } else {
    for (const peso of pesos) await agregarPresentacionSimple(client, id, peso);
  }
  const presentaciones = (await client.query(
    "SELECT name FROM product_presentations WHERE product_id = $1 ORDER BY weight_lb DESC", [id]
  )).rows.map((r) => String(r.name));
  return { id, reactivado, presentaciones, sacos_creados: sacosCreados, sacos_existentes: sacosExistentes };
}

async function agregarPresentacionSimple(client: PoolClient, productId: string, peso: number): Promise<boolean> {
  const ya = await client.query("SELECT 1 FROM product_presentations WHERE product_id = $1 AND weight_lb = $2", [productId, peso]);
  if (ya.rowCount) return false;
  await client.query(
    "INSERT INTO product_presentations (product_id, name, weight_lb) VALUES ($1, $2, $3) ON CONFLICT (product_id, name) DO NOTHING",
    [productId, `${pesoTxt(peso)}lb`, peso]
  );
  return true;
}

/** Agrega una presentación (peso) a un producto; en una marca crea también su saco. */
export async function agregarPresentacion(client: PoolClient, productId: string, pesoLb: number): Promise<{ sacoCreado: string | null }> {
  const [peso] = normalizarPesos([pesoLb]);
  const p = (await client.query("SELECT id, name, product_type, is_active FROM products WHERE id = $1", [productId])).rows[0];
  if (!p) throw new ApiError(404, "Producto no encontrado");
  const total = Number((await client.query("SELECT COUNT(*)::int AS n FROM product_presentations WHERE product_id = $1", [productId])).rows[0].n);
  if (total >= MAX_PRESENTACIONES) throw new ApiError(400, `Máximo ${MAX_PRESENTACIONES} presentaciones por producto.`);
  if (p.product_type === "PACKAGED_GOOD") {
    const base = (await client.query(
      "SELECT calidad, stock_minimo, precio_compra_default, precio_venta_cliente FROM sack_inventory WHERE product_id = $1 AND accionista_id IS NULL ORDER BY (calidad IS NULL), peso_lb DESC LIMIT 1",
      [productId]
    )).rows[0];
    const alta = await altaMarcaOGenerico(client, {
      categoria: "MARCA", marca: p.name, calidad: base?.calidad ?? null, pesos: [peso],
      stock_minimo: Number(base?.stock_minimo ?? 0), precio_compra_default: Number(base?.precio_compra_default ?? 0),
      precio_venta_cliente: Number(base?.precio_venta_cliente ?? 0)
    });
    return { sacoCreado: alta.creados[0] ?? null };
  }
  await agregarPresentacionSimple(client, productId, peso);
  return { sacoCreado: null };
}

/** Reemplaza el nombre viejo al inicio de un «tipo» de saco («Flor 100 LB (Usado)» → «Flor Premium 100 LB (Usado)»). */
export function tipoRenombrado(tipo: string, viejo: string, nuevo: string, pesoLb?: number | null): string {
  const t = String(tipo ?? "");
  if (t.toLowerCase().startsWith(viejo.toLowerCase())) return nuevo + t.slice(viejo.length);
  return pesoLb != null && Number(pesoLb) > 0 ? `${nuevo} ${pesoTxt(Number(pesoLb))} LB` : t;
}

/**
 * Corrige el NOMBRE de un producto (el código no cambia). Pedidos, inventario y
 * presentaciones van por id, así que siguen enlazados. En una marca, sus sacos de la
 * planta (y los «(Usado)» de esa marca) cambian `marca` y `tipo` en la misma transacción.
 */
export async function renombrarProducto(client: PoolClient, id: string, nombreNuevo: string): Promise<{ antes: string; despues: string; sacos: number }> {
  const nombre = nombreNuevo.replace(/\s+/g, " ").trim();
  if (nombre.length < 2 || nombre.length > 140) throw new ApiError(400, "El nombre debe tener entre 2 y 140 caracteres.");
  const p = (await client.query("SELECT id, name, product_type FROM products WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!p) throw new ApiError(404, "Producto no encontrado");
  const antes = String(p.name);
  if (antes === nombre) return { antes, despues: nombre, sacos: 0 };
  const dup = await client.query("SELECT name FROM products WHERE lower(name) = lower($1) AND id <> $2 LIMIT 1", [nombre, id]);
  if (dup.rowCount) throw new ApiError(409, `Ya existe otro producto llamado «${dup.rows[0].name}».`);
  await client.query("UPDATE products SET name = $2 WHERE id = $1", [id, nombre]);

  let sacos = 0;
  if (p.product_type === "PACKAGED_GOOD") {
    const filas = (await client.query(
      `SELECT id, tipo, peso_lb::float AS peso_lb FROM sack_inventory
        WHERE product_id = $1
           OR (categoria = 'USADO' AND accionista_id IS NULL AND lower(marca) = lower($2))
        FOR UPDATE`,
      [id, antes]
    )).rows;
    for (const s of filas) {
      await client.query("UPDATE sack_inventory SET marca = $2, tipo = $3, updated_at = now() WHERE id = $1",
        [s.id, nombre, tipoRenombrado(s.tipo, antes, nombre, s.peso_lb)]);
      sacos++;
    }
  }
  return { antes, despues: nombre, sacos };
}

/**
 * ¿Dónde se usó el producto? Recorre TODAS las tablas que lo referencian (llaves foráneas)
 * menos sus propias presentaciones y sacos; de los sacos cuenta solo los que tienen kárdex
 * o stock. Lista vacía = nunca se usó y se puede borrar sin dejar nada huérfano.
 */
export async function usosDelProducto(client: { query: PoolClient["query"] }, productId: string): Promise<string[]> {
  const fks = (await client.query(
    `SELECT tc.table_name AS tabla, kcu.column_name AS columna
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        AND ccu.table_name = 'products' AND ccu.column_name = 'id'
        AND tc.table_name NOT IN ('product_presentations', 'sack_inventory')`
  )).rows as Array<{ tabla: string; columna: string }>;
  const usos: string[] = [];
  for (const f of fks) {
    const n = Number((await client.query(`SELECT COUNT(*)::int AS n FROM "${f.tabla}" WHERE "${f.columna}" = $1`, [productId])).rows[0].n);
    if (n > 0) usos.push(`${f.tabla} (${n})`);
  }
  // Renglones de pedido que apunten a sus presentaciones (columna sin llave foránea).
  const porPres = Number((await client.query(
    `SELECT COUNT(*)::int AS n FROM sales_order_items
      WHERE presentation_id IN (SELECT id FROM product_presentations WHERE product_id = $1)`, [productId]
  )).rows[0].n);
  if (porPres > 0) usos.push(`sales_order_items.presentation_id (${porPres})`);
  const sacos = Number((await client.query(
    `SELECT COUNT(*)::int AS n FROM sack_inventory s
      WHERE s.product_id = $1 AND (s.stock <> 0 OR EXISTS (SELECT 1 FROM sack_movements m WHERE m.sack_id = s.id))`, [productId]
  )).rows[0].n);
  if (sacos > 0) usos.push(`sacos con kárdex o stock (${sacos})`);
  return usos;
}

/**
 * ELIMINA un producto que nunca se usó (con sus presentaciones y sus sacos sin kárdex).
 * Si tiene historial no borra nada y devuelve dónde se usó (entonces se desactiva).
 * Volver a crearlo (Catálogo de productos o de sacos) con el mismo nombre lo crea limpio y enlazado.
 */
export async function eliminarProductoSinHistorial(client: PoolClient, productId: string): Promise<{ eliminado: boolean; nombre: string; usos: string[] }> {
  const p = (await client.query("SELECT id, name FROM products WHERE id = $1 FOR UPDATE", [productId])).rows[0];
  if (!p) throw new ApiError(404, "Producto no encontrado");
  const usos = await usosDelProducto(client, productId);
  if (usos.length) return { eliminado: false, nombre: p.name, usos };
  await client.query("DELETE FROM sack_inventory WHERE product_id = $1", [productId]);
  await client.query("DELETE FROM product_presentations WHERE product_id = $1", [productId]);
  await client.query("DELETE FROM products WHERE id = $1", [productId]);
  return { eliminado: true, nombre: p.name, usos: [] };
}

/**
 * Tras quitar un saco de MARCA: si la marca se quedó SIN sacos activos de la planta ya
 * no se puede vender empacada. Si nunca se usó se ELIMINA (al volver a crear un saco con
 * ese nombre se crea de nuevo, ya enlazada); si tiene historial se DESACTIVA (deja de salir
 * en Ventas, Inventario y selectores y se reactiva al volver a agregar su saco).
 * Si tiene stock o pedidos pendientes NO se toca y se devuelve el motivo.
 */
export async function desactivarMarcaSinSacos(client: PoolClient, productId: string | null, opts: { permitirBorrar?: boolean } = {}): Promise<{ desactivada: boolean; eliminada?: boolean; marca?: string; motivo?: string }> {
  if (!productId) return { desactivada: false };
  const p = (await client.query("SELECT id, name, product_type, is_active FROM products WHERE id = $1", [productId])).rows[0];
  if (!p || p.product_type !== "PACKAGED_GOOD" || p.is_active === false) return { desactivada: false };
  const quedan = Number((await client.query(
    "SELECT COUNT(*)::int AS n FROM sack_inventory WHERE product_id = $1 AND activo AND accionista_id IS NULL", [productId]
  )).rows[0].n);
  if (quedan > 0) return { desactivada: false };
  const borrado = opts.permitirBorrar === false ? { eliminado: false } : await eliminarProductoSinHistorial(client, productId);
  if (borrado.eliminado) return { desactivada: true, eliminada: true, marca: p.name };
  try {
    await actualizarProductoCatalogo(client, productId, { is_active: false });
    return { desactivada: true, eliminada: false, marca: p.name };
  } catch (e) {
    // Solo validaciones (stock / pedidos pendientes): no hubo error de SQL, la transacción sigue sana.
    if (e instanceof ApiError) return { desactivada: false, marca: p.name, motivo: e.message };
    throw e;
  }
}

/** Al reactivar un saco de marca, su marca vuelve a estar activa (para poder venderla). */
export async function reactivarMarcaDeSaco(client: { query: PoolClient["query"] }, sackId: string): Promise<void> {
  await client.query(
    `UPDATE products SET is_active = true
      WHERE id = (SELECT product_id FROM sack_inventory WHERE id = $1 AND accionista_id IS NULL AND categoria = 'MARCA')
        AND is_active = false`,
    [sackId]
  );
}

export type CambiosProducto = { is_active?: boolean; price_per_pound?: number; venta_detalle?: boolean };

/** Cambios seguros de un producto (el nombre va por `renombrarProducto`). */
export async function actualizarProductoCatalogo(client: PoolClient, id: string, c: CambiosProducto): Promise<void> {
  const p = (await client.query(
    "SELECT id, name, product_type, is_active, price_per_pound::float AS price_per_pound, venta_detalle FROM products WHERE id = $1 FOR UPDATE", [id]
  )).rows[0];
  if (!p) throw new ApiError(404, "Producto no encontrado");

  const tarifa = c.price_per_pound ?? p.price_per_pound;
  const detalle = c.venta_detalle ?? p.venta_detalle;
  if (detalle && p.product_type === "RAW_MATERIAL") throw new ApiError(400, "La materia prima no se vende al detalle.");
  if (detalle && !(tarifa > 0)) throw new ApiError(400, "Para vender al detalle pon primero la tarifa por libra.");

  if (c.is_active === false && p.is_active !== false) {
    const stock = Number((await client.query("SELECT COALESCE(SUM(quantity), 0)::float AS s FROM inventory_movements WHERE product_id = $1", [id])).rows[0].s);
    if (Math.abs(stock) > 0.0005) {
      throw new ApiError(409, `«${p.name}» tiene ${stock.toFixed(2)} ${stock < 0 ? "(negativo) " : ""}en inventario: déjalo en 0 con un ajuste antes de desactivarlo.`);
    }
    const pedidos = Number((await client.query(
      `SELECT COUNT(DISTINCT o.id)::int AS n FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id
        WHERE o.status = 'PENDING' AND (i.product_id = $1 OR i.inventory_product_id = $1)`, [id]
    )).rows[0].n);
    if (pedidos > 0) throw new ApiError(409, `«${p.name}» está en ${pedidos} pedido(s) pendiente(s): despáchalos o cancélalos antes de desactivarlo.`);
  }

  await client.query(
    `UPDATE products SET is_active = COALESCE($2, is_active), price_per_pound = $3, venta_detalle = $4 WHERE id = $1`,
    [id, c.is_active ?? null, tarifa, c.is_active === false ? false : detalle]
  );
}
