// Partes Diarios de Cosecha (Reporte de Operadores). Sección del workspace de
// Campo. Persiste en el backend (tabla campo_partes vía /campo/partes). La
// máquina sale de la flota real (campo_activos); el operador se copia del activo
// pero queda editable. Mantiene los estilos de CajaModule.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiGet, apiPost } from "../api";
import { money } from "../format";

const hoy = () => new Date().toISOString().slice(0, 10);
const qqFmt = (n: number) => n.toLocaleString("es-EC", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// PATCH/DELETE a /campo/partes/:id (apiPost solo cubre POST/GET).
async function parteReq(path: string, method: "PATCH" | "DELETE", body?: unknown): Promise<unknown> {
  const r = await apiFetch(path, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "No se pudo completar la operación");
  return r.json().catch(() => ({}));
}

// Máquina = flota (campo_activos). Solo se usan nombre/operador/estado aquí.
type Activo = { id: string; nombre: string; operador: string | null; activo: boolean };
// Operador (catálogo campo_operadores). En el parte se guarda su NOMBRE (texto).
type Operador = { id: string; nombre: string; activo: boolean };
type Parte = {
  id: string; fecha: string; activo_id: string; activo_nombre: string; operador: string | null;
  cliente: string; qq: number; observaciones: string | null; estado: "por_cobrar" | "cobrado"; origen: string;
  // Cobro generado (campo_servicio) enlazado, si estado='cobrado'.
  servicio_id: string | null; servicio_valor: number | null; servicio_saldo: number | null;
  servicio_estado: "pendiente" | "abonado" | "pagado" | null;
};

export default function PartesModule() {
  const [activos, setActivos] = useState<Activo[]>([]);
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [partes, setPartes] = useState<Parte[]>([]);
  const [f, setF] = useState({ fecha: hoy(), activo_id: "", operador: "", cliente: "", qq: "", observaciones: "" });
  const [busy, setBusy] = useState(false);
  const [cobrando, setCobrando] = useState<Parte | null>(null);
  const [editando, setEditando] = useState<Parte | null>(null);
  const [editandoTarifa, setEditandoTarifa] = useState<Parte | null>(null);
  const [filtro, setFiltro] = useState({ from: "", to: "", activo_id: "", estado: "" });
  const [flash, setFlash] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 3000); };

  const activosActivos = useMemo(() => activos.filter((a) => a.activo), [activos]);
  const totalQQ = useMemo(() => partes.reduce((s, p) => s + p.qq, 0), [partes]);

  const cargarPartes = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filtro.from) qs.set("from", filtro.from);
    if (filtro.to) qs.set("to", filtro.to);
    if (filtro.activo_id) qs.set("activo_id", filtro.activo_id);
    if (filtro.estado) qs.set("estado", filtro.estado);
    setPartes(await apiGet<Parte[]>(`/campo/partes?${qs.toString()}`));
  }, [filtro]);
  const refrescar = useCallback(async () => {
    try {
      await Promise.all([
        apiGet<Activo[]>("/campo/activos?solo_activos=1").then(setActivos),
        apiGet<Operador[]>("/campo/operadores?solo_activos=1").then(setOperadores),
        cargarPartes()
      ]);
    } catch (e) { notify((e as Error).message, "err"); }
  }, [cargarPartes]);
  useEffect(() => { refrescar(); }, [refrescar]);

  async function anular(p: Parte) {
    if (!window.confirm(`¿Anular el parte de ${p.cliente} (${qqFmt(p.qq)} QQ)? Esta acción no se puede deshacer.`)) return;
    try { await parteReq(`/campo/partes/${p.id}`, "DELETE"); await refrescar(); notify("Parte anulado"); }
    catch (e) { notify((e as Error).message, "err"); }
  }
  async function descobrar(p: Parte) {
    if (!window.confirm(`¿Des-cobrar el parte de ${p.cliente}? Se borrará el servicio de cobro generado.`)) return;
    try { await apiPost(`/campo/partes/${p.id}/descobrar`, {}); await refrescar(); notify("Cobro anulado; el parte vuelve a Por cobrar"); }
    catch (e) { notify((e as Error).message, "err"); }
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
            <select value={f.activo_id} onChange={(e) => setF({ ...f, activo_id: e.target.value })}>
              <option value="">Seleccione</option>
              {activosActivos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Operador</span>
            <select value={f.operador} onChange={(e) => setF({ ...f, operador: e.target.value })}>
              <option value="">(sin operador)</option>
              {operadores.map((o) => <option key={o.id} value={o.nombre}>{o.nombre}</option>)}
            </select>
          </label>
          <label><span>Quintales cosechados [QQ]</span>
            <input type="number" step="0.01" min="0" value={f.qq} onChange={(e) => setF({ ...f, qq: e.target.value })} placeholder="Ej: 120" />
          </label>
        </div>
        {operadores.length === 0 && (
          <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>No hay operadores. Agrégalos en <strong>⚙️ Configuración → 👷 Operadores</strong>.</p>
        )}
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
        {/* Filtros */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <label style={{ margin: 0 }}><span>Desde</span><input type="date" value={filtro.from} onChange={(e) => setFiltro({ ...filtro, from: e.target.value })} /></label>
          <label style={{ margin: 0 }}><span>Hasta</span><input type="date" value={filtro.to} onChange={(e) => setFiltro({ ...filtro, to: e.target.value })} /></label>
          <label style={{ margin: 0 }}><span>Máquina</span>
            <select value={filtro.activo_id} onChange={(e) => setFiltro({ ...filtro, activo_id: e.target.value })}>
              <option value="">Todas</option>
              {activos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
          <label style={{ margin: 0 }}><span>Estado</span>
            <select value={filtro.estado} onChange={(e) => setFiltro({ ...filtro, estado: e.target.value })}>
              <option value="">Todos</option>
              <option value="por_cobrar">Por cobrar</option>
              <option value="cobrado">Cobro generado</option>
            </select>
          </label>
          {(filtro.from || filtro.to || filtro.activo_id || filtro.estado) && (
            <button type="button" className="btnSecondary" onClick={() => setFiltro({ from: "", to: "", activo_id: "", estado: "" })}>Limpiar</button>
          )}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable" style={{ marginTop: 8 }}>
            <thead><tr>
              <th>Fecha</th><th>Operador</th><th>Máquina</th><th>Cliente</th>
              <th className="num">QQ cosechados</th><th>Observaciones</th><th>Estado</th><th>Acciones</th>
            </tr></thead>
            <tbody>
              {partes.length === 0 ? (
                <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin partes registrados.</td></tr>
              ) : partes.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{String(p.fecha).slice(0, 10)}</td>
                  <td>{p.operador || "—"}</td>
                  <td>{p.activo_nombre}</td>
                  <td style={{ fontWeight: 600 }}>
                    {p.cliente}
                    {p.origen === "bascula" && (
                      <span className="chip" style={{ marginLeft: 6, background: "#1d4ed8", color: "#fff", fontWeight: 600 }}
                        title={p.observaciones ?? "Generado desde el ingreso de báscula"}>⚖️ Báscula</span>
                    )}
                  </td>
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
                    ) : <span className="chip warn">Por cobrar</span>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {p.estado === "por_cobrar" ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="btnSecondary" onClick={() => setCobrando(p)}>💵 Cobrar</button>
                        <button type="button" className="btnSecondary" onClick={() => setEditando(p)}>✏️ Editar</button>
                        <button type="button" className="btnSecondary" onClick={() => anular(p)}>🗑️ Anular</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="btnSecondary" disabled={p.servicio_estado !== "pendiente"}
                          title={p.servicio_estado !== "pendiente" ? "El cobro ya tiene abonos; reversa los abonos en Caja primero." : "Editar el precio por QQ / monto total del cobro"}
                          onClick={() => setEditandoTarifa(p)}>✏️ Tarifa</button>
                        <button type="button" className="btnSecondary" disabled={p.servicio_estado !== "pendiente"}
                          title={p.servicio_estado !== "pendiente" ? "El cobro ya tiene abonos; reversa los abonos en Caja primero." : "Anular el cobro y volver a Por cobrar"}
                          onClick={() => descobrar(p)}>↩️ Des-cobrar</button>
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
      {editando && (
        <EditarParteModal parte={editando} activos={activosActivos} operadores={operadores}
          onClose={() => setEditando(null)}
          onDone={async () => { setEditando(null); await refrescar(); notify("Parte actualizado"); }}
          onError={(m) => notify(m, "err")} />
      )}
      {editandoTarifa && (
        <EditarTarifaModal parte={editandoTarifa}
          onClose={() => setEditandoTarifa(null)}
          onDone={async () => { setEditandoTarifa(null); await refrescar(); notify("Tarifa del cobro actualizada"); }}
          onError={(m) => notify(m, "err")} />
      )}
    </section>
  );
}

// Modal de edición de TARIFA de un parte ya cobrado (sin des-cobrar). Se ingresa
// el precio por QQ (o el monto total) y se actualiza el servicio vinculado. El
// backend bloquea con 409 si el servicio ya tiene abonos.
function EditarTarifaModal({ parte, onClose, onDone, onError }: {
  parte: Parte; onClose: () => void; onDone: () => void | Promise<void>; onError: (m: string) => void;
}) {
  const [modo, setModo] = useState<"precio" | "total">("precio");
  const [precio, setPrecio] = useState(parte.qq > 0 && parte.servicio_valor != null ? String(Math.round((parte.servicio_valor / parte.qq) * 10000) / 10000) : "");
  const [total, setTotal] = useState(parte.servicio_valor != null ? String(parte.servicio_valor) : "");
  const [busy, setBusy] = useState(false);
  const pu = Number(precio), tot = Number(total);
  const valido = modo === "precio" ? (precio !== "" && pu > 0) : (total !== "" && tot >= 0);
  const valorPrev = modo === "precio" ? (valido ? Math.round(parte.qq * pu * 100) / 100 : 0) : (valido ? Math.round(tot * 100) / 100 : 0);

  async function submit() {
    try {
      setBusy(true);
      if (!valido) throw new Error("Ingresa un valor válido");
      const body = modo === "precio" ? { precio_unitario: pu } : { valor: tot };
      await parteReq(`/campo/partes/${parte.id}/tarifa`, "PATCH", body);
      await onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }}
        style={{ maxWidth: 460, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>✏️ Editar tarifa del cobro</h2>
        <div className="totalBox" style={{ margin: "0 0 6px" }}>
          <span>{parte.cliente} · {parte.activo_nombre}</span>
          <strong>{qqFmt(parte.qq)} QQ</strong>
          <small>valor actual del cobro: {parte.servicio_valor != null ? money(parte.servicio_valor) : "—"}</small>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <button type="button" className="chip" style={modo === "precio" ? { background: "#059669", color: "#fff" } : undefined} onClick={() => setModo("precio")}>Por precio/QQ</button>
          <button type="button" className="chip" style={modo === "total" ? { background: "#059669", color: "#fff" } : undefined} onClick={() => setModo("total")}>Por monto total</button>
        </div>
        {modo === "precio" ? (
          <label><span>Precio por QQ $</span><input type="number" step="0.0001" min="0" autoFocus value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej: 1.50" /></label>
        ) : (
          <label><span>Monto total $</span><input type="number" step="0.01" min="0" autoFocus value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Ej: 180.00" /></label>
        )}
        {valido && (
          <div className="totalBox" style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <span>NUEVO VALOR DEL COBRO</span>
            <strong>{money(valorPrev)}</strong>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>Actualiza el servicio de cosecha vinculado. Si ya tiene abonos, el sistema bloquea el cambio.</p>
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy || !valido}>{busy ? "Guardando…" : "Guardar tarifa"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

// Modal de edición de un parte (solo partes 'por cobrar'; el backend rechaza
// editar uno ya cobrado). Mismos campos del alta.
function EditarParteModal({ parte, activos, operadores, onClose, onDone, onError }: {
  parte: Parte; activos: Activo[]; operadores: Operador[]; onClose: () => void; onDone: () => void | Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({
    fecha: String(parte.fecha).slice(0, 10), activo_id: parte.activo_id, operador: parte.operador ?? "",
    cliente: parte.cliente, qq: String(parte.qq), observaciones: parte.observaciones ?? ""
  });
  const [busy, setBusy] = useState(false);
  async function submit() {
    try {
      setBusy(true);
      if (!f.activo_id) throw new Error("Elige la máquina");
      const cliente = f.cliente.trim();
      if (!cliente) throw new Error("Ingresa el cliente");
      const qq = Number(f.qq);
      if (!(qq > 0)) throw new Error("Ingresa los quintales (mayor a 0)");
      await parteReq(`/campo/partes/${parte.id}`, "PATCH", {
        fecha: f.fecha, activo_id: f.activo_id, operador: f.operador.trim() || null,
        cliente, qq, observaciones: f.observaciones.trim() || null
      });
      await onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }}
        style={{ maxWidth: 480, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>✏️ Editar parte de cosecha</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
          <label><span>Máquina</span>
            <select value={f.activo_id} onChange={(e) => setF({ ...f, activo_id: e.target.value })}>
              {activos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Operador</span>
            <select value={f.operador} onChange={(e) => setF({ ...f, operador: e.target.value })}>
              <option value="">(sin operador)</option>
              {/* Conserva el operador actual aunque ya no esté en el catálogo activo. */}
              {f.operador && !operadores.some((o) => o.nombre === f.operador) && <option value={f.operador}>{f.operador}</option>}
              {operadores.map((o) => <option key={o.id} value={o.nombre}>{o.nombre}</option>)}
            </select>
          </label>
          <label><span>Quintales [QQ]</span><input type="number" step="0.01" min="0" value={f.qq} onChange={(e) => setF({ ...f, qq: e.target.value })} /></label>
        </div>
        <label><span>Cliente / Dueño del cultivo</span><input type="text" value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} /></label>
        <label><span>Observaciones (opcional)</span><input type="text" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} /></label>
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
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
