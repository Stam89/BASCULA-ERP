// Buscador con sugerencias (combobox): se escribe, aparecen coincidencias
// (sin importar tildes; todas las palabras) y se elige con clic o ↑ ↓ Enter.
// Opcionalmente ofrece «➕ Crear …» con lo escrito. Tras elegir, el campo queda
// vacío y con el foco para seguir agregando.
import { useState } from "react";

export type OpcionCombo = { key: string; titulo: string; detalle?: string; etiqueta?: string };

const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function BuscadorCombo({ id, placeholder, opciones, onElegir, crear, onCrear, vacio, autoFocus, max = 8 }: {
  id: string;
  placeholder: string;
  opciones: OpcionCombo[];
  onElegir: (key: string) => void;
  /** Texto de la opción «Crear» para lo escrito (null = no se ofrece). */
  crear?: (texto: string) => string | null;
  onCrear?: (texto: string) => void;
  /** Aviso cuando no hay coincidencias. */
  vacio?: string;
  autoFocus?: boolean;
  max?: number;
}) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [idx, setIdx] = useState(0);
  const tokens = sinTildes(texto.trim()).split(/\s+/).filter(Boolean);
  const lista = (tokens.length
    ? opciones.filter((o) => { const t = sinTildes(`${o.titulo} ${o.detalle ?? ""} ${o.etiqueta ?? ""}`); return tokens.every((k) => t.includes(k)); })
    : opciones).slice(0, max);
  const textoCrear = crear && onCrear && texto.trim().length >= 2 ? crear(texto.trim()) : null;
  const total = lista.length + (textoCrear ? 1 : 0);
  const activo = Math.min(idx, Math.max(total - 1, 0));
  const elegir = (i: number) => {
    if (i < lista.length) onElegir(lista[i].key);
    else if (textoCrear && onCrear) onCrear(texto.trim());
    else return;
    setTexto(""); setIdx(0);
  };
  return (
    <div className="combo">
      <input type="search" value={texto} placeholder={placeholder} autoComplete="off" autoFocus={autoFocus}
        role="combobox" aria-expanded={abierto} aria-controls={`${id}-lista`} aria-autocomplete="list"
        aria-activedescendant={abierto && total ? `${id}-op-${activo}` : undefined}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 120)}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setIdx(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAbierto(true); setIdx(Math.min(activo + 1, total - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(Math.max(activo - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (total) elegir(activo); }
          else if (e.key === "Escape") setAbierto(false);
        }} />
      {abierto && (total > 0 || (vacio && tokens.length > 0)) && (
        <ul id={`${id}-lista`} role="listbox" className="combo__lista">
          {lista.map((o, i) => (
            <li key={o.key} id={`${id}-op-${i}`} role="option" aria-selected={i === activo} className={i === activo ? "is-activa" : ""}
              onMouseEnter={() => setIdx(i)} onMouseDown={(ev) => { ev.preventDefault(); elegir(i); }}>
              <span className="combo__titulo">{o.titulo}</span>
              {o.detalle && <span className="combo__detalle">{o.detalle}</span>}
              {o.etiqueta && <span className="combo__tag">{o.etiqueta}</span>}
            </li>
          ))}
          {textoCrear && (
            <li id={`${id}-op-${lista.length}`} role="option" aria-selected={activo === lista.length}
              className={`combo__crear ${activo === lista.length ? "is-activa" : ""}`}
              onMouseEnter={() => setIdx(lista.length)} onMouseDown={(ev) => { ev.preventDefault(); elegir(lista.length); }}>
              ➕ {textoCrear}
            </li>
          )}
          {total === 0 && vacio && <li className="combo__vacio" role="presentation">{vacio}</li>}
        </ul>
      )}
    </div>
  );
}
