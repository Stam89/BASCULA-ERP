import { useEffect } from "react";

// 📱 Tablas de Transporte en el celular (pedido del dueño 2026-10-29): en pantallas angostas cada fila se ve
// como una TARJETA con «Etiqueta: valor» en vez de una tabla ancha que hay que deslizar de lado. La etiqueta de
// cada celda sale del encabezado de su columna; el CSS (body.campoActivo .tablaTarjeta) hace el resto.
const SELECTOR = "table.cajaTable, table.nomMatriz__tabla, table.er-tabla";
// En el resto del ERP va en tarjeta la tabla que NO CABE en el celular (o que lo pide con `enTarjetas`): la que cabe se
// queda como tabla, que se lee más rápido. Estas ya tienen su propio dibujo en el celular.
const CON_DIBUJO_PROPIO = ".cjh-tabla, .cuentasTabla, .basculaTicketsTable, .nomHist";
const ES_CELULAR = "(max-width: 700px)";

function etiquetar(tabla: HTMLTableElement) {
  const filasCabecera = tabla.tHead?.rows;
  if (!filasCabecera?.length) return;
  // Con dos filas de encabezado («CASC» sobre «0.11») la etiqueta las junta: «CASC 0.11».
  const nombres: string[] = [];
  for (const fila of Array.from(filasCabecera)) {
    let columna = 0;
    for (const th of Array.from(fila.cells)) {
      const txt = (th.textContent ?? "").replace(/\s+/g, " ").trim();
      for (let i = 0; i < Math.max(1, th.colSpan || 1); i++, columna++) {
        if (txt) nombres[columna] = nombres[columna] ? `${nombres[columna]} ${txt}` : txt;
      }
    }
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

/** ¿Se sale del espacio que tiene? También la que se desliza por dentro (`display: block`). */
function noCabe(tabla: HTMLTableElement): boolean {
  const padre = tabla.parentElement;
  if (!padre?.clientWidth || tabla.offsetWidth === 0) return false;
  const estilo = getComputedStyle(padre);
  const libre = padre.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
  return tabla.scrollWidth > tabla.clientWidth + 2 || tabla.offsetWidth > libre + 2;
}

function tablasDelErp(): HTMLTableElement[] {
  const celular = window.matchMedia(ES_CELULAR).matches;
  return Array.from(document.querySelectorAll<HTMLTableElement>(".content table, .modalOverlay table")).filter((t) =>
    !t.matches(CON_DIBUJO_PROPIO) && (t.matches(".enTarjetas, .tablaTarjeta") || (celular && noCabe(t))));
}

function vigilar(elegir: () => HTMLTableElement[]): () => void {
  let pendiente = 0;
  const pasar = () => {
    pendiente = 0;
    elegir().forEach(etiquetar);
  };
  const programar = () => { if (!pendiente) pendiente = window.setTimeout(pasar, 60); };
  const obs = new MutationObserver(programar);
  // `open`: una tabla dentro de un <details> no tiene ancho hasta que se abre.
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["open"] });
  window.addEventListener("resize", programar);
  pasar();
  return () => {
    obs.disconnect();
    window.removeEventListener("resize", programar);
    if (pendiente) window.clearTimeout(pendiente);
  };
}

/** Mientras Transporte esté abierto, etiqueta todas sus tablas (también las de los modales) y las vigila. */
export function useTablasEnTarjetas() {
  useEffect(() => {
    document.body.classList.add("campoActivo");
    const dejar = vigilar(() => Array.from(document.querySelectorAll<HTMLTableElement>(SELECTOR)));
    return () => {
      dejar();
      document.body.classList.remove("campoActivo");
    };
  }, []);
}

/** En el resto del ERP: las tablas que no caben en el celular o que piden `enTarjetas`. */
export function useTablasEnTarjetasErp() {
  useEffect(() => vigilar(tablasDelErp), []);
}
