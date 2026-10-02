// ── Envío de correo (SMTP) ───────────────────────────────────────────────────
// Se usa para el código de recuperación de clave. Las credenciales NO viven en la
// base de datos ni en el código: salen de backend/.env (SMTP_USER / SMTP_PASS).
// Con Gmail: SMTP_USER = la cuenta y SMTP_PASS = una «contraseña de aplicación»
// (Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de
// aplicaciones), NO la clave normal de Gmail.
import nodemailer from "nodemailer";
import { env } from "../config/env.js";

export type MensajeCorreo = { to: string; subject: string; text: string; html?: string };
type Transporte = { sendMail: (m: { from: string; to: string; subject: string; text: string; html?: string }) => Promise<unknown> };

let transporte: Transporte | null = null;

/** ¿Hay credenciales para enviar correos? Sin ellas la recuperación se desactiva sola. */
export function correoConfigurado(): boolean {
  return Boolean(env.smtp.user && env.smtp.pass);
}

function remitente(): string {
  return env.smtp.from || `"Bascula ERP" <${env.smtp.user}>`;
}

function obtenerTransporte(): Transporte {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465, // 465 = TLS directo; 587 = STARTTLS (nodemailer lo negocia solo)
      auth: { user: env.smtp.user, pass: env.smtp.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000
    });
  }
  return transporte;
}

export async function enviarCorreo(m: MensajeCorreo): Promise<void> {
  if (!correoConfigurado()) throw new Error("El envío de correos no está configurado (SMTP_USER / SMTP_PASS).");
  await obtenerTransporte().sendMail({ from: remitente(), to: m.to, subject: m.subject, text: m.text, html: m.html });
}

/** Solo para pruebas: reemplaza el transporte SMTP real (null = volver al real). */
export function __usarTransporteDePrueba(t: Transporte | null): void {
  transporte = t;
}
