import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requireAdmin, requireAuth } from "../../auth/require-auth.js";
import { env } from "../../config/env.js";
import { importBasculaTickets } from "./mobile-tickets.js";
import { dentroDelCorteSql, leerCorteBascula, numeroTicketSql } from "../../services/bascula-corte.js";
import { SERIE_EMERGENCIA } from "../../utils/manual-bascula-ticket.js";
import { appPublicada } from "../../services/bascula-app.js";
import {
  createDeviceToken,
  hashDeviceToken,
  informeDeTablet,
  rechazarTabletBloqueada,
  requireBootstrapKey,
  requireDeviceCredential
} from "../../services/bascula-device-auth.js";
import {
  catalogoParaTablet,
  estadosParaTablet,
  noBorradoEnTabletSql,
  registrarEliminadoEnTablet,
  ticketDeLaTabletSql,
  type ResultadoEliminado
} from "../../services/bascula-tablet.js";

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

const registerDeviceSchema = z.object({
  deviceId: z.string().trim().min(8).max(160),
  modelo: z.string().trim().max(120).optional()
});

const deviceStatusSchema = z.object({ activo: z.boolean() });
const firmaQuerySchema = z.object({ firma: z.string().trim().max(64).optional().default("") });
const eliminadosSchema = z.object({
  deviceId: z.string().optional(),
  eliminados: z.array(z.object({
    numeroTicket: z.union([z.string(), z.number()]).transform((v) => String(v)),
    modo: z.string().optional().default("principal"),
    eliminadoEn: z.coerce.number().int().positive()
  })).min(1).max(200)
});
const pullQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional().default(0),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100)
});

function formatTicketNumber(value: number): string {
  const padded = String(Math.max(1, value)).padStart(6, "0");
  return `${padded.slice(0, -3)} ${padded.slice(-3)}`;
}

// POST /api/bascula/register-device
// Alta/rotacion de una credencial individual. La clave compartida se usa solo
// para autorizar este paso de transicion; el token plano nunca se guarda en DB.
basculaSyncRouter.post("/register-device", asyncRoute(async (req, res) => {
  requireBootstrapKey(req);
  const body = registerDeviceSchema.parse(req.body);
  // Una tablet bloqueada por el administrador no se reactiva sola volviendo a registrarse.
  await rechazarTabletBloqueada(body.deviceId);
  const token = createDeviceToken();
  const alta = await pool.query(
    `INSERT INTO bascula_devices (device_id, token_hash, modelo, last_seen_at, app_version)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (device_id) DO UPDATE
       SET token_hash = EXCLUDED.token_hash,
           modelo = EXCLUDED.modelo,
           app_version = COALESCE(EXCLUDED.app_version, bascula_devices.app_version),
           updated_at = now(),
           last_seen_at = now()
       WHERE bascula_devices.activo`,
    [body.deviceId, hashDeviceToken(token), body.modelo || null, informeDeTablet(req).version]
  );
  if (!alta.rowCount) await rechazarTabletBloqueada(body.deviceId);
  res.status(201).json({ ok: true, deviceId: body.deviceId, token });
}));

// POST /api/bascula/sync
// Recibe los tickets de la tablet por red local e inserta/actualiza en
// PostgreSQL con la MISMA lógica que Firebase. Idempotente.
basculaSyncRouter.post("/sync", asyncRoute(async (req, res) => {
  await requireDeviceCredential(req);

  const body = syncBodySchema.parse(req.body);
  const deviceId = body.deviceId?.trim() || "wifi-directo";
  const result = await importBasculaTickets(body.tickets, deviceId, {
    enEspera: body.enEspera ?? false
  });

  // serverTime: la tablet compara su reloj con el del ERP y avisa si está mal puesto.
  res.status(201).json({ ok: true, via: "wifi-directo", serverTime: Date.now(), ...result });
}));

