import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { ApiError } from "../http/error-handler.js";

type DeviceRequest = { headers: Record<string, unknown> };

function header(req: DeviceRequest, name: string): string {
  const value = req.headers[name];
  return typeof value === "string" ? value.trim() : "";
}

export function hashDeviceToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function createDeviceToken(): string {
  return `bdt_${crypto.randomBytes(32).toString("base64url")}`;
}

export function isBootstrapKey(provided: string): boolean {
  const expected = env.deviceSyncKey;
  if (!expected || !provided || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export function requireBootstrapKey(req: DeviceRequest): void {
  if (!isBootstrapKey(header(req, "x-device-key"))) {
    throw new ApiError(401, "Clave de instalacion no autorizada.");
  }
}

/** 403 si el administrador bloqueó esa tablet: ni la clave de instalación ni un registro nuevo la destraban. */
export async function rechazarTabletBloqueada(deviceId: string | null): Promise<void> {
  if (!deviceId) return;
  const r = await pool.query<{ activo: boolean }>("SELECT activo FROM bascula_devices WHERE device_id = $1", [deviceId]);
  if (r.rowCount && !r.rows[0].activo) {
    throw new ApiError(403, "Esta tablet está bloqueada en el ERP. El administrador la reactiva en Configuración, Estado del sistema.");
  }
}

/** Lo que la tablet informa de sí misma (las versiones anteriores no mandan nada y queda vacío). */
export function informeDeTablet(req: DeviceRequest): { version: string | null; pendientes: number | null } {
  const version = header(req, "x-app-version").slice(0, 20) || null;
  const n = /^\d{1,5}$/.test(header(req, "x-pendientes")) ? Number(header(req, "x-pendientes")) : null;
  return { version, pendientes: n };
}

export async function requireDeviceCredential(req: DeviceRequest): Promise<{
  mode: "legacy" | "device";
  deviceId: string | null;
}> {
  const provided = header(req, "x-device-key");
  const deviceId = header(req, "x-device-id");

  // Compatibilidad controlada: APK anteriores siguen funcionando durante la
  // migracion, y la misma clave permite dar de alta una instalacion nueva.
  if (isBootstrapKey(provided)) {
    await rechazarTabletBloqueada(deviceId || null);
    return { mode: "legacy", deviceId: deviceId || null };
  }

  if (!provided || !deviceId) {
    throw new ApiError(401, "Dispositivo no autorizado para sincronizar tickets.");
  }
  const informe = informeDeTablet(req);
  const result = await pool.query<{ device_id: string }>(
    `UPDATE bascula_devices
        SET last_seen_at = now(),
            app_version = COALESCE($3, app_version),
            pendientes = COALESCE($4, pendientes)
      WHERE device_id = $1
        AND token_hash = $2
        AND activo = true
      RETURNING device_id`,
    [deviceId, hashDeviceToken(provided), informe.version, informe.pendientes]
  );
  if (!result.rowCount) {
    // 403 = bloqueada a propósito (no debe volver a registrarse sola); 401 = credencial vieja o cambiada (sí puede).
    await rechazarTabletBloqueada(deviceId);
    throw new ApiError(401, "La credencial de esta tablet no es valida o fue revocada.");
  }
  return { mode: "device", deviceId: result.rows[0].device_id };
}
