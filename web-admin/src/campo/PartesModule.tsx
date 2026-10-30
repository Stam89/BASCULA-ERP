// Partes Diarios de Campo (cosecha y transporte). Sección del workspace de
// Campo. Persiste en el backend (tabla campo_partes vía /campo/partes). La
// máquina sale de la flota real (campo_activos); el operador se copia del activo
// pero queda editable. Mantiene los estilos de CajaModule.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiGet, apiPost, esAdministrador } from "../api";
import { hoyLocal, money } from "../format";
import { useAutoRefresh } from "./autoRefresh";
import { ClienteSearchInput } from "../components/ClienteSearchInput";
import { confirmar } from "../components/Dialogo";

const hoy = () => hoyLocal();
const qqFmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

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
type Activo = { id: string; nombre: string; tipo: string; operador: string | null; activo: boolean; ultimo_operador?: string | null; ultimo_operador_fecha?: string | null };
// 👷 Operador sugerido al elegir la máquina: quien la manejó la última vez (si nunca, el operador de la ficha).
// Solo es sugerencia: se cambia en la lista si ese día la manejó otro.
function operadorSugerido(activo: Activo | undefined, operadores: Operador[]): string | null {
  for (const n of [activo?.ultimo_operador, activo?.operador]) {
    const o = n ? operadores.find((x) => x.nombre.toLowerCase() === n.trim().toLowerCase()) : undefined;
    if (o) return o.nombre;
  }
  return null;
}
// Operador (catálogo campo_operadores). En el parte se guarda su NOMBRE (texto).
type Operador = { id: string; nombre: string; activo: boolean };
type Parte = {
  id: string; fecha: string; activo_id: string; activo_nombre: string; activo_tipo?: string; operador: string | null;
  agricultor?: string | null;
  operador_pagado_at?: string | null;
  cliente: string; cliente_id: string | null; cliente_tipo: "piladora" | "externo" | null;
  qq: number; observaciones: string | null; estado: "por_cobrar" | "cobrado"; origen: string;
  // Cobro generado (campo_servicio) enlazado, si estado='cobrado'.
  servicio_id: string | null; servicio_valor: number | null; servicio_saldo: number | null;
  servicio_estado: "pendiente" | "abonado" | "pagado" | null;
  cobro_automatico: boolean;
  liquidacion_id: string | null; liquidacion_numero: string | null;
  liquidacion_socio: string | null; liquidacion_tipo: "cosechadora" | "flete" | null;
};

