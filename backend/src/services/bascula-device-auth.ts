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

export async function requireDeviceCredential(req: DeviceRequest): Promise<{
  mode: "legacy" | "device";
  deviceId: string | null;
}> {
  const provided = header(req, "x-device-key");
  const deviceId = header(req, "x-device-id");

  // Compatibilidad controlada: APK anteriores siguen funcionando durante la
  // migracion, y la misma clave permite dar de alta una instalacion nueva.
  if (isBootstrapKey(provided)) return { mode: "legacy", deviceId: deviceId || null };

  if (!provided || !deviceId) {
    throw new ApiError(401, "Dispositivo no autorizado para sincronizar tickets.");
  }
  const result = await pool.query<{ device_id: string }>(
    `UPDATE bascula_devices
        SET last_seen_at = CASE
              WHEN last_seen_at IS NULL OR last_seen_at < now() - interval '1 hour' THEN now()
              ELSE last_seen_at
            END
      WHERE device_id = $1
        AND token_hash = $2
        AND activo = true
      RETURNING device_id`,
    [deviceId, hashDeviceToken(provided)]
  );
  if (!result.rowCount) {
    throw new ApiError(401, "La credencial de esta tablet no es valida o fue revocada.");
  }
  return { mode: "device", deviceId: result.rows[0].device_id };
}
