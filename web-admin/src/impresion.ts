// 🖨️ IMPRESIÓN CENTRAL (pedido del dueño 2026-10-22: «ajustar impresora» en Configuración). La impresora es de cada
// EQUIPO (la PC del cajero, la tablet de báscula, el celular), así que su ajuste se guarda en ese equipo.
//  · NAVEGADOR: cualquier impresora que el equipo vea (Epson USB/WiFi, ticketera USB, Mopria en Android): se abre la
//    ventana de impresión con el tamaño de papel elegido para ese documento. En la PC del cajero se puede dejar
//    «directo» (Chrome en modo kiosko: imprime sin preguntar).
//  · RAWBT: impresora térmica Bluetooth en Android (como la de la báscula) mediante la app gratuita RawBT: el ticket se
//    convierte a texto de 32 (58 mm) o 48 (80 mm) columnas y se le envía.
export type Papel = "58" | "80" | "A4";
export type ModoImpresora = "NAVEGADOR" | "RAWBT";
/** ticket = venta al detalle · recibo = recibos y comprobantes de bodega/pagos · documento = hojas A4. */
export type TipoDocumento = "ticket" | "recibo" | "documento";

export type AjusteImpresora = {
  modo: ModoImpresora;
  /** Chrome en modo kiosko (--kiosk-printing): imprime sin la ventana de diálogo; se repite por cada copia. */
  directo: boolean;
  papel: Record<TipoDocumento, Papel>;
  copias: Record<TipoDocumento, number>;
  /** Tamaño de letra en %. */
  letra: number;
  margen: "minimo" | "normal";
};

export const AJUSTE_DEFECTO: AjusteImpresora = {
  modo: "NAVEGADOR",
  directo: false,
  papel: { ticket: "80", recibo: "80", documento: "A4" },
  copias: { ticket: 1, recibo: 1, documento: 1 },
  letra: 100,
  margen: "normal"
};

const CLAVE = "bascula-erp:impresora";

export function leerAjusteImpresora(): AjusteImpresora {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return AJUSTE_DEFECTO;
    const a = JSON.parse(crudo) as Partial<AjusteImpresora>;
    return {
      ...AJUSTE_DEFECTO, ...a,
      papel: { ...AJUSTE_DEFECTO.papel, ...(a.papel ?? {}) },
      copias: { ...AJUSTE_DEFECTO.copias, ...(a.copias ?? {}) }
    };
  } catch {
    return AJUSTE_DEFECTO;
  }
}

export function guardarAjusteImpresora(a: AjusteImpresora): void {
  try { localStorage.setItem(CLAVE, JSON.stringify(a)); } catch { /* sin almacenamiento: queda el de por defecto */ }
}

const ANCHO_MM: Record<Papel, number> = { "58": 48, "80": 72, A4: 180 };
export const COLUMNAS: Record<"58" | "80", number> = { "58": 32, "80": 48 };

/** Ajusta el HTML del documento al papel y la letra elegidos (sin tocar cómo se arma cada documento). */
export function ajustarHtml(html: string, papel: Papel, a: AjusteImpresora): string {
  const margen = a.margen === "minimo" ? (papel === "A4" ? 8 : 2) : (papel === "A4" ? 14 : 5);
  const ancho = ANCHO_MM[papel];
  const css = papel === "A4"
    ? `@page{size:A4;margin:${margen}mm}`
    : `@page{size:${papel}mm auto;margin:${margen}mm}
       html,body{width:${ancho}mm!important;max-width:${ancho}mm!important;margin:0 auto!important}
       .tk{width:${ancho}mm!important;max-width:${ancho}mm!important}
       table{width:100%!important}`;
  const zoom = a.letra !== 100 ? `body{zoom:${a.letra / 100}}` : "";
  const extra = `<style data-impresora>${css}${zoom}${papel === "58" ? "body{font-size:11px}th,td{padding:3px 1px!important}" : ""}</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${extra}</head>`) : `${extra}${html}`;
}

