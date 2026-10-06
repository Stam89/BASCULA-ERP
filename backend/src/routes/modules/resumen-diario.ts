import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { correoConfigurado } from "../../services/correo.js";
import { HORA_RE, armarResumenDelDia, enviarResumen, leerConfig, normalizarDestinatarios } from "../../services/resumen-diario.js";

// 📬 Resumen diario por correo (solo administrador). NACE APAGADO: no se envía nada
// hasta que se active aquí y se elijan los correos. El envío automático lo hace el
// programador del servidor (services/resumen-diario.ts); estas rutas solo lo configuran,
// muestran un ejemplo y mandan una prueba.
export const resumenDiarioRouter = Router();
resumenDiarioRouter.use(requireAdmin);

const estado = async () => {
  const c = await leerConfig();
  const r = (await pool.query("SELECT ultimo_envio_at, ultimo_resultado FROM resumen_diario_config WHERE id = 1")).rows[0] ?? {};
  return {
    activo: c?.activo ?? false,
    hora: c?.hora ?? "20:30",
    destinatarios: c?.destinatarios ?? [],
    ultimo_envio_at: r.ultimo_envio_at ?? null,
    ultimo_resultado: r.ultimo_resultado ?? null,
    correo_configurado: correoConfigurado()
  };
};

resumenDiarioRouter.get("/config", asyncRoute(async (_req, res) => { res.json(await estado()); }));

resumenDiarioRouter.put("/config", asyncRoute(async (req, res) => {
  const body = z.object({
    activo: z.boolean(),
    hora: z.string().regex(HORA_RE, "La hora debe ser HH:MM (por ejemplo 20:30)."),
    destinatarios: z.array(z.string().max(160)).max(10)
  }).parse(req.body);
  let destinatarios: string[];
  try { destinatarios = normalizarDestinatarios(body.destinatarios); } catch (e) { throw new ApiError(400, (e as Error).message); }
  if (body.activo && destinatarios.length === 0) throw new ApiError(400, "Para activar el resumen escribe al menos un correo de destino.");
  if (body.activo && !correoConfigurado()) throw new ApiError(400, "El servidor aún no puede enviar correos (falta SMTP_USER / SMTP_PASS en backend/.env).");
  const user = (req as AuthenticatedRequest).user;
  await pool.query(
    `UPDATE resumen_diario_config
        SET activo = $1, hora = $2, destinatarios = $3::text[], updated_at = now(), updated_by = $4,
            -- al cambiar la configuración se reinician los reintentos de hoy (no el último envío exitoso)
            intentos_hoy = 0, ultimo_intento_at = NULL
      WHERE id = 1`,
    [body.activo, body.hora, destinatarios, user?.id ?? null]
  );
  res.json(await estado());
}));

// Ejemplo con los datos de HOY (no envía nada).
resumenDiarioRouter.get("/vista", asyncRoute(async (_req, res) => {
  const r = await armarResumenDelDia();
  res.json({ asunto: r.asunto, texto: r.texto, html: r.html });
}));

// Prueba: manda AHORA el resumen de hoy a los correos indicados (o a los guardados). No cuenta como el
// envío del día. Con pausa de 60 s para evitar clics repetidos.
let ultimaPrueba = 0;
resumenDiarioRouter.post("/prueba", asyncRoute(async (req, res) => {
  if (!correoConfigurado()) throw new ApiError(503, "Falta configurar SMTP_USER y SMTP_PASS en backend/.env y reiniciar el servidor.");
  const body = z.object({ destinatarios: z.array(z.string().max(160)).max(10).optional() }).parse(req.body ?? {});
  let destinos: string[];
  try { destinos = normalizarDestinatarios(body.destinatarios ?? (await leerConfig())?.destinatarios ?? []); } catch (e) { throw new ApiError(400, (e as Error).message); }
  if (destinos.length === 0) throw new ApiError(400, "Escribe primero al menos un correo de destino.");
  const espera = 60_000 - (Date.now() - ultimaPrueba);
  if (espera > 0) throw new ApiError(429, `Espera ${Math.ceil(espera / 1000)} segundos antes de enviar otra prueba.`);
  ultimaPrueba = Date.now();
  try {
    const r = await enviarResumen(destinos);
    res.json({ ok: true, enviado_a: destinos, asunto: r.asunto });
  } catch (e) {
    ultimaPrueba = 0;
    throw new ApiError(502, `No se pudo enviar el correo: ${(e as Error).message.slice(0, 200)}`);
  }
}));
