import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { avisarSobregiro } from "../../services/caja.js";
import { inTransaction } from "../../db/transaction.js";
import { round2 } from "../../utils/rice-formulas.js";
import { type AuthenticatedRequest } from "../../auth/require-auth.js";
import { sacosPorComprar } from "../../services/sacos.js";
import { altaMarcaOGenerico } from "../../services/catalogo-productos.js";

export const sacksRouter = Router();

// REGLA DE NEGOCIO: cada catálogo de sacos tiene DUEÑO.
//  · MATRIZ / Planta: su catálogo (accionista_id NULL: marcas, genéricos y
//    subproductos). Es el que usan ventas y producción.
//  · Un SOCIO con proceso propio (envejecido: STALYN) tiene SU catálogo
//    (accionista_id = el socio): lo compra en su Caja y lo consume en su
//    Envejecido. Un socio sin proceso propio (ROVINSON) no maneja sacos.
// Toda ESCRITURA exige que los sacos sean del accionista ACTIVO.
type AmbitoSacos = { accionistaId: string; esMatriz: boolean };

async function ambitoSacos(req: AuthenticatedRequest, opts: { exigirManejo?: boolean } = {}): Promise<AmbitoSacos> {
  const accionistaId = req.accionistaId ?? null;
  if (!accionistaId) throw new ApiError(400, "Selecciona un accionista antes de continuar.");
  const r = await pool.query(
    "SELECT tipo, COALESCE(modulo_envejecido_habilitado, puede_envejecer, false) AS envejece FROM accionistas WHERE id = $1",
    [accionistaId]
  );
  const esMatriz = r.rows[0]?.tipo === "MATRIZ";
  if (opts.exigirManejo !== false && !esMatriz && !r.rows[0]?.envejece) {
    throw new ApiError(403, "Este socio no maneja sacos propios. Los sacos de la planta se registran desde la Matriz.");
  }
  return { accionistaId, esMatriz };
}

/** Condición SQL del catálogo del ámbito (parámetro $n = accionista del socio). */
function condAmbito(a: AmbitoSacos, n: number): { sql: string; params: unknown[] } {
  return a.esMatriz ? { sql: "accionista_id IS NULL", params: [] } : { sql: `accionista_id = $${n}`, params: [a.accionistaId] };
}

/** Rechaza si algún saco no pertenece al catálogo del accionista activo. */
async function assertSacosDelAmbito(client: { query: typeof pool.query }, a: AmbitoSacos, ids: string[]): Promise<void> {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return;
  const c = condAmbito(a, 2);
  const r = await client.query(`SELECT count(*)::int AS n FROM sack_inventory WHERE id = ANY($1::uuid[]) AND ${c.sql}`, [unicos, ...c.params]);
  if (Number(r.rows[0].n) !== unicos.length) {
    throw new ApiError(403, a.esMatriz
      ? "Ese saco no pertenece al inventario de la Matriz."
      : "Ese saco no pertenece a tu catálogo propio de sacos.");
  }
}

// GET tipos de saco con stock. Por defecto: catálogo de la MATRIZ (lo usan
// ventas, producción y el indicador de stock). Con ?propio=1: el catálogo del
// accionista ACTIVO (la Matriz ve el suyo; un socio, solo sus sacos propios).
sacksRouter.get("/", asyncRoute(async (req, res) => {
  const propio = req.query.propio === "1";
  let cond = "accionista_id IS NULL";
  const params: unknown[] = [];
  if (propio) {
    const a = await ambitoSacos(req as AuthenticatedRequest, { exigirManejo: false });
    const c = condAmbito(a, 1);
    cond = c.sql; params.push(...c.params);
  }
  // Orden de catálogo: marcas (por nombre y peso de mayor a menor), luego
  // subproductos y genéricos. `bajo_minimo` alimenta las alertas del Dashboard.
  const result = await pool.query(
    `SELECT *, (stock_minimo > 0 AND stock <= stock_minimo) AS bajo_minimo
     FROM sack_inventory
     WHERE ${cond}
     ORDER BY CASE categoria WHEN 'MARCA' THEN 0 WHEN 'SUBPRODUCTO' THEN 1 ELSE 2 END,
              COALESCE(marca, tipo), peso_lb DESC NULLS LAST, tipo`,
    params
  );
  res.json(result.rows);
}));

