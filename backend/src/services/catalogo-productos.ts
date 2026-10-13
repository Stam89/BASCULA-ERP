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
// Nada se borra. El CÓDIGO queda fijo (las pantallas reconocen los productos del
// sistema por código). El NOMBRE se puede corregir: pedidos y kárdex enlazan por
// id, y los enlaces por nombre de marca (sack_inventory.marca/tipo) se renombran
// en la misma transacción.
// Una MARCA vive mientras tenga sacos: al eliminar o desactivar su último saco en
// «Catálogo de sacos» se desactiva el producto (si no tiene stock ni pedidos
// pendientes), para que deje de salir en ventas, inventario y selectores.
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

export type CambiosProducto = { nombre?: string; is_active?: boolean; price_per_pound?: number; venta_detalle?: boolean };

/** «Extra 100 LB» con la marca «Extra» → «Premium» = «Premium 100 LB». Si el tipo no empieza por la marca, no se toca. */
export function renombrarTipoSaco(tipo: string, viejo: string, nuevo: string): string {
  const t = String(tipo);
  return viejo && t.toLowerCase().startsWith(viejo.toLowerCase()) ? `${nuevo}${t.slice(viejo.length)}` : t;
}

/** Normaliza un nombre de producto: espacios simples, sin bordes. */
export function limpiarNombreProducto(nombre: string): string {
  return nombre.replace(/\s+/g, " ").trim();
}

/**
 * Por qué NO se puede desactivar el producto (stock distinto de 0 o pedidos pendientes),
 * o null si se puede. Es la misma regla para «Desactivar producto» y para la marca que
 * se queda sin sacos.
 */
export async function motivoNoDesactivar(client: { query: PoolClient["query"] }, id: string, nombre: string): Promise<string | null> {
  const stock = Number((await client.query("SELECT COALESCE(SUM(quantity), 0)::float AS s FROM inventory_movements WHERE product_id = $1", [id])).rows[0].s);
  if (Math.abs(stock) > 0.0005) {
    return `«${nombre}» tiene ${stock.toFixed(2)} ${stock < 0 ? "(negativo) " : ""}en inventario: déjalo en 0 con un ajuste antes de desactivarlo.`;
  }
  const pedidos = Number((await client.query(
    `SELECT COUNT(DISTINCT o.id)::int AS n FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id
      WHERE o.status = 'PENDING' AND (i.product_id = $1 OR i.inventory_product_id = $1)`, [id]
  )).rows[0].n);
  if (pedidos > 0) return `«${nombre}» está en ${pedidos} pedido(s) pendiente(s): despáchalos o cancélalos antes de desactivarlo.`;
  return null;
}

/**
 * Renombra un producto y lo que lo nombra como texto: los sacos de la planta de esa
 * marca (marca y tipo «<Marca> N LB») y sus sacos «(Usado)», que no tienen product_id.
 * El código, los ids y el historial (conceptos del kárdex) no cambian.
 */
async function renombrarProducto(client: PoolClient, p: { id: string; name: string }, nombreNuevo: string): Promise<void> {
  const nuevo = limpiarNombreProducto(nombreNuevo);
  if (nuevo.length < 2 || nuevo.length > 140) throw new ApiError(400, "El nombre debe tener entre 2 y 140 caracteres.");
  if (nuevo === p.name) return;
  const choca = (await client.query(
    "SELECT name, is_active FROM products WHERE lower(name) = lower($1) AND id <> $2 LIMIT 1", [nuevo, p.id]
  )).rows[0];
  if (choca) {
    throw new ApiError(409, `Ya existe otro producto llamado «${choca.name}»${choca.is_active === false ? " (desactivado)" : ""}. Elige otro nombre.`);
  }
  await client.query("UPDATE products SET name = $2 WHERE id = $1", [p.id, nuevo]);
  const sacos = (await client.query(
    `SELECT id, tipo, marca FROM sack_inventory
      WHERE accionista_id IS NULL
        AND (product_id = $1 OR (categoria = 'USADO' AND product_id IS NULL AND upper(marca) = upper($2)))
      FOR UPDATE`,
    [p.id, p.name]
  )).rows;
  for (const s of sacos) {
    const marca = s.marca != null && String(s.marca).toLowerCase() === p.name.toLowerCase() ? nuevo : s.marca;
    await client.query(
      "UPDATE sack_inventory SET marca = $2, tipo = $3, updated_at = now() WHERE id = $1",
      [s.id, marca, renombrarTipoSaco(s.tipo, p.name, nuevo)]
    );
  }
}

/** Cambios de un producto: nombre (el código no), activo, tarifa por libra y venta al detalle. */
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
    const motivo = await motivoNoDesactivar(client, id, p.name);
    if (motivo) throw new ApiError(409, motivo);
  }

  if (c.nombre !== undefined) await renombrarProducto(client, p, c.nombre);

  await client.query(
    `UPDATE products SET is_active = COALESCE($2, is_active), price_per_pound = $3, venta_detalle = $4 WHERE id = $1`,
    [id, c.is_active ?? null, tarifa, c.is_active === false ? false : detalle]
  );
}

export type SincroMarca = { producto: string; accion: "DESACTIVADO" | "REACTIVADO" | "SIGUE_ACTIVO"; motivo?: string } | null;

/**
 * Deja la MARCA de un saco de la planta coherente con sus sacos, tras eliminar,
 * desactivar o reactivar uno en «Catálogo de sacos»:
 *  · sin ningún saco activo → se desactiva el producto (sale de ventas, inventario y
 *    selectores). Si tiene stock o pedidos pendientes NO se desactiva y se dice por qué.
 *  · con algún saco activo y el producto desactivado → se reactiva.
 * Solo marcas (PACKAGED_GOOD); los genéricos, subproductos y sacos de socios no tienen producto.
 */
export async function sincronizarMarcaConSacos(client: PoolClient, productId: string | null): Promise<SincroMarca> {
  if (!productId) return null;
  const p = (await client.query(
    "SELECT id, name, product_type, is_active FROM products WHERE id = $1 FOR UPDATE", [productId]
  )).rows[0];
  if (!p || p.product_type !== "PACKAGED_GOOD") return null;
  const activos = Number((await client.query(
    "SELECT COUNT(*)::int AS n FROM sack_inventory WHERE product_id = $1 AND accionista_id IS NULL AND activo", [productId]
  )).rows[0].n);
  if (activos > 0) {
    if (p.is_active !== false) return null;
    await client.query("UPDATE products SET is_active = true WHERE id = $1", [productId]);
    return { producto: p.name, accion: "REACTIVADO" };
  }
  if (p.is_active === false) return null;
  const motivo = await motivoNoDesactivar(client, productId, p.name);
  if (motivo) return { producto: p.name, accion: "SIGUE_ACTIVO", motivo };
  await client.query("UPDATE products SET is_active = false, venta_detalle = false WHERE id = $1", [productId]);
  return { producto: p.name, accion: "DESACTIVADO" };
}