// POST /api/bascula/eliminados
// Pesajes EN ESPERA que se borraron en la tablet: salen de pendientes (reversible). Nunca toca lo ingresado o completo.
basculaSyncRouter.post("/eliminados", asyncRoute(async (req, res) => {
  await requireDeviceCredential(req);
  const body = eliminadosSchema.parse(req.body);
  const resultados: Array<{ numeroTicket: string; resultado: ResultadoEliminado }> = [];
  for (const item of body.eliminados) {
    if (item.modo.trim().toLowerCase() !== "principal") {
      resultados.push({ numeroTicket: item.numeroTicket, resultado: "no_existe" });
      continue;
    }
    const cuando = new Intl.DateTimeFormat("es-EC", {
      timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date(Math.min(item.eliminadoEn, Date.now())));
    const resultado = await inTransaction((client) => registrarEliminadoEnTablet(client, item, cuando));
    resultados.push({ numeroTicket: item.numeroTicket, resultado });
  }
  res.json({ ok: true, serverTime: Date.now(), resultados });
}));

// GET /api/bascula/estados
// En qué quedó cada ticket de la tablet dentro del ERP. Con la misma firma no se vuelve a descargar nada.
basculaSyncRouter.get("/estados", asyncRoute(async (req, res) => {
  await requireDeviceCredential(req);
  const { firma } = firmaQuerySchema.parse(req.query);
  const actual = await estadosParaTablet(pool);
  res.json(actual.firma === firma
    ? { ok: true, igual: true, firma, serverTime: Date.now() }
    : { ok: true, serverTime: Date.now(), ...actual });
}));

// GET /api/bascula/catalogo
// Nombres de los agricultores registrados (y sus otros nombres), para que la tablet los sugiera tal como están en el ERP.
basculaSyncRouter.get("/catalogo", asyncRoute(async (req, res) => {
  await requireDeviceCredential(req);
  const { firma } = firmaQuerySchema.parse(req.query);
  const actual = await catalogoParaTablet(pool);
  res.json(actual.firma === firma ? { ok: true, igual: true, firma } : { ok: true, ...actual });
}));

// GET /api/bascula/app y /app/apk
// Versión vigente de la app de la tablet y su instalador. Piden la credencial de la tablet.
basculaSyncRouter.get("/app", asyncRoute(async (req, res) => {
  await requireDeviceCredential(req);
  const app = appPublicada();
  if (!app) { res.json({ ok: true, disponible: false }); return; }
  const { versionCode, versionName, sha256, notes, tamano } = app;
  res.json({ ok: true, disponible: true, versionCode, versionName, sha256, notes, tamano });
}));
basculaSyncRouter.get("/app/apk", asyncRoute(async (req, res) => {
  await requireDeviceCredential(req);
  const app = appPublicada();
  if (!app) throw new ApiError(404, "No hay una versión publicada de la app.");
  res.sendFile(app.ruta, { headers: { "Content-Type": "application/vnd.android.package-archive", "Cache-Control": "no-store" } });
}));

// GET /api/bascula/pull
// Retorno incremental ERP → tablet, limitado a tickets nacidos manualmente en
// el ERP. No consulta Firebase ni devuelve el historial completo en cada ciclo.
// La tablet los fusiona por (modo, número) y nunca reemplaza un ticket local
// diferente: una colisión se conserva para revisión humana.
// La serie de emergencia (900 001+) NO se envía: la tablet numera con «el mayor + 1» y seguiría en 900 002.
basculaSyncRouter.get("/pull", asyncRoute(async (req, res) => {
  await requireDeviceCredential(req);
  const query = pullQuerySchema.parse(req.query);
  const result = await pool.query<{
    raw_payload: unknown;
    en_espera: boolean;
    mobile_updated_at: string;
  }>(
    `SELECT raw_payload, en_espera, mobile_updated_at::text
       FROM mobile_synced_tickets t
      WHERE raw_payload->>'origen' = 'ERP_MANUAL'
        AND ${ticketDeLaTabletSql("t")}
        AND mobile_updated_at > $1::bigint
      ORDER BY mobile_updated_at ASC, id ASC
      LIMIT $2`,
    [query.after, query.limit]
  );
  const watermark = result.rows.reduce(
    (max, row) => Math.max(max, Number(row.mobile_updated_at) || 0),
    query.after
  );
  res.json({
    ok: true,
    tickets: result.rows.map((row) => ({ ticket: row.raw_payload, enEspera: row.en_espera })),
    watermark,
    hasMore: result.rows.length === query.limit
  });
}));

// GET /api/bascula/restore
// Recupera el respaldo del negocio guardado en esta instalación del ERP. Se protege con la
// misma clave del dispositivo y entrega el payload nativo para poder reconstruir
// Room después de una desinstalación, sin depender de la cuota de Firebase.
basculaSyncRouter.get("/restore", asyncRoute(async (req, res) => {
  await requireDeviceCredential(req);
  // Los 5 000 más nuevos, sin la serie de emergencia ni lo que la propia tablet borró.
  const result = await pool.query<{ raw_payload: unknown; en_espera: boolean }>(
    `SELECT raw_payload, en_espera FROM (
       SELECT raw_payload, en_espera, mobile_updated_at, synced_at
         FROM mobile_synced_tickets t
        WHERE COALESCE(${numeroTicketSql("t")}, 0) <= ${SERIE_EMERGENCIA} AND ${noBorradoEnTabletSql("t")}
        ORDER BY mobile_updated_at DESC, synced_at DESC
        LIMIT 5000
     ) x ORDER BY mobile_updated_at ASC, synced_at ASC`
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
  await requireDeviceCredential(req);
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
          -- La serie de emergencia 900 001+ no es de la tablet: no se corre (900 001 quedaría en 900 000).
          AND COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '0'), ''), '0')::bigint <= ${SERIE_EMERGENCIA}
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
  await requireDeviceCredential(req);
  const result = await pool.query<{ principal_count: number; last_updated: string | null }>(
    `SELECT count(*) FILTER (
              WHERE lower(coalesce(raw_payload->>'modo', 'principal')) = 'principal'
            )::int AS principal_count,
            max(mobile_updated_at)::text AS last_updated
       FROM mobile_synced_tickets t
      WHERE COALESCE(${numeroTicketSql("t")}, 0) <= ${SERIE_EMERGENCIA} AND ${noBorradoEnTabletSql("t")}`
  );

  res.json({
    ok: true,
    serverTime: Date.now(),
    principalCount: result.rows[0]?.principal_count ?? 0,
    lastUpdated: result.rows[0]?.last_updated ?? null
  });
}));

