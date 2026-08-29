// Partes Diarios de Cosecha (Reporte de Operadores). Sección del workspace de
// Campo. Persiste en el backend (tabla campo_partes vía /campo/partes). La
// máquina sale de la flota real (campo_activos); el operador se copia del activo
// pero queda editable. Mantiene los estilos de CajaModule.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api";
import { money } from "../format";

const hoy = () => new Date().toISOString().slice(0, 10);
const qqFmt = (n: number) => n.toLocaleString("es-EC", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Máquina = flota (campo_activos). Solo se usan nombre/operador/estado aquí.
type Activo = { id: string; nombre: string; operador: string | null; activo: boolean };
type Parte = {
  id: string; fecha: string; activo_id: string; activo_nombre: string; operador: string | null;
  cliente: string; qq: number; observaciones: string | null; estado: "por_cobrar" | "cobrado";
  // Cobro generado (campo_servicio) enlazado, si estado='cobrado'.
  servicio_id: string | null; servicio_valor: number | null; servicio_saldo: number | null;
  servicio_estado: "pendiente" | "abonado" | "pagado" | null;
};

export default function PartesModule() {
  const [activos, setActivos] = useState<Activo[]>([]);
  const [partes, setPartes] = useState<Parte[]>([]);
  const [f, setF] = useState({ fecha: hoy(), activo_id: "", operador: "", cliente: "", qq: "", observaciones: "" });
  const [busy, setBusy] = useState(false);
  const [cobrando, setCobrando] = useState<Parte | null>(null);
  const [flash, setFlash] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 3000); };

  const activosActivos = useMemo(() => activos.filter((a) => a.activo), [activos]);
  const totalQQ = useMemo(() => partes.reduce((s, p) => s + p.qq, 0), [partes]);

  const refrescar = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([apiGet<Activo[]>("/campo/activos?solo_activos=1"), apiGet<Parte[]>("/campo/partes")]);
      setActivos(a); setPartes(p);
    } catch (e) { notify((e as Error).message, "err"); }
  }, []);
  useEffect(() => { refrescar(); }, [refrescar]);

  // Al elegir máquina, se autocompleta el operador (editable).
  function elegirMaquina(activo_id: string) {
    const a = activos.find((x) => x.id === activo_id);
    setF((prev) => ({ ...prev, activo_id, operador: prev.operador || (a?.operador ?? "") }));
  }

  async function guardar() {
    try {
      setBusy(true);
      if (!f.activo_id) throw new Error("Elige la máquina / cosechadora");
      const cliente = f.cliente.trim();
      if (!cliente) throw new Error("Ingresa el cliente / dueño del cultivo");
      const qq = Number(f.qq);
      if (!(qq > 0)) throw new Error("Ingresa los quintales cosechados (mayor a 0)");
      await apiPost("/campo/partes", {
        fecha: f.fecha, activo_id: f.activo_id, operador: f.operador.trim() || undefined,
        cliente, qq, observaciones: f.observaciones.trim() || undefined
      });
      setF({ ...f, cliente: "", qq: "", observaciones: "" });
      await refrescar();
      notify("Reporte de cosecha guardado");
    } catch (e) { notify((e as Error).message, "err"); } finally { setBusy(false); }
  }

  const flashEl = flash && (
    <p style={{ margin: "0 0 10px", padding: "8px 12px", borderRadius: 8, fontWeight: 600,
      background: flash.kind === "ok" ? "var(--c-success-bg)" : "var(--c-danger-bg)",
      color: flash.kind === "ok" ? "#15803d" : "#b91c1c" }}>{flash.text}</p>
  );

  return (
    <section className="panelGrid">
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <h2 style={{ marginBottom: 2 }}>📝 Partes Diarios de Cosecha <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· reporte de operadores</span></h2>
        <p className="muted" style={{ margin: "2px 0 0" }}>Registro diario del trabajo de cada cosechadora para cobrar a clientes y controlar operadores.</p>
        {flashEl}
      </div>

      {/* A · Formulario de nuevo reporte */}
      <form className="formPanel" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
        <h2>＋ Nuevo reporte de cosecha</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
          <label><span>Máquina</span>
            <select value={f.activo_id} onChange={(e) => elegirMaquina(e.target.value)}>
              <option value="">Seleccione</option>
              {activosActivos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Operador</span>
            <input type="text" value={f.operador} onChange={(e) => setF({ ...f, operador: e.target.value })} placeholder="Ej: Juan Pérez" />
          </label>
          <label><span>Quintales cosechados [QQ]</span>
            <input type="number" step="0.01" min="0" value={f.qq} onChange={(e) => setF({ ...f, qq: e.target.value })} placeholder="Ej: 120" />
          </label>
        </div>
        <label><span>Cliente / Dueño del cultivo</span>
          <input type="text" value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} placeholder="Ej: Juan Piguave" />
        </label>
        <label><span>Observaciones (opcional)</span>
          <input type="text" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} placeholder="Ej: Terreno húmedo" />
        </label>
        <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar reporte"}</button>
        {activosActivos.length === 0 && (
          <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>No hay maquinaria activa. Da de alta cosechadoras en <strong>⚙️ Configuración → 🚜 Flota y Maquinaria</strong>.</p>
        )}
      </form>

      {/* B · Historial */}
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Historial de partes <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({partes.length})</span></h2>
          <div className="totalBox" style={{ minWidth: 130, margin: 0, marginLeft: "auto", background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <span>TOTAL QQ</span>
            <strong>{qqFmt(totalQQ)}</strong>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable" style={{ marginTop: 8 }}>
            <thead><tr>
              <th>Fecha</th><th>Operador</th><th>Máquina</th><th>Cliente</th>
              <th className="num">QQ cosechados</th><th>Observaciones</th><th>Estado</th>
            </tr></thead>
            <tbody>
              {partes.length === 0 ? (
                <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin partes registrados.</td></tr>
              ) : partes.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{String(p.fecha).slice(0, 10)}</td>
                  <td>{p.operador || "—"}</td>
                  <td>{p.activo_nombre}</td>
                  <td style={{ fontWeight: 600 }}>{p.cliente}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{qqFmt(p.qq)}</td>
                  <td>{p.observaciones || "—"}</td>
                  <td>
                    {p.estado === "cobrado" ? (
                      <>
                        <span className="chip ok">Cobro generado</span>
                        {p.servicio_estado && (
                          <small className="muted" style={{ display: "block", marginTop: 2 }}>
                            servicio: {p.servicio_estado}{p.servicio_saldo != null ? ` · saldo ${money(p.servicio_saldo)}` : ""}
                          </small>
                        )}
                      </>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                        <span className="chip warn">Por cobrar</span>
                        <button type="button" className="btnSecondary" onClick={() => setCobrando(p)}>💵 Generar cobro</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {cobrando && (
        <GenerarCobroModal parte={cobrando}
          onClose={() => setCobrando(null)}
          onDone={async () => { setCobrando(null); await refrescar(); notify("Cobro generado (servicio de cosecha)"); }}
          onError={(m) => notify(m, "err")} />
      )}
    </section>
  );
}

// Modal para generar el cobro de un parte: se ingresa el precio por QQ y se
// muestra el valor (QQ × precio). Confirma → crea el servicio y marca cobrado.
function GenerarCobroModal({ parte, onClose, onDone, onError }: {
  parte: Parte; onClose: () => void; onDone: () => void | Promise<void>; onError: (m: string) => void;
}) {
  const [precio, setPrecio] = useState("");
  const [busy, setBusy] = useState(false);
  const pu = Number(precio);
  const valido = precio !== "" && pu > 0;
  const valor = valido ? Math.round(parte.qq * pu * 100) / 100 : 0;

  async function submit() {
    try {
      setBusy(true);
      if (!valido) throw new Error("Ingresa el precio por QQ (mayor a 0)");
      await apiPost(`/campo/partes/${parte.id}/cobrar`, { precio_unitario: pu });
      await onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }}
        style={{ maxWidth: 440, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>💵 Generar cobro del parte</h2>
        <div className="totalBox" style={{ margin: "0 0 6px" }}>
          <span>{parte.cliente} · {parte.activo_nombre}</span>
          <strong>{qqFmt(parte.qq)} QQ</strong>
          <small>{String(parte.fecha).slice(0, 10)}{parte.operador ? ` · ${parte.operador}` : ""}</small>
        </div>
        <label><span>Precio por QQ $</span>
          <input type="number" step="0.0001" min="0" autoFocus value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej: 1.50" />
        </label>
        {valido && (
          <div className="totalBox" style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <span>VALOR DEL COBRO ({qqFmt(parte.qq)} × {money(pu)})</span>
            <strong>{money(valor)}</strong>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>Crea un servicio de cosecha (cliente + máquina del parte) que aparece en Servicios y en el reporte de Por Cobrar. Los abonos se registran ahí.</p>
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy || !valido}>{busy ? "Generando…" : "Generar cobro"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