export default function PartesModule() {
  const [activos, setActivos] = useState<Activo[]>([]);
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [partes, setPartes] = useState<Parte[]>([]);
  const [f, setF] = useState({ fecha: hoy(), activo_id: "", operador: "" });
  // Clientes del día: una cosechadora le cosecha a varios dueños en un día → un parte por cliente
  // (misma fecha, máquina y operador). Con una sola fila es el parte de siempre.
  type LineaParte = { key: number; cliente: string; cliente_id: string; qq: string; observaciones: string };
  const lineaVacia = (): LineaParte => ({ key: Date.now() + Math.random(), cliente: "", cliente_id: "", qq: "", observaciones: "" });
  const [lineas, setLineas] = useState<LineaParte[]>(() => [lineaVacia()]);
  const setLinea = (key: number, cambio: Partial<LineaParte>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...cambio } : l)));
  const qqLineas = lineas.reduce((s, l) => s + (Number(l.qq) > 0 ? Number(l.qq) : 0), 0);
  const [busy, setBusy] = useState(false);
  const [cobrando, setCobrando] = useState<Parte | null>(null);
  const [editando, setEditando] = useState<Parte | null>(null);
  const [editandoTarifa, setEditandoTarifa] = useState<Parte | null>(null);
  const [filtro, setFiltro] = useState({ from: "", to: "", activo_id: "", estado: "" });
  // Pestañas del historial: separa por tipo de máquina (cosechadora vs flete).
  const [histTab, setHistTab] = useState<"cosechadoras" | "fletes" | "todos">("todos");
  const [flash, setFlash] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 3000); };

  const activosActivos = useMemo(() => activos.filter((a) => a.activo), [activos]);
  const activoSeleccionado = activosActivos.find((a) => a.id === f.activo_id);
  const nuevoEsCosecha = activoSeleccionado?.tipo?.toLowerCase() === "cosechadora";
  const esCosechadora = (p: Parte) => (p.activo_tipo ?? "").toLowerCase() === "cosechadora";
  const partesVista = useMemo(() => partes.filter((p) =>
    histTab === "todos" ? true : histTab === "cosechadoras" ? esCosechadora(p) : !esCosechadora(p)
  ), [partes, histTab]);
  const totalQQ = useMemo(() => partesVista.reduce((s, p) => s + p.qq, 0), [partesVista]);

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
  // Lo cobrado o registrado en otro equipo (celular / PC) aparece solo.
  useAutoRefresh(cargarPartes);
  // Pestañas: el formulario y el historial por separado (la página no se hace larga).
  const [vista, setVista] = useState<"nuevo" | "historial">(() => {
    try { return localStorage.getItem("bascula-erp:partes-vista") === "historial" ? "historial" : "nuevo"; } catch { return "nuevo"; }
  });
  const cambiarVista = (v: "nuevo" | "historial") => { setVista(v); try { localStorage.setItem("bascula-erp:partes-vista", v); } catch { /* sin almacenamiento */ } };
  const porCobrar = partes.filter((p) => p.estado === "por_cobrar").length;

  async function anular(p: Parte) {
    if (!(await confirmar(`¿Anular el parte de ${p.cliente} (${qqFmt(p.qq)} QQ)? Esta acción no se puede deshacer.`))) return;
    try { await parteReq(`/campo/partes/${p.id}`, "DELETE"); await refrescar(); notify("Parte anulado"); }
    catch (e) { notify((e as Error).message, "err"); }
  }
  async function descobrar(p: Parte) {
    if (!(await confirmar(`¿Des-cobrar el parte de ${p.cliente}? Se borrará el servicio de cobro generado.`))) return;
    try { await apiPost(`/campo/partes/${p.id}/descobrar`, {}); await refrescar(); notify("Cobro anulado; el parte vuelve a Por cobrar"); }
    catch (e) { notify((e as Error).message, "err"); }
  }

  async function guardar() {
    try {
      setBusy(true);
      if (!f.activo_id) throw new Error("Elige la máquina / cosechadora");
      const payload = lineas.map((l, i) => {
        const cliente = l.cliente.trim();
        const n = lineas.length > 1 ? ` (fila ${i + 1})` : "";
        if (!cliente) throw new Error(`Ingresa el cliente / dueño del cultivo${n}`);
        const qq = Number(l.qq);
        if (!(qq > 0)) throw new Error(`Ingresa los quintales trabajados (mayor a 0)${n}`);
        return { cliente, cliente_id: l.cliente_id || undefined, is_nuevo_externo: !l.cliente_id, qq, observaciones: l.observaciones.trim() || undefined };
      });
      const cab = { fecha: f.fecha, activo_id: f.activo_id, operador: f.operador.trim() || undefined };
      if (payload.length === 1) await apiPost("/campo/partes", { ...cab, ...payload[0] });
      else await apiPost("/campo/partes/varios", { ...cab, lineas: payload });
      setLineas([lineaVacia()]);
      await refrescar();
      notify(payload.length > 1
        ? `${payload.length} partes guardados (${qqFmt(qqLineas)} QQ): uno por cliente`
        : nuevoEsCosecha ? "Parte de cosecha guardado" : "Parte de transporte guardado");
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
        <h2 style={{ marginBottom: 2 }}>📝 Partes Diarios de Campo <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· cosecha y transporte</span></h2>
        <p className="muted" style={{ margin: "2px 0 0" }}>Registro diario del trabajo de cosechadoras y vehículos. Los cobros tomados por una liquidación se identifican automáticamente.</p>
        {flashEl}
        <nav className="segmented" style={{ marginTop: 8 }} aria-label="Vistas de Partes Diarios">
          <button type="button" className={vista === "nuevo" ? "active" : ""} onClick={() => cambiarVista("nuevo")}>＋ Nuevo parte</button>
          <button type="button" className={vista === "historial" ? "active" : ""} onClick={() => cambiarVista("historial")}>
            📋 Historial{porCobrar > 0 ? ` · ${porCobrar} por cobrar` : ""}
          </button>
        </nav>
      </div>

      {/* A · Formulario de nuevo reporte */}
      {vista === "nuevo" && (
      <form className="formPanel" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
        <h2>＋ Nuevo parte de trabajo</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
          <label><span>Máquina</span>
            <select value={f.activo_id} onChange={(e) => {
              const activo = activosActivos.find((a) => a.id === e.target.value);
              setF({ ...f, activo_id: e.target.value, operador: operadorSugerido(activo, operadores) ?? f.operador });
            }}>
              <option value="">Seleccione</option>
              {activosActivos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
        </div>
        <label><span>Operador</span>
          <select value={f.operador} onChange={(e) => setF({ ...f, operador: e.target.value })}>
            <option value="">(sin operador)</option>
            {operadores.map((o) => <option key={o.id} value={o.nombre}>{o.nombre}</option>)}
          </select>
        </label>
        {activoSeleccionado && f.operador && operadorSugerido(activoSeleccionado, operadores) === f.operador && (
          <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>
            👷 {activoSeleccionado.ultimo_operador?.trim().toLowerCase() === f.operador.toLowerCase() && activoSeleccionado.ultimo_operador_fecha
              ? `${f.operador} la manejó la última vez (${String(activoSeleccionado.ultimo_operador_fecha).slice(0, 10).split("-").reverse().join("/")})`
              : `${f.operador} es el operador de esta máquina`}. Si hoy la manejó otro, cámbialo en la lista.
          </p>
        )}
        {operadores.length === 0 && (
          <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>No hay operadores. Agrégalos en <strong>⚙️ Configuración → 👷 Operadores</strong>.</p>
        )}
        {lineas.map((l, i) => (
          <div key={l.key} className={lineas.length > 1 ? "parteLinea" : undefined}>
            {lineas.length > 1 && (
              <div className="parteLinea__head">
                <strong>Cliente {i + 1}</strong>
                <button type="button" className="btnGhost" title="Quitar este cliente" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}>✕ Quitar</button>
              </div>
            )}
            <label><span>Cliente / Dueño del cultivo</span>
              <ClienteSearchInput kind="farmer" value={l.cliente}
                allowCreate={false}
                onChange={(name) => setLinea(l.key, { cliente: name, cliente_id: "" })}
                onSelect={(hit) => setLinea(l.key, { cliente: hit.full_name, cliente_id: hit.id })}
                onError={(m) => notify(m, "err")}
                placeholder="Buscar en Báscula o escribir cliente externo…"
                style={{ width: "100%" }} />
              {l.cliente.trim() && !l.cliente_id && (
                <small className="muted" style={{ display: "block", marginTop: 4 }}>Se guardará como cliente externo.</small>
              )}
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label><span>{activoSeleccionado ? (nuevoEsCosecha ? "Quintales cosechados" : "Quintales transportados") : "Quintales trabajados"} [QQ]</span>
                <input type="number" step="0.01" min="0" value={l.qq} onChange={(e) => setLinea(l.key, { qq: e.target.value })} placeholder="Ej: 120" />
              </label>
              <label><span>Observaciones (opcional)</span>
                <input type="text" value={l.observaciones} onChange={(e) => setLinea(l.key, { observaciones: e.target.value })} placeholder="Ej: Terreno húmedo" />
              </label>
            </div>
          </div>
        ))}
        <button type="button" className="btnSecondary" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>
          ➕ Otro cliente del mismo día
        </button>
        {lineas.length > 1 && (
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
            Se guarda <strong>un parte por cliente</strong> ({lineas.length} · {qqFmt(qqLineas)} QQ en total), con la misma fecha, máquina y operador.
            Cada uno se cobra aparte. Si el operador cobra por día, ese día se le paga una sola vez.
          </p>
        )}
        <button className="primary" disabled={busy}>{busy ? "Guardando…" : lineas.length > 1 ? `Guardar ${lineas.length} partes` : "Guardar reporte"}</button>
        {activosActivos.length === 0 && (
          <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>No hay maquinaria activa. Da de alta cosechadoras en <strong>⚙️ Configuración → 🚜 Flota y Maquinaria</strong>.</p>
        )}
      </form>
      )}

      {/* B · Historial */}
      {vista === "historial" && (
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Historial de partes <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({partesVista.length})</span></h2>
          <div className="totalBox" style={{ minWidth: 130, margin: 0, marginLeft: "auto", background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <span>TOTAL QQ</span>
            <strong>{qqFmt(totalQQ)}</strong>
          </div>
        </div>
        {/* Pestañas: separa cosechadoras de fletes/transporte según la máquina. */}
        <div className="segmented" style={{ marginTop: 8 }}>
          {([["cosechadoras", "🚜 Cosechadoras"], ["fletes", "🚚 Fletes / Transporte"], ["todos", "Todos"]] as Array<["cosechadoras" | "fletes" | "todos", string]>).map(([v, label]) => (
            <button key={v} type="button" className={histTab === v ? "active" : ""} onClick={() => setHistTab(v)}>{label}</button>
          ))}
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
              <option value="cobrado">Cobrados / liquidados</option>
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
              <th className="num">QQ trabajados</th><th>Observaciones</th><th>Estado</th><th>Acciones</th>
            </tr></thead>
            <tbody>
              {partesVista.length === 0 ? (
                <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin partes registrados.</td></tr>
              ) : partesVista.map((p) => {
                return (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{String(p.fecha).slice(0, 10)}</td>
                  <td>
                    {/* Sin chofer no es un error: el pago sale del informe que trae el chofer. */}
                    {p.operador ? p.operador : <span className="muted" title="Sin chofer anotado (se puede poner con Editar)">—</span>}
                  </td>
                  <td>{p.activo_nombre}</td>
                  <td style={{ fontWeight: 600 }}>
                    {p.cliente}
                    {p.cliente_tipo === "externo" ? (
                      <span className="chip" style={{ marginLeft: 6, background: "#f3f4f6", color: "#92400e", border: "1px solid #d1d5db", fontWeight: 600 }}
                        title="Cliente externo: el cobro se realiza en efectivo o transferencia">👤 Externo</span>
                    ) : (p.cliente_tipo === "piladora" || p.origen === "bascula") && (
                      <span className="chip" style={{ marginLeft: 6, background: "#1d4ed8", color: "#fff", fontWeight: 600 }}
                        title={p.observaciones ?? "Generado desde el ingreso de báscula"}>⚖️ Báscula</span>
                    )}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>{qqFmt(p.qq)}</td>
                  <td>
                    {p.agricultor
                      ? <><span style={{ fontWeight: 600 }}>🌾 {p.agricultor}</span>
                          {p.origen === "bascula" && <small className="muted" style={{ display: "block" }} title={p.observaciones ?? undefined}>Báscula</small>}</>
                      : (p.observaciones || "—")}
                  </td>
                  <td>
                    {p.cobro_automatico ? (
                      <>
                        <span className="chip ok">Cobrada en liquidación</span>
                        <small className="muted" style={{ display: "block", marginTop: 2 }}>
                          {p.liquidacion_numero ?? "Liquidación"}
                          {p.liquidacion_socio ? ` · ${p.liquidacion_socio}` : ""}
                        </small>
                      </>
                    ) : p.estado === "cobrado" ? (
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
                    {p.cobro_automatico ? (
                      <span className="chip" title="El cobro fue generado automáticamente desde la liquidación y no debe registrarse otra vez.">🔒 Automático</span>
                    ) : p.estado === "por_cobrar" ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="btnSecondary" onClick={() => setCobrando(p)}>💵 Cobrar</button>
                        <button type="button" className="btnSecondary" onClick={() => setEditando(p)}>✏️ Editar</button>
                        {esAdministrador() && <button type="button" className="btnSecondary" onClick={() => anular(p)}>🗑️ Anular</button>}
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="btnSecondary" disabled={p.servicio_estado !== "pendiente"}
                          title={p.servicio_estado !== "pendiente" ? "El cobro ya tiene abonos; reversa los abonos en Caja primero." : "Editar el precio por QQ / monto total del cobro"}
                          onClick={() => setEditandoTarifa(p)}>✏️ Tarifa</button>
                        {esAdministrador() && <button type="button" className="btnSecondary" disabled={p.servicio_estado !== "pendiente"}
                          title={p.servicio_estado !== "pendiente" ? "El cobro ya tiene abonos; reversa los abonos en Caja primero." : "Anular el cobro y volver a Por cobrar"}
                          onClick={() => descobrar(p)}>↩️ Des-cobrar</button>}
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {cobrando && (
        <GenerarCobroModal parte={cobrando}
          onClose={() => setCobrando(null)}
          onDone={async () => { const tipo = esCosechadora(cobrando) ? "cosecha" : "flete"; setCobrando(null); await refrescar(); notify(`Cobro generado (servicio de ${tipo})`); }}
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
        <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>Actualiza el servicio vinculado. Si ya tiene abonos, el sistema bloquea el cambio.</p>
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
    cliente: parte.cliente, cliente_id: parte.cliente_id ?? "", qq: String(parte.qq), observaciones: parte.observaciones ?? ""
  });
  const [busy, setBusy] = useState(false);
  // Tickets que entraron por la romana/API (origen != manual): solo se puede
  // rellenar el operador; los quintales calculados por la romana NO se tocan.
  const esRomana = parte.origen !== "manual";
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
        cliente, cliente_id: f.cliente_id || undefined, is_nuevo_externo: !f.cliente_id,
        qq, observaciones: f.observaciones.trim() || null
      });
      await onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }}
        style={{ maxWidth: 480, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>✏️ Editar parte de trabajo</h2>
        {esRomana && (
          <p className="muted" style={{ marginTop: -4, background: "#fef2f2", color: "#b91c1c", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontWeight: 600 }}>
            ⚠️ Ticket de la romana: solo puedes asignar el <strong>operador / chofer</strong>. Los quintales y la máquina calculados por la báscula quedan bloqueados.
          </p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Fecha</span><input type="date" value={f.fecha} disabled={esRomana} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
          <label><span>Máquina</span>
            <select value={f.activo_id} disabled={esRomana} onChange={(e) => {
              const activo = activos.find((a) => a.id === e.target.value);
              setF({ ...f, activo_id: e.target.value, operador: f.operador || (operadorSugerido(activo, operadores) ?? "") });
            }}>
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
          <label><span>Quintales [QQ]{esRomana ? " (romana)" : ""}</span><input type="number" step="0.01" min="0" value={f.qq} readOnly={esRomana} disabled={esRomana} onChange={(e) => setF({ ...f, qq: e.target.value })} /></label>
        </div>
        <label><span>Cliente / Dueño del cultivo</span>
          <ClienteSearchInput kind="farmer" value={f.cliente} disabled={esRomana}
            allowCreate={false}
            onChange={(name) => setF((p) => ({ ...p, cliente: name, cliente_id: "" }))}
            onSelect={(hit) => setF((p) => ({ ...p, cliente: hit.full_name, cliente_id: hit.id }))}
            onError={onError}
            placeholder="Buscar en Báscula o escribir cliente externo…"
            style={{ width: "100%" }} />
          {!esRomana && f.cliente.trim() && !f.cliente_id && (
            <small className="muted" style={{ display: "block", marginTop: 4 }}>Se guardará como cliente externo.</small>
          )}
        </label>
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
  // Tarifa del cliente (o la general) de Configuración → 💲 Tarifas a clientes: llena el precio si está vacío.
  type Sugerida = { precio: number | null; origen: "cliente" | "general" | null; viaje: { valor: number; origen: "cliente" | "general" } | null };
  const [sugerida, setSugerida] = useState<Sugerida | null>(null);
  // Flete POR VIAJE: monto fijo del viaje completo (el carro no llevó los QQ que debía).
  const [modo, setModo] = useState<"qq" | "viaje">("qq");
  const [valorViaje, setValorViaje] = useState("");
  useEffect(() => {
    let vivo = true;
    apiGet<Sugerida>(`/campo/partes/${parte.id}/tarifa-sugerida`)
      .then((r) => {
        if (!vivo) return;
        setSugerida(r);
        if (r.precio) setPrecio((p) => (p === "" ? String(r.precio) : p));
        if (r.viaje) setValorViaje((v) => (v === "" ? String(r.viaje?.valor) : v));
      })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [parte.id]);
  const tipoServicio = (parte.activo_tipo ?? "").toLowerCase() === "cosechadora" ? "cosecha" : "flete";
  const porViaje = tipoServicio === "flete" && modo === "viaje";
  const pu = Number(precio);
  const vv = Number(valorViaje);
  const valido = porViaje ? valorViaje !== "" && vv > 0 : precio !== "" && pu > 0;
  const valor = !valido ? 0 : porViaje ? Math.round(vv * 100) / 100 : Math.round(parte.qq * pu * 100) / 100;
  // Aviso: por QQ sale menos que el viaje completo (no se completó la carga).
  const viajeSug = tipoServicio === "flete" ? sugerida?.viaje ?? null : null;
  const sugiereViaje = !porViaje && viajeSug != null && valido && valor < viajeSug.valor;

  async function submit() {
    try {
      setBusy(true);
      if (!valido) throw new Error(porViaje ? "Ingresa el valor del viaje (mayor a 0)" : "Ingresa el precio por QQ (mayor a 0)");
      await apiPost(`/campo/partes/${parte.id}/cobrar`, porViaje ? { valor_viaje: vv } : { precio_unitario: pu });
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
        {tipoServicio === "flete" && (
          <div className="segmented" style={{ marginBottom: 8 }}>
            <button type="button" className={modo === "qq" ? "active" : ""} onClick={() => setModo("qq")}>Por QQ</button>
            <button type="button" className={modo === "viaje" ? "active" : ""} onClick={() => setModo("viaje")}>Por viaje</button>
          </div>
        )}
        {porViaje ? (
          <label><span>Valor del viaje completo $</span>
            <input type="number" step="0.01" min="0" autoFocus value={valorViaje} onChange={(e) => setValorViaje(e.target.value)} placeholder="Ej: 40.00" />
            <small className="muted" style={{ display: "block", marginTop: 4 }}>
              Se cobra el viaje aunque el carro no llevó los QQ que debía ({qqFmt(parte.qq)} QQ).
              {viajeSug && <> {viajeSug.origen === "cliente" ? "Tarifa por viaje de este cliente" : "Tarifa general por viaje"}: {money(viajeSug.valor)}.</>}
            </small>
          </label>
        ) : (
        <label><span>Precio por QQ $</span>
          <input type="number" step="0.0001" min="0" autoFocus value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej: 1.50" />
          {sugerida?.precio != null && (
            <small className="muted" style={{ display: "block", marginTop: 4 }}>
              {sugerida.origen === "cliente" ? "Tarifa de este cliente" : "Tarifa general"}: {money(sugerida.precio)}/QQ
              {Number(precio) !== sugerida.precio && <> · <button type="button" className="btnGhost" style={{ padding: "0 4px" }} onClick={() => setPrecio(String(sugerida.precio))}>usarla</button></>}
            </small>
          )}
        </label>
        )}
        {sugiereViaje && viajeSug && (
          <p className="si-aviso" style={{ margin: "4px 0" }}>
            🚚 Por QQ salen {money(valor)}, menos que el viaje completo ({money(viajeSug.valor)}).
            <button type="button" className="btnGhost" style={{ padding: "0 6px" }} onClick={() => { setModo("viaje"); setValorViaje(String(viajeSug.valor)); }}>Cobrar por viaje</button>
          </p>
        )}
        {valido && (
          <div className="totalBox" style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <span>VALOR DEL COBRO {porViaje ? "(viaje completo)" : `(${qqFmt(parte.qq)} × ${money(pu)})`}</span>
            <strong>{money(valor)}</strong>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>Crea un servicio de {tipoServicio} (cliente + máquina del parte) que aparece en Servicios y en el reporte de Por Cobrar. Los abonos se registran ahí.</p>
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy || !valido}>{busy ? "Generando…" : "Generar cobro"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
