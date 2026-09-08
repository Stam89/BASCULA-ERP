import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAuth } from "../../auth/require-auth.js";
import { importBasculaTickets } from "./mobile-tickets.js";

// ─────────────────────────────────────────────────────────────────────────────
// SINCRONIZACIÓN DIRECTA POR WiFi (tablet de báscula → ERP en la red local).
//
// ARQUITECTURA EN PARALELO (shadowing): esta vía CONVIVE con la importación
// automática desde Firebase (integrations/bascula-firebase.ts + el setInterval
// de server.ts). NO la reemplaza ni la altera. Ambos caminos:
//   • Reutilizan EXACTAMENTE la misma lógica de base de datos:
//     importBasculaTickets() de mobile-tickets.ts.
//   • Escriben en la MISMA tabla: mobile_synced_tickets.
//   • Son idempotentes (mismo numeroTicket ⇒ mismo registro), así que un ticket
//     que llegue por WiFi y luego por Firebase (o al revés) no se duplica.
//
// La tablet no maneja sesiones; por eso /sync queda abierto. Si el .env define
// DEVICE_SYNC_KEY, se exige ese valor en el header X-Device-Key (mismo secreto
// que ya usa el /sync legado), de modo que nadie en la red pueda inyectar
// tickets falsos.
// ─────────────────────────────────────────────────────────────────────────────

export const basculaSyncRouter = Router();

const deviceSyncKey = process.env.DEVICE_SYNC_KEY;

// El cuerpo llega en el formato NATIVO de la app de báscula. No validamos aquí
// cada campo: importBasculaTickets() ya valida ticket por ticket con su propio
// esquema (basculaTicketSchema), así que solo exigimos un arreglo no vacío.
const syncBodySchema = z.object({
  deviceId: z.string().optional(),
  // Pesajes que aún esperan el 2º pesaje (equivalente a la colección
  // "ticketsEnEspera" de Firebase). Por defecto, tickets completos.
  enEspera: z.boolean().optional(),
  tickets: z.array(z.unknown()).min(1, "Envía al menos un ticket.")
});

// POST /api/bascula/sync
// Recibe los tickets de la tablet por red local e inserta/actualiza en
// PostgreSQL con la MISMA lógica que Firebase. Idempotente.
basculaSyncRouter.post("/sync", asyncRoute(async (req, res) => {
  if (deviceSyncKey) {
    const provided = req.headers["x-device-key"];
    if (provided !== deviceSyncKey) {
      throw new ApiError(401, "Dispositivo no autorizado para sincronizar tickets.");
    }
  }

  const body = syncBodySchema.parse(req.body);
  const deviceId = body.deviceId?.trim() || "wifi-directo";
  const result = await importBasculaTickets(body.tickets, deviceId, {
    enEspera: body.enEspera ?? false
  });

  res.status(201).json({ ok: true, via: "wifi-directo", ...result });
}));

// GET /api/bascula/status
// Alimenta el mini-dashboard de conexión del panel web (Estado ERP, Pendientes,
// Último envío). Requiere sesión (lo consume el admin autenticado). Solo lectura
// y agregados; no toca ni bloquea la tabla.
basculaSyncRouter.get("/status", requireAuth, asyncRoute(async (_req, res) => {
  const [pend, last] = await Promise.all([
    // "Pendiente" = pesaje del modo principal que aún no se ingresó como materia
    // prima ni se liquidó (mismo criterio que la lista de la vista Báscula).
    pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM mobile_synced_tickets
        WHERE liquidated_at IS NULL
          AND weighing_ticket_id IS NULL
          AND lower(coalesce(raw_payload->>'modo', 'principal')) = 'principal'`
    ),
    pool.query<{ t: string | null }>(
      "SELECT max(synced_at) AS t FROM mobile_synced_tickets"
    )
  ]);

  res.json({
    ok: true,
    pendientes: pend.rows[0]?.n ?? 0,
    ultimoEnvio: last.rows[0]?.t ?? null,
    deviceKeyRequerida: Boolean(deviceSyncKey)
  });
}));
