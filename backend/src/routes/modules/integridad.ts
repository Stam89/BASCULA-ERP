import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../http/async-route.js";
import { requireAdmin } from "../../auth/require-auth.js";
import { consistenciaReciente } from "../../services/consistencia.js";

// 🩺 Control de integridad (solo administrador): revisa que los módulos estén bien conectados entre sí.
// Solo lee; nunca corrige nada. `?forzar=1` ignora el resultado reciente (10 min) y vuelve a revisar.
export const integridadRouter = Router();
integridadRouter.use(requireAdmin);

integridadRouter.get("/", asyncRoute(async (req, res) => {
  const q = z.object({ forzar: z.enum(["0", "1"]).optional() }).parse(req.query);
  const r = await consistenciaReciente(10 * 60_000, q.forzar === "1");
  res.json({ ...r, ok: r.hallazgos.filter((h) => !h.error).length === 0 });
}));