/** Abre el documento y su ventana de impresión. Si el navegador bloquea la ventana, imprime desde un marco oculto. */
function imprimirEnNavegador(html: string, copias: number, directo: boolean): boolean {
  const veces = directo ? Math.max(1, copias) : 1;
  const w = window.open("", "_blank", "width=480,height=720");
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    // Un respiro para que carguen imágenes y estilos antes de imprimir.
    setTimeout(() => { for (let i = 0; i < veces; i++) w.print(); }, 250);
    return true;
  }
  const marco = document.createElement("iframe");
  marco.setAttribute("aria-hidden", "true");
  Object.assign(marco.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(marco);
  const doc = marco.contentWindow?.document;
  if (!doc) { marco.remove(); return false; }
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    for (let i = 0; i < veces; i++) marco.contentWindow?.print();
    setTimeout(() => marco.remove(), 60_000);
  }, 250);
  return true;
}

// ── Texto para impresoras térmicas (RawBT) ────────────────────────────────────────────────────────────────────
const limpio = (t: string) => t.replace(/\s+/g, " ").trim();
// Centrado; si no entra, se parte en varias líneas centradas (no se corta).
const centrar = (t: string, n: number): string => envolver(t, n).split("\n").map((s) => " ".repeat(Math.max(0, Math.floor((n - s.length) / 2))) + s).join("\n");
const ambos = (izq: string, der: string, n: number) => {
  if (izq.length + der.length + 1 > n) return [izq.slice(0, n), der.padStart(n)].join("\n");
  return izq + " ".repeat(n - izq.length - der.length) + der;
};
function envolver(t: string, n: number): string {
  const palabras = t.split(" ");
  const lineas: string[] = [];
  let actual = "";
  for (const p of palabras) {
    if ((actual + " " + p).trim().length > n) { if (actual) lineas.push(actual); actual = p.slice(0, n); }
    else actual = (actual + " " + p).trim();
  }
  if (actual) lineas.push(actual);
  return lineas.join("\n");
}

/** Convierte un ticket HTML (los del ERP) a texto de columnas fijas para una térmica. */
export function htmlATexto(html: string, columnas: number): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,button,title").forEach((e) => e.remove());
  const raiz = doc.querySelector(".tk") ?? doc.body;
  const out: string[] = [];
  const linea = (c = "-") => out.push(c.repeat(columnas));
  const recorrer = (el: Element) => {
    for (const nodo of Array.from(el.childNodes)) {
      if (nodo.nodeType === Node.TEXT_NODE) { const t = limpio(nodo.textContent ?? ""); if (t) out.push(envolver(t, columnas)); continue; }
      if (!(nodo instanceof Element)) continue;
      const tag = nodo.tagName.toLowerCase();
      const cls = nodo.className?.toString() ?? "";
      const txt = limpio(nodo.textContent ?? "");
      if (tag === "hr") { linea(); continue; }
      if (tag === "br") continue;
      if (/^h[1-3]$/.test(tag) || /\b(sub|info|titulo|title|center)\b/.test(cls)) { if (txt) out.push(centrar(txt, columnas)); continue; }
      if (/\bfoot\b/.test(cls)) { linea(); for (const parte of (nodo.innerHTML.split(/<br\s*\/?>/i))) { const t = limpio(new DOMParser().parseFromString(parte, "text/html").body.textContent ?? ""); if (t) out.push(centrar(t, columnas)); } continue; }
      if (/\btot\b/.test(cls)) {
        const hijos = Array.from(nodo.children).map((c) => limpio(c.textContent ?? ""));
        linea("=");
        out.push(hijos.length >= 2 ? ambos(hijos[0], hijos[hijos.length - 1], columnas) : txt);
        continue;
      }
      if (tag === "table") {
        for (const tr of Array.from(nodo.querySelectorAll("tr"))) {
          const celdas = Array.from(tr.children).map((c) => limpio(c.textContent ?? "")).filter((c, i, arr) => c || i === 0 || i === arr.length - 1);
          if (!celdas.some(Boolean)) continue;
          if (tr.querySelector("th")) { out.push(celdas.join(" ").slice(0, columnas)); linea(); continue; }
          if (celdas.length === 1) { out.push(envolver(celdas[0], columnas)); continue; }
          const primera = celdas[0];
          const resto = celdas.slice(1).filter(Boolean).join("  ");
          out.push(ambos(primera, resto, columnas));
        }
        continue;
      }
      // Fila «etiqueta ... valor» (dos elementos en línea).
      const hijos = Array.from(nodo.children);
      if (hijos.length === 2 && hijos.every((h) => !h.querySelector("div,table,p"))) {
        out.push(ambos(limpio(hijos[0].textContent ?? ""), limpio(hijos[1].textContent ?? ""), columnas));
        continue;
      }
      if (hijos.length === 0) { if (txt) out.push(envolver(txt, columnas)); continue; }
      recorrer(nodo);
    }
  };
  recorrer(raiz);
  // Las térmicas imprimen letras latinas (tildes, ñ, $): se quitan emojis y símbolos que saldrían como basura.
  return out.join("\n").replace(/[^\n\x20-\xFF€]/gu, "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n") + "\n\n\n";
}

