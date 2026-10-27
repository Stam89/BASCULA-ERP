// 🖨️ IMPRESIÓN CENTRAL (pedido del dueño 2026-10-22/23: «ajustar impresora» y que CADA documento tenga su ajuste).
// La impresora es de cada EQUIPO (PC del cajero, tablet de báscula, celular): el ajuste se guarda en ese equipo, y
// dentro de él cada documento (liquidación, estado de cuenta del fomento, guía, ticket…) tiene su propio papel, salida
// y copias.
//  · VENTANA: cualquier impresora que el equipo vea (Epson USB/WiFi, ticketera USB, Mopria en Android): se abre la
//    ventana de imprimir con el papel elegido. Con «directo» (Chrome en modo kiosko) imprime sin preguntar.
//  · RAWBT: térmica Bluetooth en Android con la app gratuita RawBT (solo papeles de 58/80 mm): el documento se
//    convierte a texto de 32 o 48 columnas y se le envía.
//  · DIRECTA (2026-10-23): a una impresora de la PC del servidor, por su nombre (EPSON L3150, EPSON L455…), sin
//    ventana y desde cualquier equipo: el servidor lo pasa a PDF y lo manda con SumatraPDF (routes/modules/impresion.ts).
// Cada pantalla sigue armando su documento como antes; en vez de window.open usa ventanaDeImpresion(<documento>).
// Papeles en cm que usa la piladora (pedido del dueño 2026-10-23): 10×10 (venta al detalle), 10.5×15 (recibo de venta) y
// 15×21 (todo lo demás). Además los de rollo (58/80 mm) y las hojas normales.
export type Papel = "58" | "80" | "10x10" | "10.5x15" | "15x21" | "A4" | "CARTA" | "A5";
/** Medida en mm de los papeles fijos (ancho × alto). */
export const MEDIDA_MM: Record<Exclude<Papel, "58" | "80">, [number, number]> = {
  "10x10": [100, 100], "10.5x15": [105, 150], "15x21": [150, 210], A4: [210, 297], CARTA: [216, 279], A5: [148, 210]
};
export const NOMBRE_PAPEL: Record<Papel, string> = {
  "58": "Rollo 58 mm", "80": "Rollo 80 mm", "10x10": "10 × 10 cm", "10.5x15": "10,5 × 15 cm", "15x21": "15 × 21 cm",
  A4: "A4", CARTA: "Carta", A5: "Media hoja (A5)"
};
import { apiPost } from "./api";
import { confirmar } from "./components/Dialogo";

export type Salida = "VENTANA" | "RAWBT" | "DIRECTA";
/** `impresora`: nombre en Windows de la PC del servidor (solo con salida DIRECTA). */
/** Qué hacer cuando un documento se manda a imprimir (al registrar o con su botón): imprimir directo, preguntar antes
 *  o no imprimir. Igual para todos los documentos (pedido del dueño 2026-10-27). */
export type AlRegistrar = "IMPRIMIR" | "PREGUNTAR" | "NO";
export type AjusteDocumento = { papel: Papel; salida: Salida; copias: number; impresora?: string; alRegistrar?: AlRegistrar };

export type DocumentoImprimible = { id: string; titulo: string; grupo: string; papel: Papel; papeles: Papel[] };
/** Todas las medidas, iguales para todos los documentos (pedido del dueño 2026-10-27). */
export const PAPELES: Papel[] = ["10x10", "10.5x15", "15x21", "A5", "A4", "CARTA", "58", "80"];
const PEQUENO = PAPELES, HOJA = PAPELES, HOJA_O_ROLLO = PAPELES;

