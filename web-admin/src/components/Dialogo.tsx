// 💬 Ventana del sistema para confirmar, pedir un texto (motivo) o avisar. Reemplaza a las ventanitas grises del
// navegador (window.confirm / prompt / alert), que se veían poco profesionales (auditoría 2026-10-20, fase 3).
// Se usa igual que antes pero con await:  if (!(await confirmar("¿Anular…?"))) return;
// El texto puede venir plano: la primera línea (o párrafo corto) se usa como título y el resto como detalle; el
// color y el botón se eligen solos según lo que se va a hacer (anular, eliminar, reversar… en rojo).
import { useEffect, useRef, useState } from "react";

export type OpcionesDialogo = {
  titulo?: string;
  mensaje?: string;
  /** Texto del botón principal. */
  confirmar?: string;
  cancelar?: string;
  tono?: "peligro" | "aviso" | "normal";
  /** Para pedirTexto: largo mínimo del texto (p. ej. 5 para un motivo). */
  minimo?: number;
  valorInicial?: string;
  placeholder?: string;
};

type Tipo = "confirmar" | "texto" | "aviso";
type Pedido = { tipo: Tipo; op: OpcionesDialogo; resolver: (v: boolean | string | null) => void };

let mostrar: ((p: Pedido) => void) | null = null;

const PELIGRO = /\b(anul|elimin|borr|descart|quit|revers|desactiv|inactiv|cancelar el|cancela el|no lleg|retir|reabr|sobregir|descontar)/i;

/** Arma título, detalle, tono y botón a partir de un texto plano. */
export function interpretar(texto: string, tipo: Tipo): OpcionesDialogo {
  const crudo = String(texto ?? "").trim();
  // «⚠️ …» al inicio: advertencia (amarilla); el ícono ya lo pone la ventana.
  const esAdvertencia = /^⚠️?\s*/.test(crudo) && crudo.startsWith("⚠");
  const t = esAdvertencia ? crudo.replace(/^⚠️?\s*/, "") : crudo;
  const partes = t.split(/\n\s*\n/);
  let titulo = "";
  let mensaje = t;
  const primera = partes[0].split("\n")[0].trim();
  if (partes.length > 1 && partes[0].length <= 140) {
    titulo = partes[0].trim();
    mensaje = partes.slice(1).join("\n\n").trim();
  } else if (primera.length <= 90 && t.includes("\n")) {
    titulo = primera;
    mensaje = t.slice(t.indexOf("\n") + 1).trim();
  } else if (t.length <= 110) {
    titulo = t;
    mensaje = "";
  } else {
    titulo = tipo === "aviso" ? "Aviso" : tipo === "texto" ? "Escribe el dato" : "¿Continuar?";
  }
  const peligro = PELIGRO.test(t);
  // El botón dice lo que hace: «Sí, anular» al confirmar; «Anular» al pedir el motivo.
  const verbo = /\banul/i.test(t) ? "anular" : /\belimin|\bborr/i.test(t) ? "eliminar" : /\bdescart/i.test(t) ? "descartar"
    : /\brevers/i.test(t) ? "reversar" : /\bquit/i.test(t) ? "quitar" : /\b(desactiv|inactiv)/i.test(t) ? "desactivar"
    : /\bguard/i.test(t) ? "guardar" : "";
  let boton = tipo === "aviso" ? "Entendido" : tipo === "texto" ? "Aceptar" : "Sí, continuar";
  if (verbo && tipo === "confirmar") boton = `Sí, ${verbo}`;
  if (verbo && tipo === "texto") boton = verbo.charAt(0).toUpperCase() + verbo.slice(1);
  // Cada pantalla valida su propio mínimo después; aquí solo se evita mandar un motivo vacío o de 1-2 letras.
  const minimo = tipo === "texto" && /motivo/i.test(t) ? 3 : undefined;
  return { titulo, mensaje, confirmar: boton, tono: peligro ? "peligro" : esAdvertencia ? "aviso" : "normal", minimo };
}