// ── CATÁLOGO DE SACOS (Configuración) ──────────────────────────────────────
// Alta de sacos de una MARCA en uno o varios pesos (100/50/25/10 LB) o de un
// saco GENÉRICO "Saco N LB". Una marca nueva se crea también como producto
// empacado (con sus presentaciones) para poder venderla y descontar su saco.
const PESOS_VALIDOS = z.number().positive().max(1000);
sacksRouter.post("/", asyncRoute(async (req, res) => {
  const ambito = await ambitoSacos(req as AuthenticatedRequest);
  const body = z.object({
    categoria: z.enum(["MARCA", "GENERICO", "PROPIO"]).default("MARCA"),
    marca: z.string().trim().max(60).optional(),
    calidad: z.enum(["0.11", "CORRIENTE"]).nullable().optional(),
    pesos: z.array(PESOS_VALIDOS).min(1),
    stock_minimo: z.number().int().nonnegative().default(0),
    precio_compra_default: z.number().nonnegative().default(0),
    precio_venta_cliente: z.number().nonnegative().default(0)
  }).parse(req.body);
  if (body.categoria === "MARCA" && !body.marca) throw new ApiError(400, "Escribe el nombre de la marca.");

  // SOCIO con proceso propio (envejecido): sus sacos NO son marcas de venta ni
  // genéricos de la planta; quedan en SU catálogo con el nombre que les ponga.
  if (!ambito.esMatriz) {
    const nombre = (body.marca ?? "").replace(/\s+/g, " ").trim();
    if (!nombre) throw new ApiError(400, "Escribe el nombre del saco (ej: Saco envejecido).");
    const out = await inTransaction(async (client) => {
      const creados: string[] = [];
      const existentes: string[] = [];
      for (const peso of [...new Set(body.pesos)]) {
        const tipo = `${nombre} ${peso} LB`;
        const prev = await client.query(
          "SELECT id, activo FROM sack_inventory WHERE accionista_id = $1 AND upper(marca) = upper($2) AND peso_lb = $3",
          [ambito.accionistaId, nombre, peso]
        );
        if (prev.rowCount) {
          if (prev.rows[0].activo) { existentes.push(tipo); continue; }
          await client.query(
            `UPDATE sack_inventory SET activo = true, stock_minimo = $2, precio_compra_default = $3, updated_at = now() WHERE id = $1`,
            [prev.rows[0].id, body.stock_minimo, body.precio_compra_default]
          );
          creados.push(`${tipo} (reactivado)`);
          continue;
        }
        await client.query(
          `INSERT INTO sack_inventory (tipo, stock, categoria, marca, peso_lb, stock_minimo, precio_compra_default, accionista_id)
           VALUES ($1, 0, 'PROPIO', $2, $3, $4, $5, $6)`,
          [tipo, nombre, peso, body.stock_minimo, body.precio_compra_default, ambito.accionistaId]
        );
        creados.push(tipo);
      }
      return { creados, existentes };
    });
    res.status(201).json(out);
    return;
  }
  if (body.categoria === "PROPIO") throw new ApiError(400, "La Matriz registra sacos de marca o genéricos.");

  const result = await inTransaction(async (client) => {
    const alta = await altaMarcaOGenerico(client, {
      categoria: body.categoria === "MARCA" ? "MARCA" : "GENERICO",
      marca: body.marca ?? null,
      calidad: body.calidad ?? null,
      pesos: body.pesos,
      stock_minimo: body.stock_minimo,
      precio_compra_default: body.precio_compra_default,
      precio_venta_cliente: body.precio_venta_cliente
    });
    return { creados: alta.creados, existentes: alta.existentes };
  });
  res.status(201).json(result);
}));

