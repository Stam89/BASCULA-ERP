// ─────────────────────────────────────────────────────────────────────────────
// REPUESTOS DE LA PLANTA (Inventario → 🔧 Repuestos, solo Matriz): piezas que se
// desgastan (rodillos, piedras, cribas, bandas, rodamientos…) con stock mínimo.
// Compra (puede pagarse con la caja abierta), uso/cambio en una máquina (queda en
// su hoja de vida) y conteo físico. La alerta de «por terminarse» sale también
// en el Dashboard (RepuestosAlertaDashboard).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../api";
import { money } from "../format";

export type Repuesto = {
  id: string;
  nombre: string;
  referencia: string | null;
  unidad: string;
  stock: number;
  stock_minimo: number;
  costo_unitario: number;
  equipment_id: string | null;
  equipo: string | null;
  notas: string | null;
  activo: boolean;
  ultimo_uso: string | null;
  /** Familia de equipos a la que sirve: GENERAL o un área (PILADORA, SECADORA…). */
  compatibilidad?: string | null;
};

/** «Uso general» / «Para Piladora» a partir de la etiqueta guardada. */
export const etiquetaCompat = (v: string) => {
  const t = v.trim().toUpperCase();
  return t === "GENERAL" ? "Uso general" : `Para ${t.charAt(0)}${t.slice(1).toLowerCase()}`;
};

type Movimiento = {
  id: string; tipo: "ENTRADA" | "SALIDA" | "AJUSTE"; cantidad: number; costo_unitario: number | null;
  stock_resultante: number; motivo: string | null; created_at: string; equipo: string | null; usuario: string | null;
};

type Equipo = { id: string; name: string };
type Avisar = (msg: string, tipo: "success" | "error" | "warn") => void;

export type EstadoRepuesto = "AGOTADO" | "BAJO" | "OK";
export function estadoRepuesto(r: Pick<Repuesto, "stock" | "stock_minimo">): EstadoRepuesto {
  if (r.stock <= 0) return "AGOTADO";
  if (r.stock <= r.stock_minimo) return "BAJO";
  return "OK";
}
const ESTILO: Record<EstadoRepuesto, { bg: string; fg: string; bd: string; txt: string }> = {
  AGOTADO: { bg: "#fef2f2", fg: "#b91c1c", bd: "#fca5a5", txt: "Agotado" },
  BAJO: { bg: "#fff7ed", fg: "#c2410c", bd: "#fdba74", txt: "Por terminarse" },
  OK: { bg: "#f0fdf4", fg: "#15803d", bd: "#86efac", txt: "OK" }
};
const n2 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const UNIDADES = ["UNIDAD", "JUEGO", "PAR", "METRO", "LITRO", "GALON", "KG", "ROLLO"];

