import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";

// ✉️ Configuración → Control de Usuarios → «Correo para recuperar claves».
// Muestra si el servidor puede enviar correos (SMTP_USER / SMTP_PASS en
// backend/.env), cómo activarlo con Gmail y permite enviarse un correo de prueba.
// Las credenciales NO se escriben aquí: viven solo en el .env del servidor.

type Estado = { recovery_email: string | null; mail_configured: boolean };

export function ConfigCorreoClaves({ esAdmin, usuariosConCorreo, usuariosTotal, avisar, onAbrirMiCorreo }: {
  esAdmin: boolean;
  usuariosConCorreo: number;
  usuariosTotal: number;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  /** Abre la ventana «Correo de recuperación» del usuario actual. */
  onAbrirMiCorreo: () => void;
}) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [probando, setProbando] = useState(false);

  useEffect(() => {
    let vivo = true;
    apiGet<Estado>("/auth/me/recovery-email").then((e) => { if (vivo) setEstado(e); }).catch(() => undefined);
    return () => { vivo = false; };
  }, []);

  async function probar() {
    setProbando(true);
    try {
      const r = await apiPost<{ enviado_a: string }>("/auth/mail-test", {});
      avisar(`Correo de prueba enviado a ${r.enviado_a}. Revisa tu bandeja (y spam).`, "success");
    } catch (err) {
      avisar(err instanceof Error ? err.message : "No se pudo enviar el correo de prueba", "error");
    } finally {
      setProbando(false);
    }
  }

  const listo = estado?.mail_configured === true;
  return (
    <div className="configCorreo">
      <div className="systemStatusGrid" style={{ margin: "8px 0 12px" }}>
        <div className={`systemStatusCard ${estado == null ? "" : listo ? "ok" : "warn"}`}>
          <span className="statusDot" />
          <div>
            <strong>Envío de correos</strong>
            <span>{estado == null ? "Revisando…" : listo ? "Configurado" : "Sin configurar (SMTP_USER / SMTP_PASS)"}</span>
          </div>
        </div>
        <div className={`systemStatusCard ${usuariosConCorreo > 0 ? "ok" : "warn"}`}>
          <span className="statusDot" />
          <div>
            <strong>Usuarios con correo</strong>
            <span>{usuariosConCorreo} de {usuariosTotal} activo(s)</span>
          </div>
        </div>
      </div>

      <p className="muted" style={{ margin: "0 0 8px" }}>
        En el inicio de sesión, <strong>«¿Olvidaste tu clave?»</strong> envía un código de 6 dígitos (vence en 15 minutos) al
        correo de recuperación del usuario. Cada usuario tiene el suyo: lo pone un administrador al crearlo o editarlo, o el
        propio usuario con el botón ✉️ junto a su nombre. Puede ser Gmail u otro correo.
      </p>

      {!listo && estado != null && (
        <ol className="configCorreo__pasos">
          <li>Usa una cuenta de Gmail <strong>solo para el sistema</strong> (es la que envía los códigos).</li>
          <li>En esa cuenta: Google → Seguridad → activa la <strong>Verificación en 2 pasos</strong> → <strong>Contraseñas de aplicaciones</strong> → crea una (16 letras). No es la clave normal de Gmail.</li>
          <li>En el archivo <code>backend/.env</code> del servidor agrega <code>SMTP_USER=cuenta@gmail.com</code> y <code>SMTP_PASS=la contraseña de aplicación</code>, y reinicia el ERP.</li>
          <li>Registra tu correo (✉️) y pulsa «Enviar correo de prueba».</li>
        </ol>
      )}

      <div className="buttonRow">
        <button type="button" className="btnSecondary" onClick={onAbrirMiCorreo}>✉️ Mi correo de recuperación</button>
        {esAdmin && (
          <button type="button" className="btnSecondary" onClick={() => void probar()} disabled={!listo || probando}
            title={listo ? "Envía un correo a tu correo de recuperación" : "Primero configura SMTP_USER y SMTP_PASS"}>
            {probando ? "Enviando…" : "Enviar correo de prueba"}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        ¿Alguien perdió la clave y no tiene correo? Un administrador la restablece en <strong>Usuarios registrados → ✎ Editar → Clave nueva</strong>.
      </p>
    </div>
  );
}
