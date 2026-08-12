import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { inTransaction } from "../../db/transaction.js";
import { round2 } from "../../utils/rice-formulas.js";
import { type AuthenticatedRequest } from "../../auth/require-auth.js";

export const sacksRouter = Router();

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
  const body = z.object({
    sack_id: z.string().uuid(),
    cantidad: z.number().int().positive(),
    precio: z.number().nonnegative(),
    cash_register_id: z.string().uuid(),
    concepto: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  // Permisos: la compra mueve inventario Y genera egreso de dinero, por eso
  // exige Caja ADEMAS de Inventario/Produccion. El administrador no tiene limite.
  const authReq = req as AuthenticatedRequest;
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
    const sack = await client.query("SELECT id, tipo FROM sack_inventory WHERE id = $1 FOR UPDATE", [body.sack_id]);
    if (!sack.rows[0]) throw new ApiError(404, "Tipo de saco no encontrado");

    // Aislamiento por accionista: la caja debe pertenecer al accionista ACTIVO
    // del usuario (mismo patron que /cash/payables/:id/pay). Sin esto, un usuario
    // podria cargar el egreso a la caja de otro socio.
    const reg = await client.query(
      "SELECT id, status FROM cash_registers WHERE id = $1 AND accionista_id = $2",
      [body.cash_register_id, authReq.accionistaId ?? null]
    );
    if (!reg.rows[0]) throw new ApiError(404, "Caja no disponible para el accionista activo");
    if (reg.rows[0].status !== "OPEN") throw new ApiError(409, "La caja no esta abierta");

    const monto = round2(body.cantidad * body.precio);

    const mov = await client.query(
      `INSERT INTO sack_movements (sack_id, movement, cantidad, concepto)
       VALUES ($1, 'ENTRADA', $2, $3) RETURNING *`,
      [body.sack_id, body.cantidad, body.concepto ?? `Compra a $${body.precio}/unidad`]
    );

    await client.query(
      "UPDATE sack_inventory SET stock = stock + $2, updated_at = NOW() WHERE id = $1",
      [body.sack_id, body.cantidad]
    );

    await client.query(
      `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by)
       VALUES ($1, 'EXPENSE', 'COMPRA_SACOS', 'sack_purchase', $2, $3, $4, $5)`,
      [body.cash_register_id, body.sack_id, monto,
       `Compra de sacos ${sack.rows[0].tipo} (x${body.cantidad} @ $${body.precio})`, body.created_by ?? null]
    );

    return { sack_movement: mov.rows[0], monto, tipo: sack.rows[0].tipo };
  });

  res.status(201).json(result);
}));
