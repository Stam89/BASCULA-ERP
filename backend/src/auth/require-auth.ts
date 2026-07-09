import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../http/error-handler.js";
import { verifyToken, type AuthUser } from "./jwt.js";

export type AuthenticatedRequest = Request & { user?: AuthUser };

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;
  if (!user || user.role_name !== "ADMINISTRADOR") {
    next(new ApiError(403, "Esta acción requiere rol de administrador."));
    return;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(new ApiError(401, "Sesión requerida. Inicia sesión para continuar."));
    return;
  }

  try {
    (req as AuthenticatedRequest).user = verifyToken(header.slice("Bearer ".length));
    next();
  } catch {
    next(new ApiError(401, "Sesión expirada o inválida. Inicia sesión nuevamente."));
  }
}
