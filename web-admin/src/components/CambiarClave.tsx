import { useState, type FormEvent } from "react";
import { apiPut } from "../api";

// 🔑 Cambiar MI clave (botón junto al nombre en el menú). También se abre sola
// después de entrar con una clave de menos de 8 caracteres (creada antes de la
// regla): con el ERP abierto a internet una clave corta se adivina fácil.

export function CambiarClaveModal({ claveCorta, onCerrar, avisar }: {
  /** Se abrió porque la clave actual es corta (cambia el texto y el botón de cerrar). */
  claveCorta?: boolean;
  onCerrar: () => void;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
}) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [ver, setVer] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (nueva.length < 8) { avisar("La clave nueva debe tener al menos 8 caracteres", "error"); return; }
    if (nueva !== repetir) { avisar("Las dos claves nuevas no coinciden", "error"); return; }
    setGuardando(true);
    try {
      await apiPut("/auth/me/password", { current_password: actual, password: nueva });
      avisar("Clave cambiada. Úsala la próxima vez que entres.", "success");
      onCerrar();
    } catch (err) {
      avisar(err instanceof Error ? err.message : "No se pudo cambiar la clave", "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={claveCorta ? undefined : onCerrar}>
      <form className="modalCard formPanel" onClick={(e) => e.stopPropagation()} onSubmit={guardar} style={{ maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>🔑 {claveCorta ? "Cambia tu clave" : "Cambiar mi clave"}</h3>
        {claveCorta && (
          <p className="vdCard__aviso">
            Tu clave tiene menos de 8 caracteres. Como el sistema se puede abrir desde internet, cámbiala por una más larga
            (por ejemplo una frase corta con números).
          </p>
        )}
        <label>
          <span>Clave actual</span>
          <input type={ver ? "text" : "password"} autoComplete="current-password" required autoFocus value={actual} onChange={(e) => setActual(e.target.value)} />
        </label>
        <label>
          <span>Clave nueva (mínimo 8 caracteres)</span>
          <input type={ver ? "text" : "password"} autoComplete="new-password" required minLength={8} value={nueva} onChange={(e) => setNueva(e.target.value)} />
        </label>
        <label>
          <span>Repite la clave nueva</span>
          <input type={ver ? "text" : "password"} autoComplete="new-password" required minLength={8} value={repetir} onChange={(e) => setRepetir(e.target.value)} />
        </label>
        <label className="catProd__check">
          <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} /> Mostrar claves
        </label>
        <div className="buttonRow">
          <button className="primary" disabled={guardando}>{guardando ? "Guardando…" : "Cambiar clave"}</button>
          <button type="button" onClick={onCerrar}>{claveCorta ? "Más tarde" : "Cancelar"}</button>
        </div>
      </form>
    </div>
  );
}
