import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAuth } from "../../auth/require-auth.js";
import { env } from "../../config/env.js";
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

function requireDeviceKey(req: { headers: Record<string, unknown> }): void {
  const expected = env.deviceSyncKey;
  const provided = req.headers["x-device-key"];
  if (!expected || provided !== expected) {
    throw new ApiError(401, "Dispositivo no autorizado para sincronizar tickets.");
  }
}

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

const deleteRenumberSchema = z.object({
  numeroTicket: z.coerce.number().int().positive(),
  modo: z.enum(["principal", "particular"]).default("principal")
});

function formatTicketNumber(value: number): string {
  const padded = String(Math.max(1, value)).padStart(6, "0");
  return `${padded.slice(0, -3)} ${padded.slice(-3)}`;
}

// POST /api/bascula/sync
// Recibe los tickets de la tablet por red local e inserta/actualiza en
// PostgreSQL con la MISMA lógica que Firebase. Idempotente.
basculaSyncRouter.post("/sync", asyncRoute(async (req, res) => {
  requireDeviceKey(req);

  const body = syncBodySchema.parse(req.body);
  const deviceId = body.deviceId?.trim() || "wifi-directo";
  const result = await importBasculaTickets(body.tickets, deviceId, {
    enEspera: body.enEspera ?? false
  });

  res.status(201).json({ ok: true, via: "wifi-directo", ...result });
}));

// GET /api/bascula/restore
// Recupera el respaldo del negocio guardado en esta instalación del ERP. Se protege con la
// misma clave del dispositivo y entrega el payload nativo para poder reconstruir
// Room después de una desinstalación, sin depender de la cuota de Firebase.
basculaSyncRouter.get("/restore", asyncRoute(async (req, res) => {
  requireDeviceKey(req);
  const result = await pool.query<{ raw_payload: unknown; en_espera: boolean }>(
    `SELECT raw_payload, en_espera
       FROM mobile_synced_tickets
      ORDER BY mobile_updated_at ASC, synced_at ASC
      LIMIT 5000`
  );

  res.json({
    ok: true,
    tickets: result.rows.map((row) => ({
      ticket: row.raw_payload,
      enEspera: row.en_espera
    }))
  });
}));

// Elimina un duplicado confirmado por el administrador de la tablet y cierra
// el hueco numerico. Todo ocurre en una sola transaccion. El ticket eliminado
// se protege si ya participa en una operacion contable; los posteriores solo
// cambian su numero visible y conservan su id/enlaces internos.
basculaSyncRouter.post("/delete-and-renumber", asyncRoute(async (req, res) => {
  requireDeviceKey(req);
  const body = deleteRenumberSchema.parse(req.body);

  const result = await inTransaction(async (client) => {
    const rows = await client.query<{
      id: string;
      numero: string;
      weighing_ticket_id: string | null;
      liquidated_at: Date | null;
    }>(
      `SELECT id,
              COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '0'), ''), '0') AS numero,
              weighing_ticket_id,
              liquidated_at
         FROM mobile_synced_tickets
        WHERE COALESCE(NULLIF(raw_payload->>'firebaseNegocioId', ''), 'principal') = 'principal'
          AND lower(COALESCE(NULLIF(raw_payload->>'modo', ''), 'principal')) = $1
          AND COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '0'), ''), '0')::bigint >= $2
        ORDER BY COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '0'), ''), '0')::bigint ASC
        FOR UPDATE`,
      [body.modo, body.numeroTicket]
    );

    const target = rows.rows.find((row) => Number(row.numero) === body.numeroTicket);
    if (!target) {
      throw new ApiError(404, `No existe el ticket ${formatTicketNumber(body.numeroTicket)} en el ERP.`);
    }
    if (target.weighing_ticket_id || target.liquidated_at) {
      throw new ApiError(409, "Ese ticket ya fue usado en una operacion del ERP y no se puede eliminar.");
    }
    const advances = await client.query(
      "SELECT 1 FROM mobile_advance_applications WHERE ticket_id = $1 LIMIT 1",
      [target.id]
    );
    if (advances.rowCount) {
      throw new ApiError(409, "Ese ticket tiene anticipos aplicados y no se puede eliminar.");
    }

    const later = rows.rows.filter((row) => Number(row.numero) > body.numeroTicket);
    await client.query("DELETE FROM mobile_synced_tickets WHERE id = $1", [target.id]);

    if (later.length > 0) {
      await client.query(
        `UPDATE mobile_synced_tickets
            SET raw_payload = raw_payload - 'numeroTicket'
          WHERE id = ANY($1::uuid[])`,
        [later.map((row) => row.id)]
      );
    }

    const changedAt = Date.now();
    const renumbered: Array<{ from: string; to: string }> = [];
    for (let index = 0; index < later.length; index++) {
      const row = later[index];
      const oldNumber = Number(row.numero);
      const newNumber = oldNumber - 1;
      await client.query(
        `UPDATE mobile_synced_tickets
            SET raw_payload = jsonb_set(
                  jsonb_set(raw_payload, '{numeroTicket}', to_jsonb($2::text), true),
                  '{renumeradoDesde}', to_jsonb($3::text), true
                ),
                mobile_updated_at = GREATEST(mobile_updated_at + 1, $4),
                synced_at = now()
          WHERE id = $1`,
        [row.id, formatTicketNumber(newNumber), formatTicketNumber(oldNumber), changedAt + index]
      );
      renumbered.push({ from: formatTicketNumber(oldNumber), to: formatTicketNumber(newNumber) });
    }

    return {
      deleted: formatTicketNumber(body.numeroTicket),
      renumbered,
      previousLastNumber: later.length > 0 ? Number(later[later.length - 1].numero) : body.numeroTicket
    };
  });

  res.json({ ok: true, ...result });
}));

// GET /api/bascula/sync-state
// Consulta liviana para que una tablet con datos detecte un ERP recien restaurado
// o vacio y pueda volver a publicar su historial sin descargar todos los payloads.
basculaSyncRouter.get("/sync-state", asyncRoute(async (req, res) => {
  requireDeviceKey(req);
  const result = await pool.query<{ principal_count: number; last_updated: string | null }>(
    `SELECT count(*) FILTER (
              WHERE lower(coalesce(raw_payload->>'modo', 'principal')) = 'principal'
            )::int AS principal_count,
            max(mobile_updated_at)::text AS last_updated
       FROM mobile_synced_tickets`
  );

  res.json({
    ok: true,
    principalCount: result.rows[0]?.principal_count ?? 0,
    lastUpdated: result.rows[0]?.last_updated ?? null
  });
}));

// GET /api/bascula/discover
// Respuesta mínima para que la tablet pueda encontrar el ERP si cambia la IP.
// La clave evita confundir otro servicio del puerto 4000 con este servidor.
basculaSyncRouter.get("/discover", asyncRoute(async (req, res) => {
  requireDeviceKey(req);
  res.json({ ok: true, service: "BASCULA-ERP", version: 1 });
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
    deviceKeyRequerida: Boolean(env.deviceSyncKey)
  });
}));
