// 🖨️ Ajuste de impresora de ESTE equipo (Configuración › Mi negocio y botón 🖨️ del menú de cada usuario: la tablet
// de báscula no entra a Configuración). Se guarda en el equipo; ver impresion.ts.
import { useState } from "react";
import {
  AJUSTE_DEFECTO, guardarAjusteImpresora, imprimirDocumento, leerAjusteImpresora, paginaDePrueba,
  type AjusteImpresora, type Papel, type TipoDocumento
} from "../impresion";

const DOCS: Array<{ tipo: TipoDocumento; titulo: string; detalle: string; papeles: Papel[] }> = [
  { tipo: "ticket", titulo: "Ticket de venta al detalle", detalle: "Mostrador y Caja › Venta Detalle", papeles: ["58", "80", "A4"] },
  { tipo: "recibo", titulo: "Recibos y comprobantes", detalle: "Recibos de pago 80 mm, orden de carga, salida a selección", papeles: ["58", "80", "A4"] },
  { tipo: "documento", titulo: "Documentos en hoja", detalle: "Guías, liquidaciones, reportes: la impresora y las copias se eligen en la ventana de imprimir", papeles: ["A4"] }
];

export function ConfigImpresoras({ negocio, avisar }: { negocio: string; avisar: (m: string, t?: "success" | "error" | "warn") => void }) {
  const [a, setA] = useState<AjusteImpresora>(() => leerAjusteImpresora());
  const cambiar = (p: Partial<AjusteImpresora>) => {
    const nuevo = { ...a, ...p };
    setA(nuevo);
    guardarAjusteImpresora(nuevo);
  };
  const esAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

  return (
    <div className="impConf">
      <p className="muted" style={{ margin: 0 }}>
        Se guarda <b>en este equipo</b> (cada PC, tablet o celular tiene su impresora). Los cambios se guardan solos.
      </p>

      <div>
        <span className="impConf__t">1 · ¿Cómo imprime este equipo?</span>
        <div className="impConf__modos">
          <button type="button" className={a.modo === "NAVEGADOR" ? "is-on" : ""} onClick={() => cambiar({ modo: "NAVEGADOR" })}>
            <b>🖨️ Impresora del equipo</b><small>Epson, ticketera USB o WiFi: se abre la ventana de imprimir</small>
          </button>
          <button type="button" className={a.modo === "RAWBT" ? "is-on" : ""} onClick={() => cambiar({ modo: "RAWBT" })}>
            <b>📲 Térmica Bluetooth</b><small>Tablet o celular Android con la app RawBT (como la de la báscula)</small>
          </button>
        </div>
        {a.modo === "NAVEGADOR" && (
          <label className="impConf__check">
            <input type="checkbox" checked={a.directo} onChange={(e) => cambiar({ directo: e.target.checked })} />
            Imprimir directo, sin preguntar (solo si esta PC tiene Chrome en modo kiosko)
          </label>
        )}
        {a.modo === "NAVEGADOR" && a.directo && (
          <small className="impConf__ayuda">
            En esta PC: acceso directo de Chrome con <code>--kiosk-printing</code> y la impresora elegida como predeterminada en Windows.
            Sin eso, igual se abre la ventana de imprimir.
          </small>
        )}
        {a.modo === "RAWBT" && (
          <small className="impConf__ayuda">
            {esAndroid ? "" : "⚠️ Esto es para Android. "}
            Instala <b>RawBT</b> (Play Store, gratis), emparéjala con la impresora Bluetooth y elige su ancho (58 u 80 mm).
            Los documentos en hoja (A4) siguen saliendo por la ventana de imprimir.
          </small>
        )}
      </div>

      <div>
        <span className="impConf__t">2 · Papel y copias por documento</span>
        <div className="impConf__docs">
          {DOCS.map((d) => (
            <div key={d.tipo} className="impConf__doc">
              <div><b>{d.titulo}</b><small>{d.detalle}</small></div>
              <div className="impConf__ops">
                {d.papeles.map((p) => (
                  <button key={p} type="button" className={a.papel[d.tipo] === p ? "is-on" : ""}
                    onClick={() => cambiar({ papel: { ...a.papel, [d.tipo]: p } })}>{p === "A4" ? "Hoja A4" : `${p} mm`}</button>
                ))}
                {d.tipo !== "documento" && (
                  <label className="impConf__copias">Copias
                    <select value={a.copias[d.tipo]} onChange={(e) => cambiar({ copias: { ...a.copias, [d.tipo]: Number(e.target.value) } })}>
                      {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
                <button type="button" className="btnGhost" onClick={() => {
                  if (!imprimirDocumento(paginaDePrueba(d.tipo, negocio), d.tipo)) avisar("No se pudo abrir la impresión: permite ventanas emergentes.", "error");
                }}>🧪 Prueba</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="impConf__fila">
        <label>Tamaño de letra
          <select value={a.letra} onChange={(e) => cambiar({ letra: Number(e.target.value) })}>
            <option value={90}>Pequeña</option><option value={100}>Normal</option><option value={115}>Grande</option>
          </select>
        </label>
        <label>Margen
          <select value={a.margen} onChange={(e) => cambiar({ margen: e.target.value as AjusteImpresora["margen"] })}>
            <option value="normal">Normal</option><option value="minimo">Mínimo</option>
          </select>
        </label>
        <button type="button" className="btnGhost" onClick={() => { setA(AJUSTE_DEFECTO); guardarAjusteImpresora(AJUSTE_DEFECTO); avisar("Impresora: valores de fábrica", "success"); }}>Volver a lo de fábrica</button>
      </div>
    </div>
  );
}
