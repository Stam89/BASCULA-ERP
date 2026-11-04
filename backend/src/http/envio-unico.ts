import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool.js";
import type { AuthenticatedRequest } from "../auth/require-auth.js";

/**
 * 🔁 ENVÍO ÚNICO: con datos móviles el servidor puede guardar un pago y la respuesta perderse en el camino. La persona
 * ve «sin conexión», vuelve a tocar Guardar y el pago queda doble. Cada envío de la web lleva `X-Envio-Id`; si el mismo
 * id vuelve a llegar, aquí se responde lo mismo que la primera vez y no se ejecuta otra vez.
 *
 * Solo se recuerda lo que salió bien: un error o un aviso por confirmar libera el id y el reintento corre normal.
 * Nunca estorba: sin id, o si esta tabla falla, la petición sigue como siempre.
 */
const FORMATO = /^[A-Za-z0-9_-]{16,64}$/;
const METODOS = new Set(["POST", "PUT", "PATCH"]);
const MAX_RESPUESTA = 1_000_000;
const HORA = 3_600_000;

let ultimaLimpieza = 0;
function limpiarViejos() {
  if (Date.now() - ultimaLimpieza < HORA) return;
  ultimaLimpieza = Date.now();
  pool.query("DELETE FROM envios_recibidos WHERE created_at < now() - interval '2 days'").catch(() => undefined);
}

export async function envioUnicoMiddleware(req: Request, res: Response, next: NextFunction) {
  const id = req.get("x-envio-id");
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!id || !userId || !FORMATO.test(id) || !METODOS.has(req.method)) { next(); return; }
  const ruta = req.originalUrl.split("?")[0];

  let tomado = false;
  try {
    tomado = (await pool.query(
      "INSERT INTO envios_recibidos (id, user_id, metodo, ruta) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [id, userId, req.method, ruta]
    )).rowCount === 1;
    if (!tomado) {
      const previo = (await pool.query(
        `SELECT metodo, ruta, estado_http, respuesta, created_at < now() - interval '5 minutes' AS sin_terminar
           FROM envios_recibidos WHERE id = $1 AND user_id = $2`,
        [id, userId]
      )).rows[0];
      if (previo && previo.metodo === req.method && previo.ruta === ruta) {
        if (previo.estado_http != null) {
          res.locals.envioRepetido = true;
          res.set("X-Envio-Repetido", "1").status(previo.estado_http).send(previo.respuesta ?? undefined);
          return;
        }
        if (!previo.sin_terminar) {
          res.status(409).json({ code: "ENVIO_EN_CURSO", error: "Ese envío todavía se está guardando. Espera un momento y vuelve a tocar Guardar: no se va a repetir." });
          return;
        }
        // Empezó hace rato y nunca terminó (el servidor se reinició a medias): no se sabe si quedó. Lo mira la persona.
        await pool.query("DELETE FROM envios_recibidos WHERE id = $1 AND user_id = $2", [id, userId]);
        res.status(409).json({ code: "ENVIO_SIN_CONFIRMAR", error: "No se pudo confirmar si ese envío quedó guardado (el servidor se reinició). Revisa si ya está; si no, vuelve a tocar Guardar." });
        return;
      }
    }
  } catch (err) {
    console.warn("[envio-unico] sigue sin protección:", err instanceof Error ? err.message : err);
    next();
    return;
  }
  if (!tomado) { next(); return; }
  limpiarViejos();

  const soltar = () => pool.query("DELETE FROM envios_recibidos WHERE id = $1 AND user_id = $2", [id, userId]).catch(() => undefined);
  const recordar = (respuesta: string | null) =>
    pool.query("UPDATE envios_recibidos SET estado_http = $3, respuesta = $4 WHERE id = $1 AND user_id = $2", [id, userId, res.statusCode, respuesta]).catch(() => undefined);

  let resuelto = false;
  const jsonOriginal = res.json.bind(res);
  res.json = (cuerpo: unknown) => {
    if (!resuelto) {
      resuelto = true;
      const texto = res.statusCode >= 200 && res.statusCode < 300 ? JSON.stringify(cuerpo) ?? null : null;
      if (texto == null || texto.length > MAX_RESPUESTA) void soltar();
      else void recordar(texto);
    }
    return jsonOriginal(cuerpo);
  };
  // Respuestas que no son JSON (204, un archivo): se recuerda el estado si salió bien.
  res.on("finish", () => {
    if (resuelto) return;
    resuelto = true;
    if (res.statusCode >= 200 && res.statusCode < 300) void recordar(null);
    else void soltar();
  });
  next();
}