// Edita los datos de control de un saco (no su stock: el stock solo cambia con
// compras, ventas y movimientos, para que el kárdex siempre cuadre).
sacksRouter.patch("/:id", asyncRoute(async (req, res) => {
  const ambito = await ambitoSacos(req as AuthenticatedRequest);
  await assertSacosDelAmbito(pool, ambito, [String(req.params.id)]);
  const body = z.object({
    stock_minimo: z.number().int().nonnegative().optional(),
    precio_compra_default: z.number().nonnegative().optional(),
    precio_venta_cliente: z.number().nonnegative().optional(),
    calidad: z.enum(["0.11", "CORRIENTE"]).nullable().optional(),
    activo: z.boolean().optional()
  }).parse(req.body);
  const result = await pool.query(
    `UPDATE sack_inventory
        SET stock_minimo = COALESCE($2, stock_minimo),
            precio_compra_default = COALESCE($3, precio_compra_default),
            precio_venta_cliente = COALESCE($4, precio_venta_cliente),
            calidad = CASE WHEN $5::boolean THEN $6 ELSE calidad END,
            activo = COALESCE($7, activo),
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [req.params.id, body.stock_minimo ?? null, body.precio_compra_default ?? null, body.precio_venta_cliente ?? null,
     body.calidad !== undefined, body.calidad ?? null, body.activo ?? null]
  );
  if (!result.rowCount) throw new ApiError(404, "Saco no encontrado");
  res.json(result.rows[0]);
}));

// Eliminar: si el saco nunca tuvo movimientos se borra; si tiene historial se
// DESACTIVA (conserva su kárdex y deja de aparecer en compras/ventas).
sacksRouter.delete("/:id", asyncRoute(async (req, res) => {
  const ambito = await ambitoSacos(req as AuthenticatedRequest);
  await assertSacosDelAmbito(pool, ambito, [String(req.params.id)]);
  const result = await inTransaction(async (client) => {
    const s = await client.query("SELECT id, tipo, stock FROM sack_inventory WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!s.rowCount) throw new ApiError(404, "Saco no encontrado");
    const movs = await client.query("SELECT 1 FROM sack_movements WHERE sack_id = $1 LIMIT 1", [req.params.id]);
    if (!movs.rowCount && Number(s.rows[0].stock) === 0) {
      await client.query("DELETE FROM sack_inventory WHERE id = $1", [req.params.id]);
      return { tipo: s.rows[0].tipo, resultado: "ELIMINADO" };
    }
    await client.query("UPDATE sack_inventory SET activo = false, updated_at = now() WHERE id = $1", [req.params.id]);
    return { tipo: s.rows[0].tipo, resultado: "DESACTIVADO" };
  });
  res.json(result);
}));

// GET movimientos de un tipo de saco
sacksRouter.get("/:id/movements", asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT sm.*, si.tipo
     FROM sack_movements sm
     JOIN sack_inventory si ON si.id = sm.sack_id
     WHERE sm.sack_id = $1
     ORDER BY sm.created_at DESC
     LIMIT 50`,
    [req.params.id]
  );
  res.json(result.rows);
}));

// GET sacos por comprar: los que piden los pedidos pendientes (aún sin preparar)
// contra el stock de la Matriz, más los que ya están en negativo. Alerta del
// Dashboard: el vendedor nunca queda bloqueado por falta de sacos.
sacksRouter.get("/por-comprar", asyncRoute(async (_req, res) => {
  const client = await pool.connect();
  try {
    res.json(await sacosPorComprar(client));
  } finally {
    client.release();
  }
}));

// GET todos los movimientos recientes
sacksRouter.get("/movements/recent", asyncRoute(async (req, res) => {
  // Por defecto el kárdex de la Matriz; con ?propio=1 el del accionista activo.
  let cond = "si.accionista_id IS NULL";
  const params: unknown[] = [];
  if (req.query.propio === "1") {
    const a = await ambitoSacos(req as AuthenticatedRequest, { exigirManejo: false });
    if (!a.esMatriz) { cond = "si.accionista_id = $1"; params.push(a.accionistaId); }
  }
  const result = await pool.query(
    `SELECT sm.*, si.tipo
     FROM sack_movements sm
     JOIN sack_inventory si ON si.id = sm.sack_id
     WHERE ${cond}
     ORDER BY sm.created_at DESC
     LIMIT 100`,
    params
  );
  res.json(result.rows);
}));