/** Todos los documentos que el ERP imprime. El id se usa en ventanaDeImpresion(id). */
export const DOCUMENTOS: DocumentoImprimible[] = [
  { id: "venta_detalle", titulo: "Ticket de venta al detalle", grupo: "Ventas y bodega", papel: "10x10", papeles: PEQUENO },
  { id: "recibo_venta", titulo: "Recibo de venta", grupo: "Ventas y bodega", papel: "10.5x15", papeles: HOJA_O_ROLLO },
  { id: "guia_remision", titulo: "Guía de remisión", grupo: "Ventas y bodega", papel: "15x21", papeles: HOJA },
  { id: "orden_carga", titulo: "Orden de carga", grupo: "Ventas y bodega", papel: "15x21", papeles: PEQUENO },
  { id: "salida_seleccion", titulo: "Salida a selección / envejecido", grupo: "Ventas y bodega", papel: "15x21", papeles: PEQUENO },
  { id: "liquidacion", titulo: "Liquidación de agricultor", grupo: "Liquidaciones y fomentos", papel: "15x21", papeles: HOJA_O_ROLLO },
  { id: "estado_fomento", titulo: "Estado de cuenta del fomento", grupo: "Liquidaciones y fomentos", papel: "15x21", papeles: HOJA },
  { id: "rol_pago", titulo: "Rol de pago (hoja)", grupo: "Nómina y cuadrilla", papel: "15x21", papeles: HOJA },
  { id: "recibo_pago_80", titulo: "Recibo de pago (rollo 80 mm)", grupo: "Nómina y cuadrilla", papel: "15x21", papeles: PEQUENO },
  { id: "recibo_trabajador", titulo: "Recibo de trabajador", grupo: "Nómina y cuadrilla", papel: "15x21", papeles: HOJA_O_ROLLO },
  { id: "pago_semana", titulo: "Pago de la semana", grupo: "Nómina y cuadrilla", papel: "15x21", papeles: HOJA },
  { id: "cuadrilla_resumen", titulo: "Resumen de cuadrilla", grupo: "Nómina y cuadrilla", papel: "15x21", papeles: HOJA },
  { id: "cuadrilla_recibo", titulo: "Recibo de cuadrilla", grupo: "Nómina y cuadrilla", papel: "15x21", papeles: HOJA_O_ROLLO },
  { id: "bajada_carro", titulo: "Recibo de bajada de carro", grupo: "Nómina y cuadrilla", papel: "15x21", papeles: HOJA_O_ROLLO },
  { id: "estado_cuenta", titulo: "Estado de cuenta (Por Cobrar / Por Pagar)", grupo: "Cuentas y caja", papel: "15x21", papeles: HOJA },
  { id: "caja_movimientos", titulo: "Movimientos y cierre de caja", grupo: "Cuentas y caja", papel: "15x21", papeles: HOJA },
  { id: "reporte", titulo: "Reportes (tablas)", grupo: "Reportes y contabilidad", papel: "15x21", papeles: HOJA },
  { id: "consolidado", titulo: "Consolidado", grupo: "Reportes y contabilidad", papel: "15x21", papeles: HOJA },
  { id: "estados_financieros", titulo: "Estados financieros", grupo: "Reportes y contabilidad", papel: "15x21", papeles: HOJA },
  { id: "resultado_mensual", titulo: "Resultado mensual", grupo: "Reportes y contabilidad", papel: "15x21", papeles: HOJA },
  { id: "transporte_caja", titulo: "Caja de Transporte", grupo: "Transporte y Cosechadora", papel: "15x21", papeles: HOJA },
  { id: "transporte_estado_cuenta", titulo: "Estado de cuenta de cliente", grupo: "Transporte y Cosechadora", papel: "15x21", papeles: HOJA },
  { id: "transporte_compensacion", titulo: "Comprobante de compensación", grupo: "Transporte y Cosechadora", papel: "15x21", papeles: HOJA },
  { id: "transporte_pago_cxp", titulo: "Comprobante de pago (Por Pagar)", grupo: "Transporte y Cosechadora", papel: "15x21", papeles: HOJA }
];
export type DocumentoId = (typeof DOCUMENTOS)[number]["id"];

export type AjusteImpresora = {
  /** Chrome en modo kiosko (--kiosk-printing): imprime sin la ventana de diálogo; se repite por cada copia. */
  directo: boolean;
  /** Tamaño de letra en %. */
  letra: number;
  margen: "minimo" | "normal";
  /** Ajuste de cada documento (los que no están, usan su papel de fábrica). */
  docs: Record<string, AjusteDocumento>;
  /** 2 = con los papeles en cm de la piladora (2026-10-23). */
  version?: number;
};

