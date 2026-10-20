// 🔐 SEGURIDAD DEL ACCESO (pedido del dueño 2026-10-20: «cómo podemos proteger el programa de cualquier ataque»).
//  · Claves: además del mínimo de 8, se rechazan las obvias (123456…, «password», el propio usuario, un solo
//    carácter repetido). Lógica pura, con pruebas.
//  · Verificación del ADMINISTRADOR al entrar DESDE INTERNET (por Cloudflare) en un equipo nuevo: código de 6
//    dígitos a su correo. En la PC/red del local no se pide (así nunca queda fuera si el correo falla). El equipo
//    se puede recordar: se guarda solo el hash de su token.
import crypto from "crypto";

const COMUNES = new Set([
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234", "11223344",
  "password", "password1", "contraseña", "contrasena", "qwertyui", "qwerty123", "asdfghjk", "abcdefgh",
  "abcd1234", "abc12345", "1q2w3e4r", "iloveyou", "admin123", "administrador", "bascula", "bascula123",
  "piladora", "ceyro123", "ecuador1", "ecuador123", "arroz123", "temporal", "cambiame"
]);

/** Motivo por el que una clave NUEVA no sirve, o null si está bien. */
export function problemaDeClave(clave: string, usuario?: string | null): string | null {
  const c = String(clave ?? "");
  if (c.length < 8) return "La clave debe tener al menos 8 caracteres.";
  const baja = c.toLowerCase();
  if (COMUNES.has(baja)) return "Esa clave es muy común y fácil de adivinar. Elige otra.";
  if (/^(.)\1+$/.test(c)) return "La clave no puede ser un mismo carácter repetido.";
  if (/^\d+$/.test(c) && ("01234567890".includes(c) || "09876543210".includes(c))) return "La clave no puede ser una serie de números seguidos.";
  const u = String(usuario ?? "").trim().toLowerCase();
  if (u.length >= 3 && baja.includes(u)) return "La clave no puede contener tu nombre de usuario.";
  return null;
}

/** ¿La clave con la que se acaba de entrar es débil? (para pedir que la cambie; no bloquea el ingreso). */
export function claveEsDebil(clave: string, usuario?: string | null): boolean {
  return problemaDeClave(clave, usuario) !== null;
}

/** La petición llegó por el túnel de Cloudflare (internet) y no desde la red del local. */
export function vieneDeInternet(headers: Record<string, unknown>): boolean {
  return typeof headers["cf-connecting-ip"] === "string" && String(headers["cf-connecting-ip"]).length > 0;
}

export function nuevoTokenDispositivo(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/** Correo con el código para entrar (texto + HTML simple). */
export function mensajeCodigoIngreso(opts: { nombreNegocio: string; nombreUsuario: string; codigo: string; minutos: number }) {
  const { nombreNegocio, nombreUsuario, codigo, minutos } = opts;
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] as string));
  const subject = `Código para entrar · ${nombreNegocio}`;
  const text =
    `Hola ${nombreUsuario},\n\n` +
    `Alguien (seguramente tú) está entrando como administrador a ${nombreNegocio} desde un equipo nuevo.\n` +
    `Tu código es:\n\n    ${codigo}\n\n` +
    `Vence en ${minutos} minutos y solo sirve una vez.\n` +
    `Si NO fuiste tú, cambia tu clave cuanto antes: alguien la conoce.\n`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111">` +
    `<p>Hola ${esc(nombreUsuario)},</p>` +
    `<p>Alguien (seguramente tú) está entrando como <strong>administrador</strong> a <strong>${esc(nombreNegocio)}</strong> desde un equipo nuevo. Tu código es:</p>` +
    `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:16px 0">${esc(codigo)}</p>` +
    `<p>Vence en ${minutos} minutos y solo sirve una vez.</p>` +
    `<p style="color:#b91c1c"><strong>Si NO fuiste tú, cambia tu clave cuanto antes: alguien la conoce.</strong></p></div>`;
  return { subject, text, html };
}

/** Orígenes de navegador permitidos (CORS): el dominio público y la red del local / la misma PC. */
export function origenPermitido(origen: string | undefined, publicUrl?: string | null): boolean {
  if (!origen) return true; // misma página, apps nativas, la báscula
  let u: URL;
  try { u = new URL(origen); } catch { return false; }
  const host = u.hostname;
  if (publicUrl) {
    try { if (new URL(publicUrl).hostname === host) return true; } catch { /* PUBLIC_URL mal escrita */ }
  }
  if (host === "erp.ceyroerp.com") return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const m = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}