// POST registrar movimiento (entrada o salida)
sacksRouter.post("/movements", asyncRoute(async (req, res) => {
  const ambito = await ambitoSacos(req as AuthenticatedRequest);
  const body = z.object({
    sack_id:  z.string().uuid(),
    movement: z.enum(["ENTRADA", "SALIDA"]),
    cantidad: z.number().int().positive(),
    concepto: z.string().optional(),
    ref_batch: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    await assertSacosDelAmbito(client, ambito, [body.sack_id]);
    // Verificar stock suficiente para salidas
    if (body.movement === "SALIDA") {
      const stock = await client.query(
        "SELECT stock FROM sack_inventory WHERE id = $1 FOR UPDATE",
        [body.sack_id]
      );
      if (Number(stock.rows[0]?.stock ?? 0) < body.cantidad) {
        throw new ApiError(409, `Stock insuficiente. Disponible: ${stock.rows[0]?.stock ?? 0}`);
      }
    }

    // Registrar movimiento
    const mov = await client.query(
      `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_batch)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.sack_id, body.movement, body.cantidad,
       body.concepto ?? null, body.ref_batch ?? null]
    );

    // Actualizar stock
    const delta = body.movement === "ENTRADA" ? body.cantidad : -body.cantidad;
    await client.query(
      "UPDATE sack_inventory SET stock = stock + $2, updated_at = NOW() WHERE id = $1",
      [body.sack_id, delta]
    );

    return mov.rows[0];
  });

  res.status(201).json(result);
}));

// PATCH ajuste manual de stock
sacksRouter.patch("/:id/adjust", asyncRoute(async (req, res) => {
  const ambito = await ambitoSacos(req as AuthenticatedRequest);
  await assertSacosDelAmbito(pool, ambito, [String(req.params.id)]);
  const body = z.object({ stock: z.number().int().nonnegative(), motivo: z.string().trim().max(200).optional() }).parse(req.body);
  // El ajuste también deja su movimiento en el kárdex (ENTRADA/SALIDA por la diferencia): sin eso, el stock y el kárdex
  // dejaban de cuadrar y no se podía saber quién cambió el stock ni por cuánto.
  const result = await inTransaction(async (client) => {
    const actual = await client.query("SELECT stock FROM sack_inventory WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!actual.rowCount) throw new ApiError(404, "Saco no encontrado");
    const antes = Number(actual.rows[0].stock);
    const delta = body.stock - antes;
    if (delta !== 0) {
      await client.query(
        "INSERT INTO sack_movements (sack_id, movement, cantidad, concepto) VALUES ($1, $2, $3, $4)",
        [req.params.id, delta > 0 ? "ENTRADA" : "SALIDA", Math.abs(delta), `Ajuste manual: de ${antes} a ${body.stock}${body.motivo ? ` · ${body.motivo}` : ""}`]
      );
    }
    return (await client.query(
      "UPDATE sack_inventory SET stock = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id, body.stock]
    )).rows[0];
  });
  res.json(result);
}));

// PATCH precio de compra por defecto (tarifa de referencia editable). Exclusivo de
// la matriz (los sacos son inventario de la planta). Solo autocompleta la compra;
// el valor sigue siendo editable línea por línea al comprar.
sacksRouter.patch("/:id/precio", asyncRoute(async (req, res) => {
  const ambito = await ambitoSacos(req as AuthenticatedRequest);
  await assertSacosDelAmbito(pool, ambito, [String(req.params.id)]);
  const body = z.object({ precio_compra_default: z.number().nonnegative() }).parse(req.body);
  const result = await pool.query(
    "UPDATE sack_inventory SET precio_compra_default = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
    [req.params.id, body.precio_compra_default]
  );
  if (!result.rowCount) throw new ApiError(404, "Tipo de saco no encontrado");
  res.json(result.rows[0]);
}));

// ── Compra de sacos ATOMICA (inventario + kardex + caja en UNA transaccion) ──
// Reemplaza las dos llamadas separadas del frontend (que ademas usaban una
// categoria invalida). NO modifica /sacks/movements ni /cash/:id/movements.
sacksRouter.post("/purchases", asyncRoute(async (req, res) => {
  // Compra MÚLTIPLE: recibe un array de ítems (varios tipos de saco). Genera UN
  // solo egreso consolidado en caja por el total y actualiza el stock iterando
  // cada ítem. Se acepta el formato antiguo de un solo saco por compatibilidad.
  const raw = req.body ?? {};
  const single = raw.sack_id
    ? [{ sack_id: raw.sack_id, cantidad: raw.cantidad, precio: raw.precio }]
    : undefined;
  const body = z.object({
    items: z.array(z.object({
      sack_id: z.string().uuid(),
      cantidad: z.number().int().positive(),
      precio: z.number().nonnegative()
    })).min(1),
    cash_register_id: z.string().uuid(),
    concepto: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse({ ...raw, items: raw.items ?? single });

  // Permisos: la compra mueve inventario Y genera egreso de dinero, por eso
  // exige Caja ADEMAS de Inventario/Produccion. El administrador no tiene limite.
  const authReq = req as AuthenticatedRequest;
  const ambito = await ambitoSacos(authReq);
  const user = authReq.user;
  if (!user) throw new ApiError(401, "Sesion requerida");
  const perm = await pool.query(
    `SELECT r.name AS role_name, COALESCE(ua.allowed_modules, '{}') AS mods
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_accionistas ua ON ua.user_id = u.id AND ua.accionista_id = $2
      WHERE u.id = $1`,
    [user.id, authReq.accionistaId ?? null]
  );
  const role = perm.rows[0]?.role_name;
  if (role !== "ADMINISTRADOR") {
    const mods: string[] = perm.rows[0]?.mods ?? [];
    const tieneCaja = mods.includes("Caja");
    const tieneInv = mods.includes("Inventario") || mods.includes("Produccion");
    if (!tieneCaja || !tieneInv) {
      throw new ApiError(403, "La compra de sacos requiere permiso de Caja y de Inventario/Produccion en este accionista.");
    }
  }

  const result = await inTransaction(async (client) => {
    // Aislamiento por accionista: la caja debe pertenecer al accionista ACTIVO
    // del usuario (mismo patron que /cash/payables/:id/pay). Sin esto, un usuario
    // podria cargar el egreso a la caja de otro socio.
    const reg = await client.query(
      "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
      [body.cash_register_id, authReq.accionistaId ?? null]
    );
    if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
    if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");

    // Solo se compran sacos del catálogo del accionista activo (Matriz o socio).
    await assertSacosDelAmbito(client, ambito, body.items.map((i) => i.sack_id));
    // Paso 1: validar + bloquear cada tipo de saco y calcular el total.
    let total = 0;
    const detalle: string[] = [];
    for (const item of body.items) {
      const sack = await client.query("SELECT id, tipo FROM sack_inventory WHERE id = $1 FOR UPDATE", [item.sack_id]);
      if (!sack.rows[0]) throw new ApiError(404, "Tipo de saco no encontrado");
      total = round2(total + round2(item.cantidad * item.precio));
      detalle.push(`${sack.rows[0].tipo} x${item.cantidad} @ $${item.precio}`);
    }

    // Si el egreso deja la caja en negativo, se avisa antes de escribir nada.
    await avisarSobregiro(client, body.cash_register_id, total, req);

    // Paso 2: UN solo egreso consolidado por el total general. Se crea ANTES de
    // los movimientos de kardex para enlazarlos por ref_batch = id del egreso, de
    // modo que anular esta compra en Caja revierta también el inventario.
    const concepto = body.concepto?.trim()
      || (body.items.length > 1 ? "Compra de múltiples sacos" : `Compra de sacos ${detalle[0]}`);
    const cash = await client.query(
      `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
       VALUES ($1, 'EXPENSE', 'COMPRA_SACOS', 'sack_purchase', NULL, $2, $3, $4)
       RETURNING id`,
      [body.cash_register_id, total, `${concepto} — ${detalle.join(", ")}`, body.created_by ?? null]
    );
    const cashId = cash.rows[0].id as string;

    // Paso 3: kardex de ENTRADA (enlazado al egreso) + suma de stock por ítem.
    for (const item of body.items) {
      await client.query(
        `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto, ref_cash_movement)
         VALUES ($1, 'ENTRADA', $2, $3, $4)`,
        [item.sack_id, item.cantidad, `Compra a $${item.precio}/unidad`, cashId]
      );
      await client.query(
        "UPDATE sack_inventory SET stock = stock + $2, updated_at = NOW() WHERE id = $1",
        [item.sack_id, item.cantidad]
      );
    }

    return { monto: total, items: body.items.length, detalle };
  });

  res.status(201).json(result);
}));
