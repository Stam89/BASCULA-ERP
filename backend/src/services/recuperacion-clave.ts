// ── Recuperación de clave por correo: reglas puras (sin base de datos) ──────
// Flujo: «¿Olvidaste tu clave?» → se envía un código de 6 dígitos al correo de
// recuperación del usuario → el usuario escribe usuario + código + clave nueva.
// Aquí viven las piezas que se pueden probar sin BD: generar el código, guardarlo
// solo como hash, compararlo y limitar intentos.
import crypto from "crypto";

export const CODIGO_DIGITOS = 6;
export const CODIGO_VIGENCIA_MIN = 15;
export const CODIGO_MAX_INTENTOS = 5;
/** Espera mínima entre dos códigos pedidos para el mismo usuario. */
export const ESPERA_ENTRE_CODIGOS_SEG = 60;
export const MAX_CODIGOS_POR_HORA = 5;

/** Código numérico uniforme (crypto.randomInt, no Math.random), con ceros a la izquierda. */
export function generarCodigo(): string {
  return String(crypto.randomInt(0, 10 ** CODIGO_DIGITOS)).padStart(CODIGO_DIGITOS, "0");
}

/** El código nunca se guarda en claro: HMAC con la clave del servidor y el usuario. */
export function hashCodigo(secreto: string, userId: string, codigo: string): string {
  return crypto.createHmac("sha256", secreto).update(`${userId}:${codigo}`).digest("hex");
}

/** Comparación en tiempo constante del código escrito contra el hash guardado. */
export function codigoCoincide(secreto: string, userId: string, codigo: string, hashGuardado: string): boolean {
  if (!/^\d+$/.test(codigo) || codigo.length !== CODIGO_DIGITOS) return false;
  const a = Buffer.from(hashCodigo(secreto, userId, codigo), "hex");
  const b = Buffer.from(hashGuardado, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Correo en minúsculas y sin espacios, o null si no tiene forma de correo. */
export function normalizarCorreo(valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim().toLowerCase();
  return v.length <= 160 && CORREO_RE.test(v) ? v : null;
}

/** «stalynmarin@gmail.com» → «st***@gmail.com» (para mostrarlo sin regalarlo entero). */
export function enmascararCorreo(correo: string): string {
  const [usuario, dominio] = correo.split("@");
  if (!dominio) return correo;
  return `${usuario.slice(0, Math.min(2, usuario.length))}***@${dominio}`;
}

/** Limitador por ventana de tiempo (en memoria): `max` eventos cada `ventanaMs` por clave. */
export class LimitadorVentana {
  private readonly eventos = new Map<string, { cuenta: number; vence: number }>();
  constructor(private readonly max: number, private readonly ventanaMs: number, private readonly ahora: () => number = Date.now) {}

  /** ¿La clave ya agotó su cupo? (no cuenta el intento) */
  bloqueado(clave: string): { bloqueado: boolean; minutos: number } {
    const e = this.eventos.get(clave);
    if (!e || this.ahora() > e.vence || e.cuenta < this.max) return { bloqueado: false, minutos: 0 };
    return { bloqueado: true, minutos: Math.max(1, Math.ceil((e.vence - this.ahora()) / 60000)) };
  }

  registrar(clave: string): void {
    const e = this.eventos.get(clave);
    if (!e || this.ahora() > e.vence) this.eventos.set(clave, { cuenta: 1, vence: this.ahora() + this.ventanaMs });
    else e.cuenta += 1;
    // No dejar crecer el mapa sin límite si alguien rota IPs.
    if (this.eventos.size > 5000) this.eventos.clear();
  }

  limpiar(clave: string): void { this.eventos.delete(clave); }
}

/** Texto del correo con el código (texto plano + HTML simple). */
export function mensajeCodigo(opts: { nombreNegocio: string; nombreUsuario: string; codigo: string }): { subject: string; text: string; html: string } {
  const { nombreNegocio, nombreUsuario, codigo } = opts;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const subject = `Código para restablecer tu clave · ${nombreNegocio}`;
  const text =
    `Hola ${nombreUsuario},\n\n` +
    `Tu código para restablecer la clave de ${nombreNegocio} es:\n\n    ${codigo}\n\n` +
    `Vence en ${CODIGO_VIGENCIA_MIN} minutos y solo sirve una vez.\n` +
    `Si no lo pediste tú, ignora este correo: tu clave actual no cambia.\n`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111">` +
    `<p>Hola ${esc(nombreUsuario)},</p>` +
    `<p>Tu código para restablecer la clave de <strong>${esc(nombreNegocio)}</strong> es:</p>` +
    `<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:16px 0">${esc(codigo)}</p>` +
    `<p>Vence en ${CODIGO_VIGENCIA_MIN} minutos y solo sirve una vez.</p>` +
    `<p style="color:#555">Si no lo pediste tú, ignora este correo: tu clave actual no cambia.</p></div>`;
  return { subject, text, html };
}
