import { useState, type FormEvent } from "react";
import { apiPost } from "../api";

// 🗑️ Eliminar TODOS los fomentos para volver a subirlos (pedido del dueño 2026-11-04). Pide lo mismo que «Borrar datos»,
// pero no toca el resto: los agricultores, la caja y el inventario se quedan. El servidor guarda un respaldo antes.
export function EliminarFomentosModal({ onCerrar, onEliminados, avisar }: {
  onCerrar: () => void;
  onEliminados: () => Promise<void> | void;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
}) {
  const [clave, setClave] = useState("");
  const [llave, setLlave] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [borrando, setBorrando] = useState(false);
  const listo = confirmacion.trim().toUpperCase() === "BORRAR" && !!clave && !!llave;

  async function eliminar(e: FormEvent) {
    e.preventDefault();
    if (!listo || borrando) return;
    setBorrando(true);
    try {
      const r = await apiPost<{ eliminados: number }>("/settings/eliminar-fomentos", { password: clave, llave_maestra: llave, confirm: "BORRAR" });
      avisar(`Se eliminaron ${r.eliminados} fomentos. Ya puedes subirlos de nuevo.`, "success");
      await onEliminados();
      onCerrar();
    } catch (err) {
      avisar(err instanceof Error ? err.message : "No se pudieron eliminar los fomentos", "error");
    } finally {
      setBorrando(false);
    }
  }

  return (
    <div className="modalOverlay" onClick={onCerrar}>
      <form className="modalCard formPanel" onClick={(e) => e.stopPropagation()} onSubmit={eliminar} style={{ maxWidth: 440 }}>
        <h3 style={{ marginTop: 0 }}>🗑️ Eliminar todos los fomentos</h3>
        <p className="vdCard__aviso">
          Se borran los fomentos de <strong>todos los socios</strong>, con sus entregas y pagos. Los agricultores, la caja y el
          inventario no cambian. Antes se guarda un respaldo.
        </p>
        <label>
          <span>Tu clave</span>
          <input type="password" autoComplete="current-password" required autoFocus value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        <label>
          <span>Llave maestra</span>
          <input type="password" autoComplete="off" required value={llave} onChange={(e) => setLlave(e.target.value)} />
        </label>
        <label>
          <span>Escribe BORRAR para confirmar</span>
          <input autoComplete="off" required value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
        </label>
        <div className="buttonRow">
          <button className="primary" disabled={!listo || borrando} style={{ background: "#dc2626", borderColor: "#dc2626" }}>
            {borrando ? "Eliminando…" : "Eliminar todos"}
          </button>
          <button type="button" className="btnSecondary" onClick={onCerrar} disabled={borrando}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