function abrir(tipo: Tipo, entrada: string | OpcionesDialogo, valorInicial?: string): Promise<boolean | string | null> {
  const base = typeof entrada === "string" ? interpretar(entrada, tipo) : { ...interpretar(entrada.mensaje ?? entrada.titulo ?? "", tipo), ...entrada };
  if (valorInicial !== undefined) base.valorInicial = valorInicial;
  if (!mostrar) {
    // Sin la ventana montada (no debería pasar): se usa la del navegador para no bloquear nada.
    const texto = [base.titulo, base.mensaje].filter(Boolean).join("\n\n");
    if (tipo === "confirmar") return Promise.resolve(window.confirm(texto));
    if (tipo === "texto") return Promise.resolve(window.prompt(texto, base.valorInicial ?? ""));
    window.alert(texto);
    return Promise.resolve(true);
  }
  const m = mostrar;
  return new Promise((resolver) => m({ tipo, op: base, resolver }));
}

/** Pide confirmar. Devuelve true si toca el botón principal. */
export function confirmar(entrada: string | OpcionesDialogo): Promise<boolean> {
  return abrir("confirmar", entrada) as Promise<boolean>;
}

/** Pide un texto (p. ej. el motivo). Devuelve el texto o null si cancela. */
export function pedirTexto(entrada: string | OpcionesDialogo, valorInicial?: string): Promise<string | null> {
  return abrir("texto", entrada, valorInicial) as Promise<string | null>;
}

/** Muestra un aviso con un solo botón. */
export async function avisar(entrada: string | OpcionesDialogo): Promise<void> {
  await abrir("aviso", entrada);
}

/** Se monta una sola vez (main.tsx). Atiende los pedidos en orden. */
export function DialogoHost() {
  const [cola, setCola] = useState<Pedido[]>([]);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const botonRef = useRef<HTMLButtonElement | null>(null);
  const actual = cola[0];

  useEffect(() => {
    mostrar = (p) => setCola((c) => [...c, p]);
    return () => { mostrar = null; };
  }, []);

  useEffect(() => {
    if (!actual) return;
    setTexto(actual.op.valorInicial ?? "");
    setError("");
    const t = setTimeout(() => (actual.tipo === "texto" ? inputRef.current?.focus() : botonRef.current?.focus()), 30);
    return () => clearTimeout(t);
  }, [actual]);

  if (!actual) return null;
  const { tipo, op } = actual;
  const peligro = op.tono === "peligro";
  const advertencia = op.tono === "aviso";

  const cerrar = (valor: boolean | string | null) => {
    actual.resolver(valor);
    setCola((c) => c.slice(1));
  };
  const aceptar = () => {
    if (tipo === "texto") {
      const v = texto.trim();
      if (op.minimo && v.length < op.minimo) { setError(`Escribe al menos ${op.minimo} letras.`); return; }
      cerrar(v);
      return;
    }
    cerrar(true);
  };
  const cancelar = () => cerrar(tipo === "texto" ? null : tipo === "aviso" ? true : false);

  return (
    <div className="dlg-fondo" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && tipo !== "aviso") cancelar(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); cancelar(); } }}>
      <div className={`dlg-caja ${peligro ? "is-peligro" : advertencia ? "is-aviso" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dlg-titulo">
        <div className="dlg-cabeza">
          <span className="dlg-icono" aria-hidden="true">{tipo === "aviso" ? "ℹ️" : tipo === "texto" ? "✍️" : peligro || advertencia ? "⚠️" : "❔"}</span>
          <div className="dlg-textos">
            <h3 id="dlg-titulo">{op.titulo}</h3>
            {op.mensaje ? <p className="dlg-mensaje">{op.mensaje}</p> : null}
          </div>
        </div>
        {tipo === "texto" && (
          <form className="dlg-campo" onSubmit={(e) => { e.preventDefault(); aceptar(); }}>
            <input ref={inputRef} value={texto} placeholder={op.placeholder ?? (op.minimo ? "Escribe el motivo" : "")}
              onChange={(e) => { setTexto(e.target.value); if (error) setError(""); }} />
            {error && <small className="dlg-error">{error}</small>}
          </form>
        )}
        <div className="dlg-botones">
          {tipo !== "aviso" && <button type="button" className="dlg-btn" onClick={cancelar}>{op.cancelar ?? "Cancelar"}</button>}
          <button type="button" ref={botonRef} className={`dlg-btn ${peligro ? "is-peligro" : "is-principal"}`} onClick={aceptar}>
            {op.confirmar ?? "Aceptar"}
          </button>
        </div>
      </div>
    </div>
  );
}
