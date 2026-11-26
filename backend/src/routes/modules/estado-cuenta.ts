// 📒 Estado de cuenta (kardex) de un acreedor o deudor de la cuenta activa — ver services/estado-cuenta.ts.
// Solo lee: los cargos se agregan con /deudas-manuales y los abonos con los pagos/cobros de siempre (espejo entre socios incluido).
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import { cuentasSaldadas, estadoDeCuenta } from "../../services/estado-cuenta.js";

export const estadoCuentaRouter = Router();

const accionista = (req: unknown) => {
  const id = (req as AuthenticatedRequest).accionistaId;
  if (!id) throw new ApiError(400, "Elige en «Trabajando en» la cuenta.");
  return id;
};

estadoCuentaRouter.get("/", asyncRoute(async (req, res) => {
  const q = z.object({ lado: z.enum(["CXC", "CXP"]), nombre: z.string().trim().min(1).max(200) }).parse(req.query);
  res.json(await estadoDeCuenta(pool, q.lado, accionista(req), q.nombre));
}));

estadoCuentaRouter.get("/saldadas", asyncRoute(async (req, res) => {
  const q = z.object({ lado: z.enum(["CXC", "CXP"]) }).parse(req.query);
  res.json(await cuentasSaldadas(pool, q.lado, accionista(req)));
}));
