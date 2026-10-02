import { useEffect, useState, type FormEvent } from "react";
import { apiGet, apiPut } from "../api";

// ✉️ Correo de recuperación del PROPIO usuario (botón junto a su nombre en el menú).
// Si olvida la clave, «¿Olvidaste tu clave?» en el inicio de sesión le envía un
// código a este correo. Cambiarlo exige la clave actual: así una sesión ajena
// no puede redirigir los códigos a otro correo.

type Estado = { recovery_email: string | null; mail_configured: boolean };

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function CorreoRecuperacionModal({ onCerrar, onGuardado, avisar }: {
  onCerrar: () => void;
  /** Avisa a App el correo que quedó guardado (null = sin correo). */
  onGuardado: (correo: string | null) => void;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
}) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    apiGet<Estado>("/auth/me/recovery-email")
      .then((e) => { if (vivo) { setEstado(e); setEmail(e.recovery_email ?? ""); } })
      .catch((e) => avisar(`No se pudo leer tu correo: ${e instanceof Error ? e.message : "error"}`, "error"));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function guardar(correo: string) {
    setGuardando(true);
    try {
      const r = await apiPut<Estado>("/auth/me/recovery-email", { email: correo, password });
      avisar(r.recovery_email ? `Correo de recuperación guardado: ${r.recovery_email}` : "Correo de recuperación quitado", "success");
      onGuardado(r.recovery_email);
      onCerrar();
    } catch (err) {
      avisar(err instanceof Error ? err.message : "No se pudo guardar el correo", "error");
    } finally {
      setGuardando(false);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    const correo = email.trim();
    if (!CORREO_RE.test(correo)) { avisar("Escribe un correo válido (ej. nombre@gmail.com)", "error"); return; }
    if (!password) { avisar("Escribe tu clave actual para confirmar", "error"); return; }
    void guardar(correo);
  }

  const cambio = estado != null && email.trim().toLowerCase() !== (estado.recovery_email ?? "");
  return (
    <div className="modalOverlay" onClick={onCerrar}>
      <form className="modalCard formPanel" onClick={(e) => e.stopPropagation()} onSubmit={enviar} style={{ maxWidth: 440 }}>
        <h3 style={{ marginTop: 0 }}>✉️ Correo de recuperación</h3>
        <p className="muted" style={{ marginTop: -4 }}>
          Si olvidas tu clave, te enviamos un código a este correo (puede ser tu Gmail) para que crees una nueva.
        </p>
        {estado && !estado.mail_configured && (
          <p className="vdCard__aviso">
            El servidor aún no tiene el envío de correos configurado: guárdalo igual, pero hasta que un administrador lo
            active no se podrán enviar códigos.
          </p>
        )}
        <label>
          <span>Tu correo</span>
          <input type="email" autoFocus autoComplete="email" placeholder="nombre@gmail.com" maxLength={160}
            value={email} onChange={(e) => setEmail(e.target.value)} disabled={!estado} />
        </label>
        <label>
          <span>Tu clave actual (para confirmar)</span>
          <input type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} disabled={!estado} />
        </label>
        <div className="buttonRow">
          <button className="primary" disabled={!estado || guardando || !cambio}>{guardando ? "Guardando…" : "Guardar correo"}</button>
          {estado?.recovery_email && (
            <button type="button" disabled={guardando || !password}
              title={password ? "Quitar el correo de recuperación" : "Escribe tu clave actual para poder quitarlo"}
              onClick={() => void guardar("")}>Quitar correo</button>
          )}
          <button type="button" onClick={onCerrar}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