function enviarARawBT(texto: string): void {
  // RawBT (Android) recibe el texto por su enlace propio y lo imprime en la térmica Bluetooth que tenga configurada.
  window.location.href = `rawbt:${encodeURIComponent(texto)}`;
}

/**
 * Imprime un documento según el ajuste de ESTE equipo. `html` es el documento completo (como lo arma cada pantalla).
 * Devuelve false si no se pudo abrir la impresión.
 */
export function imprimirDocumento(html: string, tipo: TipoDocumento): boolean {
  const a = leerAjusteImpresora();
  const papel = a.papel[tipo];
  const copias = Math.max(1, Math.min(5, Math.round(a.copias[tipo] || 1)));
  if (a.modo === "RAWBT" && papel !== "A4") {
    const texto = htmlATexto(html, COLUMNAS[papel]);
    enviarARawBT(Array.from({ length: copias }, () => texto).join("\n"));
    return true;
  }
  return imprimirEnNavegador(ajustarHtml(html, papel, a), copias, a.directo);
}

/** Hoja de prueba para el tipo de documento: muestra el ancho útil y una tabla de ejemplo. */
export function paginaDePrueba(tipo: TipoDocumento, negocio: string): string {
  const a = leerAjusteImpresora();
  const papel = a.papel[tipo];
  const ahora = new Date().toLocaleString("es-EC", { hour12: false });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prueba de impresora</title><style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;margin:0}
    .tk{width:72mm;margin:0 auto} h1{font-size:16px;text-align:center;margin:0} .sub{text-align:center;font-weight:700;margin:2px 0 6px}
    .row{display:flex;justify-content:space-between;margin:2px 0} hr{border:none;border-top:1px dashed #333;margin:6px 0}
    table{width:100%;border-collapse:collapse} th{border-bottom:2px solid #111;text-align:left;font-size:11px} td{padding:4px 2px;border-bottom:1px dotted #bbb}
    td.n,th.n{text-align:right} .tot{display:flex;justify-content:space-between;font-size:17px;font-weight:900;border-top:2px solid #111;padding-top:5px;margin-top:6px}
    .foot{text-align:center;font-size:11px;margin-top:10px}
  </style></head><body><div class="tk">
    <h1>${negocio.replace(/</g, "&lt;")}</h1>
    <div class="sub">PRUEBA DE IMPRESORA</div>
    <div class="row"><span>Papel</span><span>${papel === "A4" ? "A4" : `${papel} mm`}</span></div>
    <div class="row"><span>Modo</span><span>${a.modo === "RAWBT" ? "Térmica Bluetooth (RawBT)" : a.directo ? "Directo (kiosko)" : "Ventana de impresión"}</span></div>
    <div class="row"><span>Fecha</span><span>${ahora}</span></div>
    <hr>
    <table><thead><tr><th>Producto</th><th class="n">Libras</th><th class="n">Total</th></tr></thead>
      <tbody><tr><td>Arroz 0.11</td><td class="n">10</td><td class="n">$5.00</td></tr><tr><td>Polvillo</td><td class="n">25</td><td class="n">$3.75</td></tr></tbody></table>
    <div class="tot"><span>TOTAL</span><span>$8.75</span></div>
    <div class="foot">Si este texto sale completo y centrado,<br>la impresora quedó bien ajustada.<br>ÁÉÍÓÚ ñÑ $ # %</div>
  </div></body></html>`;
}
