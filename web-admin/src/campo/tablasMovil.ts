import { useEffect } from "react";

// 📱 Tablas de Transporte en el celular (pedido del dueño 2026-10-29): en pantallas angostas cada fila se ve
// como una TARJETA con «Etiqueta: valor» en vez de una tabla ancha que hay que deslizar de lado. La etiqueta de
// cada celda sale del encabezado de su columna; el CSS (body.campoActivo .tablaTarjeta) hace el resto.
const SELECTOR = "table.cajaTable, table.nomMatriz__tabla, table.er-tabla";

function etiquetar(tabla: HTMLTableElement) {
  const ths = tabla.tHead?.rows[tabla.tHead.rows.length - 1]?.cells;
  if (!ths || ths.length === 0) return;
  const nombres: string[] = [];
  for (const th of Array.from(ths)) {
    const span = Math.max(1, th.colSpan || 1);
    const txt = (th.textContent ?? "").replace(/\s+/g, " ").trim();
    for (let i = 0; i < span; i++) nombres.push(txt);
  }
  tabla.classList.add("tablaTarjeta");
  for (const tb of [...Array.from(tabla.tBodies), ...(tabla.tFoot ? [tabla.tFoot] : [])]) {
    for (const tr of Array.from(tb.rows)) {
      let col = 0;
      for (const td of Array.from(tr.cells)) {
        const span = Math.max(1, td.colSpan || 1);
        const nombre = span > 1 ? "" : nombres[col] ?? "";
        if (td.getAttribute("data-label") !== nombre) td.setAttribute("data-label", nombre);
        td.classList.toggle("tt-ancha", span > 1);
        // Vacía («—») = no se muestra en la tarjeta; texto largo = va debajo de su etiqueta, alineado a la izquierda.
        const conControl = td.querySelector("input, select, button, textarea, details") != null;
        const txt = (td.textContent ?? "").replace(/\s+/g, " ").trim();
        td.classList.toggle("tt-vacia", !conControl && (txt === "" || txt === "—" || txt === "-"));
        td.classList.toggle("tt-larga", !conControl && txt.length > 26);
        col += span;
      }
    }
  }
}

/** Mientras Transporte esté abierto, etiqueta todas sus tablas (también las de los modales) y las vigila. */
export function useTablasEnTarjetas() {
  useEffect(() => {
    document.body.classList.add("campoActivo");
    let pendiente = 0;
    const pasar = () => {
      pendiente = 0;
      document.querySelectorAll<HTMLTableElement>(SELECTOR).forEach(etiquetar);
    };
    const obs = new MutationObserver(() => { if (!pendiente) pendiente = window.setTimeout(pasar, 60); });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    pasar();
    return () => {
      obs.disconnect();
      if (pendiente) window.clearTimeout(pendiente);
      document.body.classList.remove("campoActivo");
    };
  }, []);
}