// GET /api/bascula/discover
// Respuesta mínima para que la tablet pueda encontrar el ERP si cambia la IP.
// La clave evita confundir otro servicio del puerto 4000 con este servidor.
basculaSyncRouter.get("/discover", asyncRoute(async (req, res) => {
  const auth = await requireDeviceCredential(req);
  res.json({ ok: true, service: "BASCULA-ERP", version: 3, auth: auth.mode, serverTime: Date.now() });
}));

// Administracion web. Nunca devuelve token_hash ni borra historial: bloquear
// una tablet solo invalida su credencial individual y es reversible.
basculaSyncRouter.get("/devices", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT device_id, modelo, activo, created_at, updated_at, last_seen_at, app_version, pendientes
       FROM bascula_devices
      ORDER BY activo DESC, last_seen_at DESC NULLS LAST, created_at DESC`
  );
  res.json(result.rows);
}));

basculaSyncRouter.patch("/devices/:deviceId", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const deviceId = z.string().trim().min(8).max(160).parse(req.params.deviceId);
  const body = deviceStatusSchema.parse(req.body);
  const result = await pool.query(
    `UPDATE bascula_devices
        SET activo = $2, updated_at = now()
      WHERE device_id = $1
      RETURNING device_id, modelo, activo, created_at, updated_at, last_seen_at, app_version, pendientes`,
    [deviceId, body.activo]
  );
  if (!result.rowCount) throw new ApiError(404, "La tablet indicada no esta registrada.");
  res.json(result.rows[0]);
}));

// GET /api/bascula/status
// Alimenta el mini-dashboard de conexión del panel web (Estado ERP, Pendientes,
// Último envío). Requiere sesión (lo consume el admin autenticado). Solo lectura
// y agregados; no toca ni bloquea la tabla.
basculaSyncRouter.get("/status", requireAuth, asyncRoute(async (_req, res) => {
  const corte = await leerCorteBascula();
  const [pend, last, tablet] = await Promise.all([
    // "Pendiente" = pesaje del modo principal que aún no se ingresó como materia
    // prima ni se liquidó (mismo criterio que la lista de la vista Báscula,
    // incluido el corte «Contar tickets desde»).
    pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM mobile_synced_tickets t
        WHERE t.liquidated_at IS NULL
          AND t.weighing_ticket_id IS NULL
          AND lower(coalesce(t.raw_payload->>'modo', 'principal')) = 'principal'
          AND ${dentroDelCorteSql("t", "$1", "$2")}`,
      [corte.numero, corte.desde]
    ),
    pool.query<{ t: string | null }>(
      "SELECT max(synced_at) AS t FROM mobile_synced_tickets"
    ),
    // La tablet que se comunicó de último: cuándo, con qué versión y cuántos tickets le faltan por enviar.
    pool.query<{ modelo: string | null; app_version: string | null; pendientes: number | null; last_seen_at: string | null }>(
      `SELECT modelo, app_version, pendientes, last_seen_at FROM bascula_devices
        WHERE activo ORDER BY last_seen_at DESC NULLS LAST LIMIT 1`
    )
  ]);

  res.json({
    ok: true,
    pendientes: pend.rows[0]?.n ?? 0,
    ultimoEnvio: last.rows[0]?.t ?? null,
    tablet: tablet.rows[0] ?? null,
    deviceKeyRequerida: Boolean(env.deviceSyncKey)
  });
}));
