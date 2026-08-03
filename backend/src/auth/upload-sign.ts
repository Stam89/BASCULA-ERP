import crypto from "crypto";
import { env } from "../config/env.js";

// URLs firmadas de corta duración para servir archivos de /uploads.
//
// Antes se aceptaba el JWT de sesión como ?token=... en la URL (para que un
// <img src> pudiera mostrar fotos). Eso filtra la sesión completa: el token
// queda en los logs de morgan y en el historial del navegador. En su lugar se
// firma la RUTA del archivo con HMAC y una expiración: la URL solo sirve para
// ese archivo y caduca sola; aunque quede en un log, no abre sesión.

export const UPLOAD_URL_TTL_MS = 60 * 60 * 1000; // 1 hora

function signatureFor(resourcePath: string, exp: string): string {
  return crypto
    .createHmac("sha256", env.jwtSecret)
    .update(`${resourcePath}:${exp}`)
    .digest("hex")
    .slice(0, 32);
}

// resourcePath: ruta del archivo SIN el prefijo /uploads (p.ej. "equipment/maintenance-1.png").
// Devuelve la URL completa lista para usar en un <img src> o un enlace.
export function signUploadUrl(resourcePath: string, now = Date.now()): string {
  const clean = resourcePath.replace(/^\/+/, "");
  const exp = String(now + UPLOAD_URL_TTL_MS);
  return `/uploads/${clean}?exp=${exp}&sig=${signatureFor(clean, exp)}`;
}

// Verifica la firma de una request a /uploads. `requestPath` es req.path del
// middleware montado en /uploads (p.ej. "/equipment/maintenance-1.png").
export function verifyUploadSignature(requestPath: string, exp: unknown, sig: unknown): boolean {
  if (typeof exp !== "string" || typeof sig !== "string") return false;
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const clean = requestPath.replace(/^\/+/, "");
  const expected = signatureFor(clean, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
