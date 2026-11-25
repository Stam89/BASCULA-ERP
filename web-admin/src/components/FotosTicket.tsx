// 📷 Fotos del camión de un ticket de báscula (las toma la tablet al pesar). Se piden con la sesión y se muestran aquí.
import { useEffect, useState } from "react";
import { apiGet, apiOk } from "../api";

type Foto = { id: string; tomada_en: string; bytes: number };

export function FotosTicket({ ticketId, titulo, onCerrar }: { ticketId: string; titulo: string; onCerrar: () => void }) {
  const [fotos, setFotos] = useState<Array<Foto & { url?: string; error?: string }>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let vivo = true;
    const urls: string[] = [];
    (async () => {
      const lista = await apiGet<Foto[]>(`/tickets/${ticketId}/fotos`);
      if (!vivo) return;
      setFotos(lista);
      if (!lista.length) setError("Este ticket ya no tiene fotos (se guardan 6 meses).");
      for (const f of lista) {
        const puesta = await apiOk(`/tickets/fotos/${f.id}`).then((r) => r.blob()).then(
          (b) => { const url = URL.createObjectURL(b); urls.push(url); return { url }; },
          (e: Error) => ({ error: e.message })
        );
        if (vivo) setFotos((x) => x.map((y) => (y.id === f.id ? { ...y, ...puesta } : y)));
      }
    })().catch((e: Error) => { if (vivo) setError(e.message); });
    return () => { vivo = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [ticketId]);
  useEffect(() => {
    const salir = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", salir);
    return () => window.removeEventListener("keydown", salir);
  }, [onCerrar]);
  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label={`Fotos de ${titulo}`} onClick={onCerrar}>
      <div className="modalCard formPanel fotosTicket" onClick={(e) => e.stopPropagation()}>
        <header className="fotosTicket__head">
          <h3>📷 {titulo}</h3>
          <button type="button" className="btnGhost" aria-label="Cerrar" onClick={onCerrar}>✕</button>
        </header>
        {error && <p className="muted">{error}</p>}
        <div className="fotosTicket__lista">
          {fotos.map((f) => (
            <figure key={f.id}>
              {f.url ? <a href={f.url} target="_blank" rel="noreferrer" title="Abrir en grande"><img src={f.url} alt={`Foto del camión, ${new Date(f.tomada_en).toLocaleString("es-EC")}`} /></a>
                : <div className="fotosTicket__espera">{f.error ?? "Cargando…"}</div>}
              <figcaption>{new Date(f.tomada_en).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" })}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