/** Dashboard: repuestos en o bajo su mínimo (solo Matriz). */
export function RepuestosAlertaDashboard({ repuestos, onIr }: { repuestos: Repuesto[]; onIr?: () => void }) {
  const alerta = repuestos.filter((r) => r.activo && r.stock_minimo > 0 && estadoRepuesto(r) !== "OK")
    .concat(repuestos.filter((r) => r.activo && r.stock_minimo === 0 && r.stock <= 0 && r.ultimo_uso))
    .sort((a, b) => a.stock - a.stock_minimo - (b.stock - b.stock_minimo));
  if (!alerta.length) return null;
  const agotados = alerta.filter((r) => estadoRepuesto(r) === "AGOTADO").length;
  return (
    <div role="alert" style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap", background: "#fff7ed", border: "1px solid #fdba74", borderLeft: "5px solid #ea580c", borderRadius: 12, padding: "12px 16px", margin: "0 0 14px" }}>
      <div style={{ fontSize: 26, lineHeight: 1 }}>🔧</div>
      <div style={{ flex: "1 1 260px" }}>
        <div style={{ fontWeight: 800, color: "#9a3412" }}>
          Repuestos por comprar: {alerta.length} por terminarse{agotados ? ` · ${agotados} agotado${agotados === 1 ? "" : "s"}` : ""}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {alerta.slice(0, 12).map((r) => {
            const e = ESTILO[estadoRepuesto(r)];
            return (
              <span key={r.id} title={r.equipo ? `Máquina: ${r.equipo}` : undefined}
                style={{ background: "#fff", border: `1px solid ${e.bd}`, color: e.fg, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
                {r.nombre}{r.referencia ? ` ${r.referencia}` : ""}: quedan {n2(r.stock)} / mín {n2(r.stock_minimo)}
              </span>
            );
          })}
          {alerta.length > 12 && <span style={{ fontSize: 12, color: "#9a3412" }}>+{alerta.length - 12} más</span>}
        </div>
      </div>
      {onIr && <button type="button" className="btnSecondary" onClick={onIr} style={{ fontSize: 12, alignSelf: "center" }}>Ver repuestos</button>}
    </div>
  );
}

type Accion =
  // Pago: CAJA (egreso «Repuestos» en la caja abierta) · CREDITO (Cuenta por
  // Pagar al proveedor, no toca la caja) · ENTRADA (solo suma al stock: ya pagado).
  | { tipo: "compra"; r: Repuesto; cantidad: string; costo: string; pago: "CAJA" | "CREDITO" | "ENTRADA"; proveedor: string; nota: string; vence: string }
  | { tipo: "uso"; r: Repuesto; cantidad: string; equipo: string; motivo: string }
  | { tipo: "conteo"; r: Repuesto; real: string; motivo: string };

const vacio = { nombre: "", referencia: "", unidad: "UNIDAD", stock_inicial: "", stock_minimo: "", costo_unitario: "", equipment_id: "", notas: "", compatibilidad: "" };

export function RepuestosModule({ cajaAbiertaId, puedeEditar, avisar, onCambio }: {
  cajaAbiertaId: string | null;
  puedeEditar: boolean;
  avisar: Avisar;
  /** Tras un cambio (p. ej. refrescar la caja y la alerta del Dashboard). */
  onCambio?: () => void;
}) {
  const [lista, setLista] = useState<Repuesto[]>([]);
  // Máquinas de la planta (catálogo de equipos activos) para asignar el uso.
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [buscar, setBuscar] = useState("");
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [form, setForm] = useState(vacio);
  const [editId, setEditId] = useState<string | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [kardex, setKardex] = useState<{ r: Repuesto; movs: Movimiento[] } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function cargar() {
    try { setLista(await apiGet<Repuesto[]>("/repuestos")); } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo cargar", "error"); }
    finally { setCargando(false); }
  }
  useEffect(() => {
    cargar().catch(() => undefined);
    apiGet<Equipo[]>("/equipment").then(setEquipos).catch(() => undefined);
  }, []);

  const filtrada = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return lista.filter((r) =>
      (!soloAlertas || estadoRepuesto(r) !== "OK") &&
      (!q || [r.nombre, r.referencia, r.equipo].some((v) => (v ?? "").toLowerCase().includes(q))));
  }, [lista, buscar, soloAlertas]);
  const enAlerta = lista.filter((r) => estadoRepuesto(r) !== "OK").length;
  const agotados = lista.filter((r) => estadoRepuesto(r) === "AGOTADO").length;
  const valor = lista.reduce((s, r) => s + Math.max(0, r.stock) * r.costo_unitario, 0);

  function abrirNuevo() { setForm(vacio); setEditId(null); setFormAbierto(true); }
  function abrirEditar(r: Repuesto) {
    setForm({ nombre: r.nombre, referencia: r.referencia ?? "", unidad: r.unidad, stock_inicial: "", stock_minimo: String(r.stock_minimo),
      costo_unitario: String(r.costo_unitario), equipment_id: r.equipment_id ?? "", notas: r.notas ?? "", compatibilidad: r.compatibilidad ?? "" });
    setEditId(r.id); setFormAbierto(true);
  }

  async function guardar() {
    if (form.nombre.trim().length < 2) { avisar("Escribe el nombre del repuesto", "error"); return; }
    setOcupado(true);
    try {
      const datos = {
        nombre: form.nombre.trim(), referencia: form.referencia.trim() || null, unidad: form.unidad,
        stock_minimo: Number(form.stock_minimo) || 0, costo_unitario: Number(form.costo_unitario) || 0,
        equipment_id: form.equipment_id || null, notas: form.notas.trim() || null,
        compatibilidad: form.compatibilidad.trim() || null
      };
      if (editId) await apiPatch(`/repuestos/${editId}`, datos);
      else await apiPost("/repuestos", { ...datos, stock_inicial: Number(form.stock_inicial) || 0 });
      avisar(editId ? "Repuesto actualizado" : "Repuesto registrado", "success");
      setFormAbierto(false); setEditId(null);
      await cargar(); onCambio?.();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo guardar", "error"); }
    finally { setOcupado(false); }
  }

  async function confirmarAccion() {
    const a = accion; if (!a) return;
    setOcupado(true);
    try {
      if (a.tipo === "compra") {
        const cantidad = Number(a.cantidad), costo = Number(a.costo);
        if (!(cantidad > 0)) throw new Error("Ingresa la cantidad comprada");
        if (a.pago !== "ENTRADA") {
          // Caja o crédito: una compra registrada en la sesión de caja abierta.
          if (!cajaAbiertaId) throw new Error("No hay caja abierta: abre la caja o elige «Solo entrada al stock».");
          if (!(costo > 0)) throw new Error("Ingresa el costo unitario");
          if (a.pago === "CREDITO" && a.proveedor.trim().length < 2) throw new Error("Para comprar a crédito escribe el proveedor");
          const r = await apiPost<{ total: number; stocks: Array<{ stock: number }> }>("/repuestos/compra", {
            cash_register_id: cajaAbiertaId, modalidad_pago: a.pago === "CREDITO" ? "CREDITO" : "CONTADO",
            proveedor_nombre: a.proveedor.trim() || undefined, due_date: a.pago === "CREDITO" && a.vence ? a.vence : undefined,
            descripcion: a.nota.trim() || undefined,
            items: [{ repuesto_id: a.r.id, cantidad, costo_unitario: costo }]
          });
          avisar(`Compra registrada · ahora hay ${n2(r.stocks[0]?.stock ?? 0)} ${a.r.unidad} · ${a.pago === "CREDITO" ? `Cuenta por Pagar ${money(r.total)} (la caja no cambia)` : `egreso ${money(r.total)} en Caja`}`, "success");
        } else {
          const r = await apiPost<{ stock: number; total: number }>(`/repuestos/${a.r.id}/entrada`, {
            cantidad, costo_unitario: costo || 0, proveedor: a.proveedor.trim() || undefined, nota: a.nota.trim() || undefined
          });
          avisar(`Entrada registrada · ahora hay ${n2(r.stock)} ${a.r.unidad}`, "success");
        }
      } else if (a.tipo === "uso") {
        const cantidad = Number(a.cantidad);
        if (!(cantidad > 0)) throw new Error("Ingresa cuántos se usaron");
        const r = await apiPost<{ stock: number; alerta: boolean }>(`/repuestos/${a.r.id}/salida`, {
          cantidad, equipment_id: a.equipo || null, motivo: a.motivo.trim() || undefined
        });
        avisar(`Uso registrado · quedan ${n2(r.stock)} ${a.r.unidad}${r.alerta ? " · ⚠️ por terminarse: toca comprar" : ""}`, r.alerta ? "warn" : "success");
      } else {
        const real = Number(a.real);
        if (!(real >= 0) || a.real === "") throw new Error("Ingresa lo que hay contado");
        await apiPost(`/repuestos/${a.r.id}/ajuste`, { stock_real: real, motivo: a.motivo.trim() || undefined });
        avisar("Conteo registrado", "success");
      }
      setAccion(null);
      await cargar(); onCambio?.();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo registrar", "error"); }
    finally { setOcupado(false); }
  }

  async function verKardex(r: Repuesto) {
    try { setKardex({ r, movs: await apiGet<Movimiento[]>(`/repuestos/${r.id}/movimientos`) }); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo cargar el historial", "error"); }
  }

  async function desactivar(r: Repuesto) {
    if (!window.confirm(`¿Quitar «${r.nombre}» de la lista? Su historial se conserva.`)) return;
    try { await apiPatch(`/repuestos/${r.id}`, { activo: false }); await cargar(); onCambio?.(); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo quitar", "error"); }
  }

  const campo = { width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid var(--c-border)", fontSize: 14 } as const;

  return (
    <div style={{ gridColumn: "1 / -1", display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>🔧 Repuestos de la planta</h2>
          <p className="muted" style={{ margin: 0 }}>Piezas que se desgastan: registra lo que compras y lo que cambias. Avisa cuando algo esté por terminarse.
            También entran solas al comprarlas en <strong>Caja → Nuevo movimiento → Repuestos</strong> y salen al usarlas en un <strong>Mantenimiento</strong>.</p>
        </div>
        {puedeEditar && <button type="button" className="primary" onClick={abrirNuevo}>➕ Nuevo repuesto</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <div className="totalBox" style={{ margin: 0 }}><span>Repuestos</span><strong>{lista.length}</strong><small>en la lista</small></div>
        <div className="totalBox" style={{ margin: 0, borderColor: enAlerta ? "#fdba74" : undefined }}><span>Por terminarse</span><strong style={{ color: enAlerta ? "#c2410c" : undefined }}>{enAlerta}</strong><small>en o bajo el mínimo</small></div>
        <div className="totalBox" style={{ margin: 0, borderColor: agotados ? "#fca5a5" : undefined }}><span>Agotados</span><strong style={{ color: agotados ? "#b91c1c" : undefined }}>{agotados}</strong><small>sin stock</small></div>
        <div className="totalBox" style={{ margin: 0 }}><span>Valor en bodega</span><strong>{money(valor)}</strong><small>al último costo</small></div>
      </div>

      <div className="tablePanel">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar repuesto o máquina…"
            style={{ ...campo, flex: "1 1 220px", width: "auto" }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, fontSize: 13 }}>
            <input type="checkbox" checked={soloAlertas} onChange={(e) => setSoloAlertas(e.target.checked)} /> Solo por terminarse
          </label>
        </div>
        {cargando ? <p className="muted">Cargando…</p> : filtrada.length === 0 ? (
          <div className="emptyState"><div className="emptyIcon">🔧</div>
            <p>{lista.length ? "Nada con ese filtro." : "Aún no hay repuestos. Registra las piezas que se desgastan con su stock mínimo."}</p></div>
        ) : (
          <table className="cajaTable">
            <thead><tr><th>Repuesto</th><th>Máquina</th><th className="num">Stock</th><th className="num">Mínimo</th><th>Estado</th><th className="num">Costo</th><th /></tr></thead>
            <tbody>
              {filtrada.map((r) => {
                const e = ESTILO[estadoRepuesto(r)];
                return (
                  <tr key={r.id}>
                    <td><strong>{r.nombre}</strong>{r.referencia && <div style={{ fontSize: 11.5, color: "#64748b" }}>{r.referencia}</div>}
                      {r.compatibilidad && <span className="combo__tag" style={{ display: "inline-block", marginTop: 3 }}>{etiquetaCompat(r.compatibilidad)}</span>}</td>
                    <td>{r.equipo ?? "—"}</td>
                    <td className="num" style={{ fontWeight: 800, color: e.fg }}>{n2(r.stock)} <span style={{ fontWeight: 500, fontSize: 11 }}>{r.unidad.toLowerCase()}</span></td>
                    <td className="num">{n2(r.stock_minimo)}</td>
                    <td><span style={{ background: e.bg, color: e.fg, border: `1px solid ${e.bd}`, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>{e.txt}</span></td>
                    <td className="num">{money(r.costo_unitario)}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {puedeEditar && <>
                        <button type="button" className="btnSecondary" style={{ fontSize: 12, padding: "4px 9px" }} title="Registrar compra (entrada)"
                          onClick={() => setAccion({ tipo: "compra", r, cantidad: "", costo: r.costo_unitario ? String(r.costo_unitario) : "", pago: cajaAbiertaId ? "CAJA" : "ENTRADA", proveedor: "", nota: "", vence: "" })}>➕ Compra</button>{" "}
                        <button type="button" className="btnSecondary" style={{ fontSize: 12, padding: "4px 9px" }} title="Registrar uso / cambio en una máquina" disabled={r.stock <= 0}
                          onClick={() => setAccion({ tipo: "uso", r, cantidad: "1", equipo: r.equipment_id ?? "", motivo: "" })}>➖ Usar</button>{" "}
                        <button type="button" className="btnGhost" style={{ fontSize: 12, padding: "4px 7px" }} title="Conteo físico" onClick={() => setAccion({ tipo: "conteo", r, real: String(r.stock), motivo: "" })}>📋</button>
                        <button type="button" className="btnGhost" style={{ fontSize: 12, padding: "4px 7px" }} title="Editar" onClick={() => abrirEditar(r)}>✏️</button>
                      </>}
                      <button type="button" className="btnGhost" style={{ fontSize: 12, padding: "4px 7px" }} title="Historial" onClick={() => verKardex(r)}>📜</button>
                      {puedeEditar && <button type="button" className="btnGhost" style={{ fontSize: 12, padding: "4px 7px" }} title="Quitar de la lista" onClick={() => desactivar(r)}>🗑</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Alta / edición */}
      {formAbierto && (
        <div className="modalOverlay" onClick={() => setFormAbierto(false)}>
          <div className="modalCard" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>{editId ? "✏️ Editar repuesto" : "➕ Nuevo repuesto"}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ gridColumn: "1 / -1" }}><span>Nombre *</span><input style={campo} value={form.nombre} autoFocus placeholder="Ej: RODILLO DE CAUCHO" onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></label>
              <label><span>Referencia / medida</span><input style={campo} value={form.referencia} placeholder='Ej: 10" · marca' onChange={(e) => setForm({ ...form, referencia: e.target.value })} /></label>
              <label><span>Unidad</span>
                <select style={campo} value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })}>
                  {[...new Set([form.unidad, ...UNIDADES])].map((u) => <option key={u} value={u}>{u}</option>)}
                </select></label>
              {!editId && <label><span>Stock actual</span><input style={campo} type="number" min="0" step="1" value={form.stock_inicial} placeholder="0" onChange={(e) => setForm({ ...form, stock_inicial: e.target.value })} /></label>}
              <label><span>Stock mínimo (alerta)</span><input style={campo} type="number" min="0" step="1" value={form.stock_minimo} placeholder="Ej: 2" onChange={(e) => setForm({ ...form, stock_minimo: e.target.value })} /></label>
              <label><span>Costo unitario $</span><input style={campo} type="number" min="0" step="0.01" value={form.costo_unitario} placeholder="0.00" onChange={(e) => setForm({ ...form, costo_unitario: e.target.value })} /></label>
              <label><span>Máquina donde se usa</span>
                <select style={campo} value={form.equipment_id} onChange={(e) => setForm({ ...form, equipment_id: e.target.value })}>
                  <option value="">— Varias / sin asignar —</option>
                  {equipos.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select></label>
              <label><span>Compatibilidad / etiqueta</span>
                <input style={campo} list="repCompatLista" value={form.compatibilidad} placeholder="GENERAL, PILADORA, SECADORA…"
                  onChange={(e) => setForm({ ...form, compatibilidad: e.target.value.toUpperCase() })} />
                <datalist id="repCompatLista">
                  {[...new Set(["GENERAL", "PILADORA", "SECADORA", ...lista.map((x) => (x.compatibilidad ?? "").toUpperCase()).filter(Boolean)])].map((v) => <option key={v} value={v}>{etiquetaCompat(v)}</option>)}
                </datalist></label>
              <label style={{ gridColumn: "1 / -1" }}><span>Notas</span><input style={campo} value={form.notas} placeholder="Proveedor habitual, duración aproximada…" onChange={(e) => setForm({ ...form, notas: e.target.value })} /></label>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Cuando el stock llegue al mínimo, el Dashboard avisa para comprarlo.</p>
            <div className="buttonRow">
              <button type="button" className="primary" disabled={ocupado} onClick={() => guardar()}>{ocupado ? "Guardando…" : "Guardar"}</button>
              <button type="button" onClick={() => setFormAbierto(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Compra / uso / conteo */}
      {accion && (
        <div className="modalOverlay" onClick={() => setAccion(null)}>
          <div className="modalCard" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>
              {accion.tipo === "compra" ? "➕ Registrar compra" : accion.tipo === "uso" ? "➖ Registrar uso / cambio" : "📋 Conteo físico"}
            </h3>
            <p className="muted" style={{ margin: 0 }}>
              <strong>{accion.r.nombre}</strong>{accion.r.referencia ? ` · ${accion.r.referencia}` : ""} — hay {n2(accion.r.stock)} {accion.r.unidad.toLowerCase()} (mín. {n2(accion.r.stock_minimo)})
            </p>
            {accion.tipo === "compra" && (() => {
              const total = (Number(accion.cantidad) || 0) * (Number(accion.costo) || 0);
              return (<>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label><span>Cantidad *</span><input style={campo} type="number" min="0" step="1" autoFocus value={accion.cantidad} onChange={(e) => setAccion({ ...accion, cantidad: e.target.value })} /></label>
                  <label><span>Costo unitario $</span><input style={campo} type="number" min="0" step="0.01" value={accion.costo} onChange={(e) => setAccion({ ...accion, costo: e.target.value })} /></label>
                  <label style={{ gridColumn: "1 / -1" }}><span>Proveedor</span><input style={campo} value={accion.proveedor} placeholder="Opcional" onChange={(e) => setAccion({ ...accion, proveedor: e.target.value })} /></label>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {([
                    ["CAJA", "💵 Pagar con la caja abierta", `Egreso «Repuestos» por ${money(total)} en Caja`],
                    ["CREDITO", "💳 A crédito", "Cuenta por Pagar al proveedor · la caja no cambia"],
                    ["ENTRADA", "📥 Solo entrada al stock", "Ya estaba pagado (no toca Caja ni Por Pagar)"]
                  ] as const).map(([valor, titulo, sub]) => {
                    const bloqueado = valor !== "ENTRADA" && !cajaAbiertaId;
                    return (
                      <label key={valor} style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: 0, padding: "7px 10px", borderRadius: 8, fontSize: 13,
                        border: `1.5px solid ${accion.pago === valor ? "#0f766e" : "#e5e7eb"}`, background: accion.pago === valor ? "#f0fdfa" : "#fff",
                        opacity: bloqueado ? 0.5 : 1, cursor: bloqueado ? "not-allowed" : "pointer" }}>
                        <input type="radio" checked={accion.pago === valor} disabled={bloqueado} onChange={() => setAccion({ ...accion, pago: valor })} style={{ width: "auto", marginTop: 2 }} />
                        <span><strong>{titulo}</strong><small className="muted" style={{ display: "block", fontSize: 11 }}>{sub}</small></span>
                      </label>
                    );
                  })}
                </div>
                {accion.pago === "CREDITO" && (
                  <label><span>Vence el (opcional)</span><input style={campo} type="date" value={accion.vence} onChange={(e) => setAccion({ ...accion, vence: e.target.value })} /></label>
                )}
                {!cajaAbiertaId && <small className="muted">No hay caja abierta: solo se puede registrar la entrada al stock.</small>}
              </>);
            })()}
            {accion.tipo === "uso" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label><span>Cantidad usada *</span><input style={campo} type="number" min="0" step="1" autoFocus value={accion.cantidad} onChange={(e) => setAccion({ ...accion, cantidad: e.target.value })} /></label>
                <label><span>Máquina</span>
                  <select style={campo} value={accion.equipo} onChange={(e) => setAccion({ ...accion, equipo: e.target.value })}>
                    <option value="">— Sin máquina —</option>
                    {equipos.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                  </select></label>
                <label style={{ gridColumn: "1 / -1" }}><span>Motivo / detalle</span><input style={campo} value={accion.motivo} placeholder="Ej: desgaste, cambio programado" onChange={(e) => setAccion({ ...accion, motivo: e.target.value })} /></label>
                <small className="muted" style={{ gridColumn: "1 / -1" }}>Si eliges la máquina, el cambio queda en su hoja de vida (mantenimientos).</small>
              </div>
            )}
            {accion.tipo === "conteo" && (
              <div style={{ display: "grid", gap: 10 }}>
                <label><span>Cantidad contada en bodega *</span><input style={campo} type="number" min="0" step="1" autoFocus value={accion.real} onChange={(e) => setAccion({ ...accion, real: e.target.value })} /></label>
                <label><span>Motivo</span><input style={campo} value={accion.motivo} placeholder="Conteo físico" onChange={(e) => setAccion({ ...accion, motivo: e.target.value })} /></label>
              </div>
            )}
            <div className="buttonRow">
              <button type="button" className="primary" disabled={ocupado} onClick={() => confirmarAccion()}>{ocupado ? "Guardando…" : "Confirmar"}</button>
              <button type="button" onClick={() => setAccion(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Historial (kárdex) */}
      {kardex && (
        <div className="modalOverlay" onClick={() => setKardex(null)}>
          <div className="modalCard" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>📜 Historial · {kardex.r.nombre}</h3>
            {kardex.movs.length === 0 ? <p className="muted">Sin movimientos.</p> : (
              <div style={{ overflowX: "auto" }}>
                <table className="cajaTable">
                  <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Cantidad</th><th className="num">Queda</th><th>Máquina / detalle</th></tr></thead>
                  <tbody>
                    {kardex.movs.map((m) => (
                      <tr key={m.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{new Date(m.created_at).toLocaleDateString("es-EC")}</td>
                        <td>{m.tipo === "ENTRADA" ? "➕ Compra" : m.tipo === "SALIDA" ? "➖ Uso" : "📋 Ajuste"}</td>
                        <td className="num" style={{ color: m.cantidad < 0 ? "#b91c1c" : "#15803d", fontWeight: 700 }}>{m.cantidad > 0 ? "+" : ""}{n2(m.cantidad)}</td>
                        <td className="num">{n2(m.stock_resultante)}</td>
                        <td>{[m.equipo, m.motivo].filter(Boolean).join(" · ") || "—"}{m.usuario && <div style={{ fontSize: 11, color: "#94a3b8" }}>{m.usuario}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="buttonRow"><button type="button" onClick={() => setKardex(null)}>Cerrar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
