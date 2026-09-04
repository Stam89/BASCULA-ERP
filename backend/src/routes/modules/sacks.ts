import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { inTransaction } from "../../db/transaction.js";
import { round2 } from "../../utils/rice-formulas.js";
import { type AuthenticatedRequest } from "../../auth/require-auth.js";

export const sacksRouter = Router();

// REGLA DE NEGOCIO: solo la MATRIZ (CEYRO / Planta) posee y maneja el stock de
// sacos; los socios operativos no compran ni mueven empaques. Toda ESCRITURA de
// sacos (entradas/salidas/ajustes/compras) debe hacerse bajo el contexto de la
// matriz. Si el accionista activo no es MATRIZ, se rechaza. Las LECTURAS quedan
// abiertas (p. ej. el indicador de stock de la matriz en el reporte de pilado).
async function assertMatriz(req: AuthenticatedRequest): Promise<void> {
  const accionistaId = req.accionistaId ?? null;
  if (!accionistaId) throw new ApiError(400, "Selecciona un accionista antes de continuar.");
  const r = await pool.query("SELECT tipo FROM accionistas WHERE id = $1", [accionistaId]);
  if (r.rows[0]?.tipo !== "MATRIZ") {
    throw new ApiError(
      403,
      "El inventario de sacos es exclusivo de la Matriz (CEYRO / Planta). Cámbiate al contexto de la Matriz para registrar movimientos de empaques."
    );
  }
}

// GET todos los tipos de sacos con stock actual
sacksRouter.get("/", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    "SELECT * FROM sack_inventory ORDER BY tipo"
  );
  res.json(result.rows);
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

// GET todos los movimientos recientes
sacksRouter.get("/movements/recent", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT sm.*, si.tipo
     FROM sack_movements sm
     JOIN sack_inventory si ON si.id = sm.sack_id
     ORDER BY sm.created_at DESC
     LIMIT 100`
  );
  res.json(result.rows);
}));

// POST registrar movimiento (entrada o salida)
sacksRouter.post("/movements", asyncRoute(async (req, res) => {
  await assertMatriz(req as AuthenticatedRequest);
  const body = z.object({
    sack_id:  z.string().uuid(),
    movement: z.enum(["ENTRADA", "SALIDA"]),
    cantidad: z.number().int().positive(),
    concepto: z.string().optional(),
    ref_batch: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
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
  await assertMatriz(req as AuthenticatedRequest);
  const body = z.object({ stock: z.number().int().nonnegative() }).parse(req.body);
  const result = await pool.query(
    "UPDATE sack_inventory SET stock = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
    [req.params.id, body.stock]
  );
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
  await assertMatriz(authReq);
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

    // Paso 1: validar + bloquear cada tipo de saco y calcular el total.
    let total = 0;
    const detalle: string[] = [];
    for (const item of body.items) {
      const sack = await client.query("SELECT id, tipo FROM sack_inventory WHERE id = $1 FOR UPDATE", [item.sack_id]);
      if (!sack.rows[0]) throw new ApiError(404, "Tipo de saco no encontrado");
      total = round2(total + round2(item.cantidad * item.precio));
      detalle.push(`${sack.rows[0].tipo} x${item.cantidad} @ $${item.precio}`);
    }

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
