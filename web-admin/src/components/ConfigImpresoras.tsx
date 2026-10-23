// 🖨️ Ajuste de impresora de ESTE equipo, documento por documento (Configuración › Mi negocio y botón 🖨️ del menú de
// cada usuario: la tablet de báscula no entra a Configuración). Se guarda en el equipo; ver impresion.ts.
import { useEffect, useState } from "react";
import { apiGet } from "../api";
import {
  AJUSTE_DEFECTO, DOCUMENTOS, ajusteDe, esRollo, guardarAjusteImpresora, imprimirDocumento, leerAjusteImpresora, paginaDePrueba,
  type AjusteDocumento, type AjusteImpresora, type Papel
} from "../impresion";

const NOMBRE_PAPEL: Record<Papel, string> = { "58": "58 mm", "80": "80 mm", A4: "A4", CARTA: "Carta", A5: "Media hoja" };
const GRUPOS = [...new Set(DOCUMENTOS.map((d) => d.grupo))];

export function ConfigImpresoras({ negocio, avisar }: { negocio: string; avisar: (m: string, t?: "success" | "error" | "warn") => void }) {
  const [a, setA] = useState<AjusteImpresora>(() => leerAjusteImpresora());
  const [abierto, setAbierto] = useState<string>(GRUPOS[0]);
  // Impresoras de la PC del servidor (impresión directa, sin ventana).
  const [servidor, setServidor] = useState<{ disponible: boolean; falta: string | null; impresoras: Array<{ nombre: string; predeterminada: boolean; desconectada: boolean }> } | null>(null);
  useEffect(() => { apiGet<NonNullable<typeof servidor>>("/impresion/estado").then(setServidor).catch(() => setServidor(null)); }, []);
  const directas = servidor?.disponible ? servidor.impresoras : [];
  const valorSalida = (aj: AjusteDocumento) => aj.salida === "DIRECTA" && aj.impresora ? `DIRECTA:${aj.impresora}` : aj.salida;
  const leerSalida = (v: string): Partial<AjusteDocumento> => v.startsWith("DIRECTA:")
    ? { salida: "DIRECTA", impresora: v.slice(8) } : { salida: v as AjusteDocumento["salida"], impresora: undefined };
  const guardar = (nuevo: AjusteImpresora) => { setA(nuevo); guardarAjusteImpresora(nuevo); };
  const cambiarDoc = (id: string, p: Partial<AjusteDocumento>) => {
    const actual = ajusteDe(id, a);
    const sig = { ...actual, ...p };
    if (!esRollo(sig.papel) && sig.salida === "RAWBT") sig.salida = "VENTANA";
    guardar({ ...a, docs: { ...a.docs, [id]: sig } });
  };
  const aplicarATodos = (p: Partial<AjusteDocumento>, grupo: string) => {
    const docs = { ...a.docs };
    for (const d of DOCUMENTOS.filter((x) => x.grupo === grupo)) {
      const sig = { ...ajusteDe(d.id, a), ...p };
      if (!d.papeles.includes(sig.papel)) continue;
      if (!esRollo(sig.papel) && sig.salida === "RAWBT") sig.salida = "VENTANA";
      docs[d.id] = sig;
    }
    guardar({ ...a, docs });
  };
  const esAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
  const usaRawbt = DOCUMENTOS.some((d) => ajusteDe(d.id, a).salida === "RAWBT");

  return (
    <div className="impConf">
      <p className="muted" style={{ margin: 0 }}>
        Se guarda <b>en este equipo</b> (cada PC, tablet o celular tiene su impresora) y <b>cada documento tiene su ajuste</b>.
        Los cambios se guardan solos.
      </p>
      {servidor && (servidor.disponible ? (
        <small className="impConf__ayuda">
          🏢 Impresoras de la oficina para imprimir <b>directo, sin ventana</b> (también desde el celular o la tablet):{" "}
          {servidor.impresoras.map((i) => `${i.nombre}${i.predeterminada ? " (predeterminada)" : ""}${i.desconectada ? " · desconectada" : ""}`).join(" · ")}.
          Si la PC de la oficina está apagada, sale por la ventana de imprimir.
        </small>
      ) : (
        <small className="impConf__ayuda">⚠️ La impresión directa no está lista en el servidor{servidor.falta ? ` (falta ${servidor.falta})` : ""}: por ahora todo sale por la ventana de imprimir.</small>
      ))}

      <div className="impConf__docs">
        {GRUPOS.map((g) => {
          const docs = DOCUMENTOS.filter((d) => d.grupo === g);
          const open = abierto === g;
          return (
            <section key={g} className={`impConf__grupo ${open ? "is-open" : ""}`}>
              <button type="button" className="impConf__grupoCab" aria-expanded={open} onClick={() => setAbierto(open ? "" : g)}>
                <b>{g}</b>
                <small>{docs.map((d) => `${d.titulo.split(" (")[0]}: ${NOMBRE_PAPEL[ajusteDe(d.id, a).papel]}`).join(" · ")}</small>
                <span aria-hidden="true">{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <>
                  {docs.length > 1 && (
                    <div className="impConf__todos">
                      <small>Todos los de este grupo:</small>
                      {(["A4", "80"] as Papel[]).map((p) => (
                        <button key={p} type="button" className="btnGhost" onClick={() => aplicarATodos({ papel: p }, g)}>{NOMBRE_PAPEL[p]}</button>
                      ))}
                      {directas.length > 0 && (
                        <select aria-label="Todos a la impresora" value="" onChange={(e) => { if (e.target.value) aplicarATodos(leerSalida(e.target.value), g); }}>
                          <option value="">Todos a…</option>
                          <option value="VENTANA">🖨️ Ventana de imprimir</option>
                          {directas.map((i) => <option key={i.nombre} value={`DIRECTA:${i.nombre}`}>🏢 {i.nombre}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                  {docs.map((d) => {
                    const aj = ajusteDe(d.id, a);
                    return (
                      <div key={d.id} className="impConf__doc">
                        <div><b>{d.titulo}</b></div>
                        <div className="impConf__ops">
                          {d.papeles.map((p) => (
                            <button key={p} type="button" className={aj.papel === p ? "is-on" : ""} onClick={() => cambiarDoc(d.id, { papel: p })}>{NOMBRE_PAPEL[p]}</button>
                          ))}
                          {(esRollo(aj.papel) || directas.length > 0 || aj.salida === "DIRECTA") && (
                            <select aria-label="Sale por" value={valorSalida(aj)} onChange={(e) => cambiarDoc(d.id, leerSalida(e.target.value))}>
                              <option value="VENTANA">🖨️ Ventana de imprimir (eliges la impresora)</option>
                              {directas.map((i) => <option key={i.nombre} value={`DIRECTA:${i.nombre}`}>🏢 Directo a {i.nombre}{i.predeterminada ? " (predet.)" : ""}</option>)}
                              {aj.salida === "DIRECTA" && aj.impresora && !directas.some((i) => i.nombre === aj.impresora) && (
                                <option value={`DIRECTA:${aj.impresora}`}>🏢 Directo a {aj.impresora} (no disponible ahora)</option>
                              )}
                              {esRollo(aj.papel) && <option value="RAWBT">📲 Térmica Bluetooth (RawBT)</option>}
                            </select>
                          )}
                          <label className="impConf__copias">Copias
                            <select value={aj.copias} onChange={(e) => cambiarDoc(d.id, { copias: Number(e.target.value) })}>
                              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </label>
                          <button type="button" className="btnGhost" onClick={() => {
                            if (!imprimirDocumento(paginaDePrueba(d.id, negocio), d.id)) avisar("No se pudo abrir la impresión: permite ventanas emergentes.", "error");
                          }}>🧪 Prueba</button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </section>
          );
        })}
      </div>

      {usaRawbt && (
        <small className="impConf__ayuda">
          {esAndroid ? "" : "⚠️ La térmica Bluetooth es para tablets y celulares Android. "}
          Instala <b>RawBT</b> (Play Store, gratis), emparéjala con la impresora y elige su ancho (58 u 80 mm).
        </small>
      )}

      <div>
        <label className="impConf__check">
          <input type="checkbox" checked={a.directo} onChange={(e) => guardar({ ...a, directo: e.target.checked })} />
          Imprimir directo, sin preguntar (solo si este equipo tiene Chrome en modo kiosko)
        </label>
        {a.directo && (
          <small className="impConf__ayuda">
            En esta PC: acceso directo de Chrome con <code>--kiosk-printing</code> y la impresora elegida como predeterminada en Windows.
            Sin eso, igual se abre la ventana de imprimir.
          </small>
        )}
      </div>

      <div className="impConf__fila">
        <label>Tamaño de letra
          <select value={a.letra} onChange={(e) => guardar({ ...a, letra: Number(e.target.value) })}>
            <option value={90}>Pequeña</option><option value={100}>Normal</option><option value={115}>Grande</option>
          </select>
        </label>
        <label>Margen
          <select value={a.margen} onChange={(e) => guardar({ ...a, margen: e.target.value as AjusteImpresora["margen"] })}>
            <option value="normal">Normal</option><option value="minimo">Mínimo</option>
          </select>
        </label>
        <button type="button" className="btnGhost" onClick={() => { guardar(AJUSTE_DEFECTO); avisar("Impresora: valores de fábrica", "success"); }}>Volver a lo de fábrica</button>
      </div>
    </div>
  );
}