export const AJUSTE_DEFECTO: AjusteImpresora = { directo: false, letra: 100, margen: "normal", docs: {}, version: 2 };

const CLAVE = "bascula-erp:impresora";

export function leerAjusteImpresora(): AjusteImpresora {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return AJUSTE_DEFECTO;
    const a = JSON.parse(crudo) as Partial<AjusteImpresora> & { modo?: string; papel?: Record<string, Papel>; copias?: Record<string, number> };
    const docs: Record<string, AjusteDocumento> = { ...(a.docs ?? {}) };
    // Ajuste de la primera versión (por tipo: ticket / recibo / documento): se pasa a cada documento.
    if (a.papel && !a.docs) {
      const salida: Salida = a.modo === "RAWBT" ? "RAWBT" : "VENTANA";
      const de = (tipo: string) => ({ papel: a.papel?.[tipo] ?? "80", salida, copias: a.copias?.[tipo] ?? 1 });
      docs.venta_detalle = de("ticket");
      for (const id of ["orden_carga", "salida_seleccion", "recibo_pago_80"]) docs[id] = de("recibo");
    }
    // Antes de los papeles en cm (versión 2): cada documento pasa a su tamaño de la piladora; se conservan la
    // impresora, la salida y las copias que ya se habían elegido.
    if ((a.version ?? 1) < 2) {
      for (const id of Object.keys(docs)) {
        const doc = DOCUMENTOS.find((d) => d.id === id);
        if (doc && docs[id].salida !== "RAWBT") docs[id] = { ...docs[id], papel: doc.papel };
      }
    }
    return { directo: !!a.directo, letra: Number(a.letra) || 100, margen: a.margen === "minimo" ? "minimo" : "normal", docs, version: 2 };
  } catch {
    return AJUSTE_DEFECTO;
  }
}

export function guardarAjusteImpresora(a: AjusteImpresora): void {
  try { localStorage.setItem(CLAVE, JSON.stringify(a)); } catch { /* sin almacenamiento: queda el de por defecto */ }
}

export const esRollo = (p: Papel) => p === "58" || p === "80";

/** Ajuste de un documento en este equipo (o el de fábrica). */
export function ajusteDe(id: string, a: AjusteImpresora = leerAjusteImpresora()): AjusteDocumento {
  const doc = DOCUMENTOS.find((d) => d.id === id);
  const guardado = a.docs[id];
  const papel = guardado && (!doc || doc.papeles.includes(guardado.papel)) ? guardado.papel : (doc?.papel ?? "A4");
  return {
    papel,
    salida: guardado?.salida === "RAWBT" && esRollo(papel) ? "RAWBT" : guardado?.salida === "DIRECTA" && guardado.impresora ? "DIRECTA" : "VENTANA",
    copias: Math.max(1, Math.min(5, Math.round(guardado?.copias || 1))),
    impresora: guardado?.salida === "DIRECTA" ? guardado.impresora : undefined,
    alRegistrar: guardado?.alRegistrar === "PREGUNTAR" || guardado?.alRegistrar === "NO" ? guardado.alRegistrar : "IMPRIMIR"
  };
}



const ANCHO_MM: Record<"58" | "80", number> = { "58": 48, "80": 72 };
export const COLUMNAS: Record<"58" | "80", number> = { "58": 32, "80": 48 };

