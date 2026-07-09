import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../http/error-handler.js";
import { verifyToken, type AuthUser } from "./jwt.js";

export type AuthenticatedRequest = Request & { user?: AuthUser };

// Módulos asignables a un operador. Deben coincidir con las pestañas del web-admin.
export const APP_MODULES = [
  "Bascula",
  "Secadoras",
  "Produccion",
  "Inventario",
  "Ventas",
  "Caja",
  "Liquidaciones",
  "Fomentos",
  "Agricultores"
] as const;

export type AppModule = (typeof APP_MODULES)[number];

// Qué módulo(s) autorizan a ESCRIBIR en cada prefijo de ruta. Varios módulos
// comparten flujos (p.ej. la venta al detalle de Caja descuenta inventario),
// por eso algunos prefijos aceptan más de un módulo.
const WRITE_MODULES_BY_PREFIX: Record<string, AppModule[]> = {
  "weighing-tickets": ["Bascula"],
  "process-flow": ["Secadoras"],
  "processing-batches": ["Produccion"],
  "inventory": ["Inventario", "Produccion", "Caja"],
  "sacks": ["Inventario", "Produccion", "Caja"],
  "sales": ["Ventas"],
  "customers": ["Ventas"],
  "products": ["Ventas"],
  "receivable": ["Ventas", "Caja"],
  "cash": ["Caja"],
  "expenses": ["Caja"],
  "equipment": ["Caja"],
  "advances": ["Caja"],
  "liquidations": ["Liquidaciones"],
  "fomentos": ["Fomentos", "Caja"],
  "farmers": ["Agricultores"]
};

// Las lecturas son compartidas por todo el equipo; las escrituras se limitan
// a los módulos asignados al usuario. Los administradores no tienen límite.
export function enforceModulePermissions(req: Request, _res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    next(new ApiError(401, "Sesión requerida"));
    return;
  }
  if (user.role_name === "ADMINISTRADOR") {
    next();
    return;
  }
  const prefix = req.path.split("/")[1] ?? "";
  const requiredModules = WRITE_MODULES_BY_PREFIX[prefix];
  if (!requiredModules) {
    next();
    return;
  }
  const allowed = user.allowed_modules ?? [];
  if (requiredModules.some((module) => allowed.includes(module))) {
    next();
    return;
  }
  next(new ApiError(403, `Tu usuario no tiene permiso para registrar cambios en ${requiredModules[0]}. Pide acceso a un administrador.`));
}

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
