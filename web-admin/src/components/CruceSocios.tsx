import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";
import { money } from "../format";
import { confirmar, pedirTexto } from "./Dialogo";

// ⇄ CRUZAR CUENTAS CON UN SOCIO (Por Cobrar / Por Pagar). La Matriz le debe a un socio y ese socio le
// debe a la Matriz: se compensa lo que se deben SIN mover caja (baja por igual las dos caras de cada
// deuda y al otro le llega un aviso). Se puede anular desde el historial.
type Par = { id: string; descripcion: string | null; fecha: string; saldo: number };
type Resumen = { me_debe: Par[]; le_debo: Par[]; total_me_debe: number; total_le_debo: number; maximo: number };
type Cruce = { id: string; monto: number; nota: string | null; created_at: string; anulado_at: string | null; contraparte: string; hecho_por_mi: boolean };

export function CruceSocios({ accionistas, activoId, avisar, onCambio }: {
  accionistas: Array<{ id: string; name: string; tipo?: string | null }>;
  activoId: string | null;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  /** Recarga Por Cobrar / Por Pagar después de cruzar o anular. */
  onCambio: () => unknown;
}) {
  const otros = accionistas.filter((a) => a.id !== activoId);
  const [abierto, setAbierto] = useState(false);
  const [socio, setSocio] = useState("");
  const [res, setRes] = useState<Resumen | null>(null);
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [historial, setHistorial] = useState<Cruce[]>([]);

  const cargarHistorial = useCallback(async () => {
    try { setHistorial(await apiGet<Cruce[]>("/receivable/cruce-socios")); } catch { setHistorial([]); }
  }, []);
  const cargar = useCallback(async (id: string) => {
    if (!id) { setRes(null); return; }
    try {
      const r = await apiGet<Resumen>(`/receivable/cruce-socios/resumen?contraparte_id=${id}`);
      setRes(r);
      setMonto(r.maximo > 0 ? r.maximo.toFixed(2) : "");
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo leer", "error"); }
  }, [avisar]);
  useEffect(() => { if (abierto) { void cargarHistorial(); if (!socio && otros.length === 1) setSocio(otros[0].id); } }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (abierto) void cargar(socio); }, [abierto, socio, cargar]);

  if (otros.length === 0) return null;
  const nombre = otros.find((a) => a.id === socio)?.name ?? "el socio";

  async function cruzar() {
    if (!res) return;
    const m = Number(monto);
    if (!(m > 0)) { avisar("Escribe el monto a cruzar", "error"); return; }
    if (!(await confirmar(`¿Cruzar ${money(m)} con ${nombre}?\n\nBaja ${money(m)} de lo que ${nombre} te debe y ${money(m)} de lo que tú le debes. No mueve caja.`))) return;
    setBusy(true);
    try {
      const r = await apiPost<{ monto: number; me_debe_queda: number; le_debo_queda: number }>("/receivable/cruce-socios", { contraparte_id: socio, monto: m, nota: nota.trim() || undefined });
      avisar(`Cruce de ${money(r.monto)} con ${nombre}. Te debe ${money(r.me_debe_queda)} · le debes ${money(r.le_debo_queda)}.`, "success");
      setNota("");
      await Promise.all([cargar(socio), cargarHistorial(), Promise.resolve(onCambio())]);
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo cruzar", "error"); } finally { setBusy(false); }
  }
  async function anular(c: Cruce) {
    const motivo = (await pedirTexto(`Anular el cruce de ${money(c.monto)} con ${c.contraparte}. Las deudas vuelven a como estaban.\n\nMotivo:`));
    if (!motivo || motivo.trim().length < 3) return;
    setBusy(true);
    try {
      await apiPost(`/receivable/cruce-socios/${c.id}/anular`, { motivo: motivo.trim() });
      avisar("Cruce anulado: las deudas volvieron a como estaban", "success");
      await Promise.all([cargar(socio), cargarHistorial(), Promise.resolve(onCambio())]);
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo anular", "error"); } finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" className="btnSecondary" onClick={() => setAbierto(true)} title="Compensar lo que un socio te debe con lo que tú le debes, sin mover caja">
        ⇄ Cruzar cuentas con un socio
      </button>
      {abierto && (
        <div className="modalOverlay" onClick={() => !busy && setAbierto(false)}>
          <div className="modalCard formPanel cruceSoc" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>⇄ Cruzar cuentas con un socio</h3>
            <p className="muted" style={{ marginTop: -4 }}>
              Si un socio te debe y tú también le debes, se compensa lo que se deben <strong>sin mover caja</strong>. Bajan
              las dos deudas por igual (también en los libros del socio, que recibe un aviso).
            </p>
            <label><span>Socio</span>
              <select value={socio} onChange={(e) => setSocio(e.target.value)}>
                <option value="">Elige…</option>
                {otros.map((a) => <option key={a.id} value={a.id}>{a.tipo === "MATRIZ" ? "🏭" : "🤝"} {a.name}</option>)}
              </select>
            </label>
            {socio && res && (
              <>
                <div className="cruceSoc__tot">
                  <div><small>{nombre} te debe</small><strong>{money(res.total_me_debe)}</strong><em>{res.me_debe.length} cuenta(s)</em></div>
                  <div><small>Tú le debes</small><strong>{money(res.total_le_debo)}</strong><em>{res.le_debo.length} cuenta(s)</em></div>
                  <div className="is-max"><small>Se puede cruzar</small><strong>{money(res.maximo)}</strong></div>
                </div>
                {res.maximo > 0.005 ? (
                  <>
                    <div className="cruceSoc__form">
                      <label><span>Monto a cruzar</span>
                        <input type="number" min="0.01" step="0.01" max={res.maximo} value={monto} onChange={(e) => setMonto(e.target.value)} />
                      </label>
                      <label><span>Nota <small className="muted">(opcional)</small></span>
                        <input type="text" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: cruce de octubre" />
                      </label>
                    </div>
                    <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 8px" }}>
                      Después del cruce: {nombre} te deberá {money(Math.max(0, res.total_me_debe - (Number(monto) || 0)))} y tú le deberás {money(Math.max(0, res.total_le_debo - (Number(monto) || 0)))}.
                      Se aplica a las cuentas más antiguas primero.
                    </p>
                    <div className="buttonRow">
                      <button type="button" className="primary" disabled={busy || !(Number(monto) > 0)} onClick={() => void cruzar()}>{busy ? "Cruzando…" : `⇄ Cruzar ${money(Number(monto) || 0)}`}</button>
                    </div>
                  </>
                ) : (
                  <p className="si-aviso" style={{ margin: "6px 0" }}>
                    {res.total_me_debe <= 0.005 ? `${nombre} no te debe nada` : `No le debes nada a ${nombre}`}: no hay qué cruzar.
                  </p>
                )}
              </>
            )}
            {historial.length > 0 && (
              <details className="cruceSoc__hist">
                <summary>Cruces anteriores ({historial.length})</summary>
                {historial.map((c) => (
                  <div key={c.id} className={`cruceSoc__fila ${c.anulado_at ? "is-anulado" : ""}`}>
                    <span>{new Date(c.created_at).toLocaleDateString("es-EC")} · {c.contraparte} · <strong>{money(c.monto)}</strong>{c.nota ? ` · ${c.nota}` : ""}{c.anulado_at ? " · anulado" : ""}</span>
                    {!c.anulado_at && <button type="button" className="btnGhost" disabled={busy} onClick={() => void anular(c)}>Anular</button>}
                  </div>
                ))}
              </details>
            )}
            <div className="buttonRow"><button type="button" onClick={() => setAbierto(false)} disabled={busy}>Cerrar</button></div>
          </div>
        </div>
      )}
    </>
  );
}