/** Ajusta el HTML del documento al papel y la letra elegidos (sin tocar cómo se arma cada documento). */
export function ajustarHtml(html: string, papel: Papel, a: AjusteImpresora): string {
  // (papeles fijos: el contenido ocupa el ancho útil del papel; los chicos con letra algo menor)
  // Algunos documentos traían su propio «imprimir al abrir»: ahora imprime este módulo (si no, saldrían dos veces).
  const sinAuto = html.replace(/<script>\s*window\.onload\s*=\s*function\s*\(\)\s*\{\s*window\.print\(\)\s*\}\s*<\/script>/gi, "");
  let css: string;
  if (esRollo(papel)) {
    const margen = a.margen === "minimo" ? 2 : 5;
    const ancho = ANCHO_MM[papel as "58" | "80"];
    css = `@page{size:${papel}mm auto;margin:${margen}mm}
       html,body{width:${ancho}mm!important;max-width:${ancho}mm!important;margin:0 auto!important}
       .tk,.sheet{width:${ancho}mm!important;max-width:${ancho}mm!important}
       table{width:100%!important}${papel === "58" ? "body{font-size:11px}th,td{padding:3px 1px!important}" : ""}`;
  } else {
    const [ancho, alto] = MEDIDA_MM[papel as Exclude<Papel, "58" | "80">];
    const chico = ancho <= 160;
    const margen = a.margen === "minimo" ? (chico ? 3 : 8) : (chico ? 6 : 14);
    const util = ancho - margen * 2;
    css = `@page{size:${ancho}mm ${alto}mm;margin:${margen}mm}` + (chico
      ? `html,body{max-width:${util}mm!important;margin:0 auto!important}
         .tk,.sheet{width:auto!important;max-width:${util}mm!important}
         table{width:100%!important} img{max-width:100%}
         body{font-size:${ancho <= 110 ? 11 : 12}px}${ancho <= 110 ? "h1{font-size:14px!important}th,td{padding:3px 2px!important}" : ""}`
      : "");
  }
  const zoom = a.letra !== 100 ? `body{zoom:${a.letra / 100}}` : "";
  const extra = `<style data-impresora>${css}${zoom}</style>`;
  return /<\/head>/i.test(sinAuto) ? sinAuto.replace(/<\/head>/i, `${extra}</head>`) : `${extra}${sinAuto}`;
}

