import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";
import { money } from "../format";

// ⚖️ Tickets que la báscula cambió DESPUÉS de ingresarlos (la tablet corrigió el peso o la calificación).
// El administrador elige: «Aplicar el peso nuevo» (corrige ingreso, lote/secado/pilado, cáscara y liquidación)
// o «Mantener el ingresado» (descarta el cambio). Sale arriba de Báscula → Tickets solo si hay alguno.
type Cambio = {
  id: string; numero: string | null; agricultor: string | null; accionista: string | null; liquidacion: string | null;
  bruto: number; tara: number; neto: number; calificacion: number; qq: number;
  nuevo: { bruto: number; tara: number; neto: number; calificacion: number; qq: number; en?: string };
};

export function BasculaCambios({ esAdmin, avisar, onCambio }: {
  esAdmin: boolean;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  /** Recarga tickets / liquidaciones después de aplicar. */
  onCambio?: () => unknown;
}) {
  const [items, setItems] = useState<Cambio[]>([]);
  const [busy, setBusy] = useState("");
  const cargar = useCallback(async () => {
    try { setItems(await apiGet<Cambio[]>("/tickets/cambios-bascula")); } catch { setItems([]); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  if (items.length === 0) return null;

  async function aplicar(c: Cambio) {
    if (!window.confirm(`Ticket ${c.numero} de ${c.agricultor}: aplicar el peso NUEVO de la báscula.\n\n` +
      `Antes: ${c.neto} kg neto (${c.qq} QQ) → Ahora: ${c.nuevo.neto} kg neto (${c.nuevo.qq} QQ).\n\n` +
      `Se corrigen el ingreso, el lote/secado/pilado, la cáscara${c.liquidacion ? ` y la liquidación ${c.liquidacion} (y lo que se le debe al agricultor)` : ""}.`)) return;
    setBusy(c.id);
    try {
      const r = await apiPost<{ qq_antes: number; qq: number; liquidacion: { numero: string; neto_antes: number; neto: number } | null; avisos: string[] }>(`/tickets/${c.id}/aplicar-cambio`, {});
      avisar(`Ticket ${c.numero}: ${r.qq_antes} → ${r.qq} QQ.` +
        (r.liquidacion ? ` Liquidación ${r.liquidacion.numero}: neto ${money(r.liquidacion.neto_antes)} → ${money(r.liquidacion.neto)}.` : "") +
        (r.avisos.length ? ` ${r.avisos.join(" ")}` : ""), r.avisos.length ? "warn" : "success");
      await cargar();
      await Promise.resolve(onCambio?.());
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo aplicar", "error"); } finally { setBusy(""); }
  }
  async function mantener(c: Cambio) {
    if (!window.confirm(`Ticket ${c.numero}: mantener lo ingresado (${c.neto} kg neto) y descartar el cambio de la báscula?`)) return;
    setBusy(c.id);
    try { await apiPost(`/tickets/${c.id}/descartar-cambio`, {}); avisar(`Ticket ${c.numero}: se mantiene lo ingresado`, "success"); await cargar(); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo descartar", "error"); } finally { setBusy(""); }
  }

  return (
    <div className="tablePanel basCambios" style={{ marginBottom: 12 }}>
      <h2 style={{ marginBottom: 2 }}>⚠️ La báscula cambió {items.length === 1 ? "un ticket" : `${items.length} tickets`} después de ingresarlos</h2>
      <p className="muted" style={{ margin: "0 0 8px" }}>La tablet corrigió el peso o la calificación de un ticket que ya estaba ingresado. Decide cuál es el correcto.</p>
      {items.map((c) => (
        <div key={c.id} className="basCambios__item">
          <div className="basCambios__txt">
            <strong>Ticket {c.numero} · {c.agricultor}{c.accionista ? ` · ${c.accionista}` : ""}</strong>
            <span>Ingresado: {c.bruto} − {c.tara} = <b>{c.neto} kg</b> ({c.qq} QQ)</span>
            <span>En la báscula: {c.nuevo.bruto} − {c.nuevo.tara} = <b>{c.nuevo.neto} kg</b> ({c.nuevo.qq} QQ){c.nuevo.calificacion !== c.calificacion ? ` · calificación ${c.calificacion} → ${c.nuevo.calificacion}` : ""}</span>
            {c.liquidacion && <small className="muted">Liquidado en {c.liquidacion}: al aplicar se recalcula (si aún no se le pagó al agricultor).</small>}
          </div>
          {esAdmin ? (
            <div className="basCambios__acc">
              <button type="button" className="primary" disabled={!!busy} onClick={() => void aplicar(c)}>{busy === c.id ? "Aplicando…" : "Aplicar el peso nuevo"}</button>
              <button type="button" className="btnSecondary" disabled={!!busy} onClick={() => void mantener(c)}>Mantener el ingresado</button>
            </div>
          ) : <small className="muted">Un administrador decide cuál es el correcto.</small>}
        </div>
      ))}
    </div>
  );
}
