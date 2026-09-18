import React, { useEffect, useState } from "react";
import { apiFetch, apiPost } from "../api";
import { formatPersonName } from "../format";

// ── Buscador universal de Cliente / Agricultor ──────────────────────────────
// Autocompleta EN TIEMPO REAL contra el directorio maestro (báscula = farmers /
// clientes = customers), estandariza el nombre exacto del registro elegido y
// devuelve su id (onSelect) para mantener coherencia en todos los reportes.
// Si el nombre no existe, ofrece "➕ Nuevo" y lo registra en el directorio
// central (fallback), quedando disponible para cualquier otro formulario futuro.
// Es un reemplazo directo (drop-in) de un <input> de texto: `value`/`onChange`
// siguen funcionando como texto libre; onSelect/onCreated son opcionales.
export type DirectorioHit = { id: string; full_name: string; identification: string | null; phone: string | null };

export function ClienteSearchInput({
  kind, value, onChange, onSelect, onCreated, onError,
  placeholder, required, disabled, allowCreate = true, style, autoFocus,
}: {
  kind: "farmer" | "customer";
  value: string;
  onChange: (name: string) => void;
  onSelect?: (hit: DirectorioHit) => void;
  onCreated?: (hit: DirectorioHit) => void;
  onError?: (message: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  allowCreate?: boolean;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DirectorioHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const base = kind === "farmer" ? "/farmers" : "/customers";
  const label = kind === "farmer" ? "Agricultor" : "Cliente";

  // Búsqueda con debounce (desde la 2ª letra) contra el directorio maestro.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    let cancel = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch(`${base}/search?q=${encodeURIComponent(term)}`);
        const data = res.ok ? await res.json() : [];
        if (!cancel) setHits(Array.isArray(data) ? data : []);
      } catch { if (!cancel) setHits([]); }
      finally { if (!cancel) setLoading(false); }
    }, 220);
    return () => { cancel = true; clearTimeout(t); };
  }, [q, open, base]);

  const term = q.trim();
  const exact = hits.some((h) => h.full_name.trim().toLowerCase() === term.toLowerCase());
  const showCreate = allowCreate && term.length >= 2 && !exact && !loading;

  async function crearNuevo() {
    if (creating) return;
    const nombre = formatPersonName(term);
    setCreating(true);
    try {
      const hit = await apiPost<DirectorioHit>(base, { full_name: nombre });
      onChange(hit.full_name);
      (onCreated ?? onSelect)?.(hit);
      setOpen(false); setQ("");
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "No se pudo crear el registro");
    } finally { setCreating(false); }
  }

  function elegir(hit: DirectorioHit) {
    onChange(hit.full_name);
    onSelect?.(hit);
    setOpen(false); setQ("");
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text" required={required} disabled={disabled} autoFocus={autoFocus}
        value={open ? q : value}
        placeholder={placeholder ?? `Buscar ${label.toLowerCase()}…`}
        onFocus={() => { setOpen(true); setQ(value); }}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }}
        onBlur={(e) => {
          const formateado = formatPersonName(e.target.value);
          if (open && formateado !== value) onChange(formateado);
          setTimeout(() => setOpen(false), 160);
        }}
        style={style}
      />
      {open && term.length >= 2 && (
        <div style={{ position: "absolute", zIndex: 60, top: "100%", left: 0, right: 0, maxHeight: 260, overflowY: "auto",
          background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 8, boxShadow: "0 8px 20px rgba(0,0,0,.15)", marginTop: 2 }}>
          {loading && <div style={{ padding: "8px 12px", color: "var(--c-muted)", fontSize: 13 }}>Buscando…</div>}
          {!loading && hits.map((h) => (
            <div key={h.id} onMouseDown={(e) => { e.preventDefault(); elegir(h); }}
              style={{ padding: "7px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--c-border)" }}>
              <div style={{ fontWeight: 600 }}>{h.full_name}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {h.identification ? `CI/RUC: ${h.identification}` : "Sin identificación"}{h.phone ? ` · ${h.phone}` : ""}
              </div>
            </div>
          ))}
          {!loading && hits.length === 0 && !showCreate && (
            <div style={{ padding: "8px 12px", color: "var(--c-muted)", fontSize: 13 }}>Sin coincidencias</div>
          )}
          {showCreate && (
            <div onMouseDown={(e) => { e.preventDefault(); crearNuevo(); }}
              style={{ padding: "9px 12px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#15803d", background: "#f0fdf4" }}>
              {creating ? "Creando…" : `➕ Nuevo ${label}: "${formatPersonName(term)}"`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