/** Abre el documento y su ventana de impresión. Si el navegador bloquea la ventana, imprime desde un marco oculto. */
function imprimirEnNavegador(html: string, copias: number, directo: boolean): boolean {
  const veces = directo ? Math.max(1, copias) : 1;
  const w = window.open("", "_blank", "width=820,height=760");
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
 * Imprime un documento con SU ajuste en este equipo. `html` es el documento completo (como lo arma cada pantalla).
 * Devuelve false si no se pudo abrir la impresión.
 */
/** Avisos de la impresión (la pantalla los muestra como toast): «erp-impresion» con { mensaje, tipo }. */
function avisar(mensaje: string, tipo: "success" | "error" | "warn") {
  try { window.dispatchEvent(new CustomEvent("erp-impresion", { detail: { mensaje, tipo } })); } catch { /* sin pantalla */ }
}

/**
 * Imprime un documento con el ajuste de este equipo. «Al imprimir» decide: directo, preguntar antes o no imprimir
 * (`forzar` lo salta: la hoja de prueba siempre sale).
 */
export function imprimirDocumento(html: string, id: DocumentoId | string, forzar = false): boolean {
  const d = ajusteDe(id);
  const titulo = DOCUMENTOS.find((x) => x.id === id)?.titulo ?? "Documento";
  if (!forzar && d.alRegistrar === "NO") {
    avisar(`«${titulo}» no se imprimió: en 🖨️ Impresoras está en «no imprimir».`, "warn");
    return true;
  }
  if (!forzar && d.alRegistrar === "PREGUNTAR") {
    confirmar({ titulo: "🖨️ ¿Imprimir?", mensaje: `¿Imprimir «${titulo}»?`, confirmar: "Sí, imprimir" })
      .then((si) => { if (si) imprimirYa(html, id); })
      .catch(() => undefined);
    return true;
  }
  return imprimirYa(html, id);
}

function imprimirYa(html: string, id: DocumentoId | string): boolean {
  const a = leerAjusteImpresora();
  const d = ajusteDe(id, a);
  if (d.salida === "DIRECTA" && d.impresora) {
    const listo = ajustarHtml(html, d.papel, a);
    const titulo = DOCUMENTOS.find((x) => x.id === id)?.titulo ?? "Documento";
    avisar(`🖨️ Enviando «${titulo}» a ${d.impresora}…`, "success");
    apiPost<{ ok: boolean; desconectada?: boolean }>("/impresion/imprimir", { impresora: d.impresora, html: listo, copias: d.copias, titulo })
      .then((r) => avisar(r.desconectada ? `⚠️ ${d.impresora} figura desconectada: revisa que esté prendida (el trabajo quedó en su cola).` : `✓ «${titulo}» enviado a ${d.impresora}`, r.desconectada ? "warn" : "success"))
      .catch((e: unknown) => {
        // Sin servidor o sin impresora: se imprime por la ventana de siempre.
        avisar(`No se pudo imprimir directo en ${d.impresora} (${e instanceof Error ? e.message : "error"}). Se abre la ventana de imprimir.`, "warn");
        imprimirEnNavegador(listo, d.copias, a.directo);
      });
    return true;
  }
  if (d.salida === "RAWBT" && esRollo(d.papel)) {
    const texto = htmlATexto(html, COLUMNAS[d.papel as "58" | "80"]);
    enviarARawBT(Array.from({ length: d.copias }, () => texto).join("\n"));
    return true;
  }
  return imprimirEnNavegador(ajustarHtml(html, d.papel, a), d.copias, a.directo);
}

/**
 * Reemplazo de `window.open("", "_blank")` para las pantallas que escriben su documento en una ventana: junta lo
 * escrito y, al cerrar el documento, lo imprime con el ajuste de ESE documento. `print()`/`focus()` no hacen nada
 * (ya imprime el módulo), así las pantallas no cambian su forma de armar el documento.
 */
export function ventanaDeImpresion(id: DocumentoId | string) {
  let html = "";
  let enviado = false;
  const enviar = () => { if (!enviado) { enviado = true; imprimirDocumento(html, id); } };
  return {
    document: {
      write: (parte: string) => { html += parte; },
      close: () => enviar()
    },
    focus: () => undefined,
    print: () => enviar(),
    close: () => undefined
  };
}

/** Hoja de prueba de un documento: muestra papel, salida y una tabla de ejemplo. */
export function paginaDePrueba(id: string, negocio: string): string {
  const d = ajusteDe(id);
  const doc = DOCUMENTOS.find((x) => x.id === id);
  const a = leerAjusteImpresora();
  const ahora = new Date().toLocaleString("es-EC", { hour12: false });
  const papelTxt = NOMBRE_PAPEL[d.papel];
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prueba de impresora</title><style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;margin:0}
    .tk{width:72mm;margin:0 auto} h1{font-size:16px;text-align:center;margin:0} .sub{text-align:center;font-weight:700;margin:2px 0 6px}
    .row{display:flex;justify-content:space-between;margin:2px 0} hr{border:none;border-top:1px dashed #333;margin:6px 0}
    table{width:100%;border-collapse:collapse} th{border-bottom:2px solid #111;text-align:left;font-size:11px} td{padding:4px 2px;border-bottom:1px dotted #bbb}
    td.n,th.n{text-align:right} .tot{display:flex;justify-content:space-between;font-size:17px;font-weight:900;border-top:2px solid #111;padding-top:5px;margin-top:6px}
    .foot{text-align:center;font-size:11px;margin-top:10px}
  </style></head><body><div class="tk"${esRollo(d.papel) ? "" : ' style="width:auto"'}>
    <h1>${negocio.replace(/</g, "&lt;")}</h1>
    <div class="sub">PRUEBA · ${(doc?.titulo ?? id).replace(/</g, "&lt;")}</div>
    <div class="row"><span>Papel</span><span>${papelTxt}</span></div>
    <div class="row"><span>Sale por</span><span>${d.salida === "RAWBT" ? "Térmica Bluetooth (RawBT)" : a.directo ? "Directo (kiosko)" : "Ventana de imprimir"}</span></div>
    <div class="row"><span>Copias</span><span>${d.copias}</span></div>
    <div class="row"><span>Fecha</span><span>${ahora}</span></div>
    <hr>
    <table><thead><tr><th>Producto</th><th class="n">Libras</th><th class="n">Total</th></tr></thead>
      <tbody><tr><td>Arroz 0.11</td><td class="n">10</td><td class="n">$5.00</td></tr><tr><td>Polvillo</td><td class="n">25</td><td class="n">$3.75</td></tr></tbody></table>
    <div class="tot"><span>TOTAL</span><span>$8.75</span></div>
    <div class="foot">Si este texto sale completo y centrado,<br>la impresora quedó bien ajustada.<br>ÁÉÍÓÚ ñÑ $ # %</div>
  </div></body></html>`;
}
