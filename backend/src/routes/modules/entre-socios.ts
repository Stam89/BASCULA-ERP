import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";
import {
  anularDineroEntreSocios, historialEntreSocios, registrarDineroEntreSocios, resumenCuentasEntreSocios
} from "../../services/entre-socios.js";

// 🤝 CUENTAS ENTRE SOCIOS (pedido del dueño 2026-10-21): quién le debe a quién entre la Matriz y los socios, por
// concepto, con su saldo único; dinero que se dan (abono o préstamo, mueve las DOS cajas) e historial.
export const entreSociosRouter = Router();

/** Accionistas que el usuario puede ver (el administrador, todos). */
async function visibles(req: AuthenticatedRequest): Promise<string[]> {
  if (req.user?.role_name === "ADMINISTRADOR") {
    return (await pool.query("SELECT id FROM accionistas WHERE is_active = true")).rows.map((r) => r.id as string);
  }
  return (await pool.query("SELECT accionista_id FROM user_accionistas WHERE user_id = $1", [req.user?.id ?? null])).rows.map((r) => r.accionista_id as string);
}

entreSociosRouter.get("/cuentas", asyncRoute(async (req, res) => {
  res.json(await resumenCuentasEntreSocios(pool, await visibles(req as AuthenticatedRequest)));
}));

entreSociosRouter.get("/historial", asyncRoute(async (req, res) => {
  const r = req as AuthenticatedRequest;
  const q = z.object({ con: z.string().uuid(), de: z.string().uuid().optional() }).parse(req.query);
  const a = q.de ?? r.accionistaId;
  if (!a) throw new ApiError(400, "Elige el socio.");
  const ok = await visibles(r);
  if (!ok.includes(a) || !ok.includes(q.con)) throw new ApiError(403, "No tienes acceso a las cuentas de ese socio.");
  res.json(await historialEntreSocios(pool, a, q.con));
}));

// 💵 Un socio le da dinero a otro (abono a lo que le debe o préstamo). Uno de los dos debe ser el accionista activo
// (se registra desde su caja); el usuario necesita acceso a los dos (el administrador, a todos).
entreSociosRouter.post("/dinero", asyncRoute(async (req, res) => {
  const r = req as AuthenticatedRequest;
  const body = z.object({
    de_id: z.string().uuid(),
    para_id: z.string().uuid(),
    monto: z.number().positive().max(10_000_000),
    nota: z.string().trim().max(200).optional(),
    medio_pago: z.enum(["EFECTIVO", "BANCO"]).optional()
  }).parse(req.body);
  if (r.accionistaId !== body.de_id && r.accionistaId !== body.para_id) {
    throw new ApiError(400, "Registra el dinero desde la caja de uno de los dos socios.");
  }
  const ok = await visibles(r);
  if (!ok.includes(body.de_id) || !ok.includes(body.para_id)) throw new ApiError(403, "No tienes acceso a la caja de uno de los dos socios.");
  const out = await inTransaction((client) => registrarDineroEntreSocios(client, req, {
    deId: body.de_id, paraId: body.para_id, monto: body.monto, nota: body.nota ?? null,
    userId: r.user?.id ?? null, actorId: r.accionistaId ?? null
  }));
  res.status(201).json(out);
}));

entreSociosRouter.post("/dinero/:id/anular", requireAdmin, asyncRoute(async (req, res) => {
  const r = req as AuthenticatedRequest;
  const { motivo } = z.object({ motivo: z.string().trim().min(3).max(200) }).parse(req.body);
  await inTransaction((client) => anularDineroEntreSocios(client, { id: String(req.params.id), motivo, userId: r.user?.id ?? null }));
  res.json({ ok: true });
}));
