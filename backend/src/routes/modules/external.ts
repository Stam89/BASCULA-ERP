// API pública/externa para la app de báscula (com.example.bascula). Protegida por
// API Key (no por sesión de usuario): la app la incluye en el header. Se monta
// ANTES del requireAuth global. Solo expone datos de catálogo (agricultores) para
// que la app arme su propio autocomplete y deje de mandar nombres con typos.
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { env } from "../../config/env.js";

export const externalRouter = Router();

// Middleware: exige la API Key en el header 'x-api-key' (o Authorization: ApiKey ...).
function requireApiKey(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers["x-api-key"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const auth = req.headers.authorization ?? "";
  const fromAuth = auth.toLowerCase().startsWith("apikey ") ? auth.slice(7).trim() : "";
  const provided = (fromHeader ?? "").trim() || fromAuth;
  if (!provided || provided !== env.externalApiKey) {
    next(new ApiError(401, "API Key inválida o ausente."));
    return;
  }
  next();
}
externalRouter.use(requireApiKey);

// Lista de agricultores ACTIVOS (id + nombre) para el select/autocomplete de la app.
externalRouter.get("/agricultores", asyncRoute(async (_req, res) => {
  const rows = (await pool.query(
    "SELECT id, full_name AS nombre, identification AS cedula FROM farmers WHERE is_active = true ORDER BY full_name"
  )).rows;
  res.json({ agricultores: rows, total: rows.length });
}));
