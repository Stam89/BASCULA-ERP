// 📊 RESULTADO MENSUAL DE CEYRO (la hoja "COSTO <MES>" del usuario):
//  · Costos operativos por rubro: Costo estimado · Gasto total · Costo real
//    (= gasto / QQ de cáscara comprada por CEYRO + ROVINSON + STALYN). Rojo si el
//    costo real supera al estimado.
//  · Ingresos adicionales (NO ventas directas) + ganancia Gana por operación.
//  · Gastos financieros (hipoteca, préstamos, diferidos) y TOTAL NETO DE GANANCIAS.
// Los datos salen de lo ya registrado (Caja, liquidaciones, servicios, fomentos);
// solo los montos que el sistema no conoce se ingresan a mano por mes.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiGet, apiPatch, apiPost } from "../api";

type Mov = { fecha: string; descripcion: string; monto: number; categoria: string; subcategoria: string | null; categoria_codigo: string; tipo_nomina: string | null };
type Rubro = { id: string; nombre: string; claves: string[]; categorias: string[]; nomina: string[]; costo_estimado_qq: number; gasto_total: number; costo_real_qq: number; alerta: boolean; detalle: Mov[] };
type CategoriaCaja = { codigo: string; nombre: string };
const NOMINA_LABEL: Record<string, string> = {
  SUELDO_ADMIN: "Sueldo administrativo", CUADRILLA: "Cuadrilla", PILADOR: "Pilador",
  ESTIBADOR: "Estibador", SECADOR: "Secador", POLVILLO: "Polvillo"
};
type Ingreso = { concepto: string; monto: number; origen: "auto" | "manual"; id?: string; nota?: string | null };
type Reporte = {
  periodo: string;
  cascara: { operaciones: Array<{ operacion: string; tipo: string; qq: number; liquidaciones: number }>; total_auto: number; total: number; manual: boolean };
  rubros: Rubro[];
  sin_clasificar: { monto: number; detalle: Mov[] };
  excluidos: Array<{ categoria: string; monto: number }>;
  total_costos: number; costo_real_qq: number; costo_estimado_qq: number;
  ingresos: Ingreso[]; total_ingresos: number;
  financieros: Array<{ id: string; concepto: string; monto: number; nota: string | null }>; total_financieros: number;
};
export type GanaOperacion = { operacion: string; utilidad: number; lotes: number };

const dinero = (n: number) => `$${(Number(n) || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const porQq = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const mesActual = () => new Date().toISOString().slice(0, 7);
const ROJO = { background: "#FFCCCC", color: "#991b1b" };
const VERDE = { background: "#dcfce7", color: "#166534" };

export function ResultadoMensual({ puedeEditar, avisar, calcularGana, onCategoriasCaja }: {
  puedeEditar: boolean;
  avisar: (msg: string, tipo: "success" | "error" | "warn") => void;
  /** Avisa a Caja que cambió su lista de categorías (rubro creado/renombrado). */
  onCategoriasCaja?: () => void;
  /** Ganancia «Gana» (lotes propios pilados) de cada operación en el mes, con el mismo cálculo del módulo Gana. */
  calcularGana: (periodo: string) => Promise<GanaOperacion[]>;
}) {
  const [periodo, setPeriodo] = useState(mesActual());
  const [qqManual, setQqManual] = useState("");
  const [rep, setRep] = useState<Reporte | null>(null);
  const [gana, setGana] = useState<GanaOperacion[]>([]);
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ seccion: "INGRESO" as "INGRESO" | "FINANCIERO", concepto: "", monto: "" });
  const [verRubros, setVerRubros] = useState(false);
  // Fila del panel «Configurar rubros» en edición (botón ✏️ Editar).
  const [editando, setEditando] = useState<{ id: string; nombre: string; estimado: string } | null>(null);
  const [nuevoRubro, setNuevoRubro] = useState({ nombre: "", estimado: "", categoria: "" });
  const [categoriasCaja, setCategoriasCaja] = useState<CategoriaCaja[]>([]);
  const cargarCategorias = useCallback(() => {
    apiGet<CategoriaCaja[]>("/resultado-mensual/categorias-caja").then(setCategoriasCaja).catch(() => setCategoriasCaja([]));
  }, []);
  useEffect(() => { cargarCategorias(); }, [cargarCategorias]);
  const nombreCategoria = (codigo: string) => categoriasCaja.find((c) => c.codigo === codigo)?.nombre ?? codigo;

  const cargar = useCallback(async () => {
    const [y, m] = periodo.split("-").map(Number);
    if (!y || !m) return;
    setCargando(true);
    try {
      const qs = new URLSearchParams({ year: String(y), month: String(m) });
      if (Number(qqManual) > 0) qs.set("qq", String(Number(qqManual)));
      const [r, g] = await Promise.all([
        apiGet<Reporte>(`/resultado-mensual?${qs.toString()}`),
        calcularGana(periodo).catch(() => [] as GanaOperacion[])
      ]);
      setRep(r); setGana(g);
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo cargar el reporte", "error"); }
    finally { setCargando(false); }
  }, [periodo, qqManual, calcularGana, avisar]);
  useEffect(() => { cargar(); }, [cargar]);

  const totalGana = useMemo(() => gana.reduce((s, g) => s + g.utilidad, 0), [gana]);
  const totalIngresos = (rep?.total_ingresos ?? 0) + totalGana;
  const neto = totalIngresos - (rep?.total_costos ?? 0) - (rep?.total_financieros ?? 0);
  const costoAlto = rep ? rep.costo_real_qq > rep.costo_estimado_qq + 1e-9 : false;

  async function guardarEstimado(r: Rubro, valor: number) {
    if (!Number.isFinite(valor) || valor < 0 || valor === r.costo_estimado_qq) return;
    try { await apiPatch(`/resultado-mensual/rubros/${r.id}`, { costo_estimado_qq: valor }); await cargar(); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo guardar", "error"); }
  }
  async function guardarEdicion(r: Rubro) {
    if (!editando) return;
    const nombre = editando.nombre.trim();
    const estimado = Number(editando.estimado);
    if (nombre.length < 2) { avisar("El nombre del rubro debe tener al menos 2 letras", "error"); return; }
    if (!Number.isFinite(estimado) || estimado < 0) { avisar("Costo estimado inválido", "error"); return; }
    const cambios: { nombre?: string; costo_estimado_qq?: number } = {};
    if (nombre !== r.nombre) cambios.nombre = nombre;
    if (estimado !== r.costo_estimado_qq) cambios.costo_estimado_qq = estimado;
    if (!Object.keys(cambios).length) { setEditando(null); return; }
    try {
      const out = await apiPatch<{ categoria_renombrada: string | null }>(`/resultado-mensual/rubros/${r.id}`, cambios);
      avisar(out.categoria_renombrada ? `Rubro guardado · categoría de Caja renombrada a «${out.categoria_renombrada}»` : "Rubro guardado", "success");
      setEditando(null);
      if (cambios.nombre) { cargarCategorias(); onCategoriasCaja?.(); }
      await cargar();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo guardar", "error"); }
  }
  async function cambiarEnlaces(r: Rubro, cambios: { categorias?: string[]; nomina?: string[] }) {
    try { await apiPatch(`/resultado-mensual/rubros/${r.id}`, cambios); await cargar(); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo guardar", "error"); }
  }
  async function asignar(m: Mov, rubroId: string) {
    if (!rubroId) return;
    const cuerpo = m.tipo_nomina ? { tipo_nomina: m.tipo_nomina }
      : m.categoria_codigo && m.categoria_codigo !== "PAGO_MANO_OBRA" ? { categoria_codigo: m.categoria_codigo }
        : { clave: (m.subcategoria || m.descripcion || "").trim().slice(0, 60) };
    try {
      await apiPost(`/resultado-mensual/rubros/${rubroId}/asignar`, cuerpo);
      const que = m.tipo_nomina ? `los pagos de ${NOMINA_LABEL[m.tipo_nomina] ?? m.tipo_nomina}` : `la categoría «${m.categoria}»`;
      avisar(`Listo: desde ahora ${que} cuentan en ese rubro`, "success");
      await cargar();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo asignar", "error"); }
  }
  async function agregarManual() {
    const monto = Number(nuevo.monto);
    if (nuevo.concepto.trim().length < 2 || !(monto >= 0)) { avisar("Escribe el concepto y el monto", "error"); return; }
    try {
      await apiPost("/resultado-mensual/manual", { periodo, seccion: nuevo.seccion, concepto: nuevo.concepto.trim(), monto });
      setNuevo({ ...nuevo, concepto: "", monto: "" });
      await cargar();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo agregar", "error"); }
  }
  async function borrarManual(id: string) {
    if (!window.confirm("¿Quitar este monto del mes?")) return;
    try { await apiFetch(`/resultado-mensual/manual/${id}`, { method: "DELETE" }); await cargar(); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo quitar", "error"); }
  }
  async function crearRubro() {
    const est = Number(nuevoRubro.estimado) || 0;
    if (nuevoRubro.nombre.trim().length < 2) { avisar("Escribe el nombre del rubro", "error"); return; }
    try {
      const out = await apiPost<{ categoria_creada: string | null }>("/resultado-mensual/rubros", {
        nombre: nuevoRubro.nombre.trim(), costo_estimado_qq: est,
        categorias: nuevoRubro.categoria ? [nuevoRubro.categoria] : [], crear_categoria: !nuevoRubro.categoria
      });
      avisar(out.categoria_creada ? `Rubro creado · categoría «${out.categoria_creada}» agregada a Caja` : "Rubro creado", "success");
      setNuevoRubro({ nombre: "", estimado: "", categoria: "" });
      cargarCategorias(); onCategoriasCaja?.();
      await cargar();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo crear", "error"); }
  }
  async function desactivarRubro(r: Rubro) {
    if (!window.confirm(`¿Quitar el rubro «${r.nombre}» del reporte? Sus egresos pasarán a «Sin clasificar». La categoría de Caja se conserva (tiene historial).`)) return;
    try { await apiPatch(`/resultado-mensual/rubros/${r.id}`, { activo: false }); await cargar(); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo quitar", "error"); }
  }

  const celda = { padding: "6px 10px", borderBottom: "1px solid #eef2f7" } as const;
  const num = { ...celda, textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const };

  return (
    <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="tablePanel">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <h2 style={{ margin: 0 }}>📊 Resultado mensual · Costos vs estimado</h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12.5 }}>Costo real = gasto del rubro ÷ QQ de cáscara comprada en el mes (CEYRO + ROVINSON + STALYN). En <span style={{ ...ROJO, padding: "0 6px", borderRadius: 4 }}>rojo</span> los rubros que superan su costo estimado.</p>
          </div>
          <label style={{ margin: 0 }}><span>Mes</span><input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} /></label>
          <label style={{ margin: 0 }}><span>QQ cáscara (opcional)</span>
            <input type="number" min="0" step="0.01" value={qqManual} onChange={(e) => setQqManual(e.target.value)} placeholder={rep ? String(rep.cascara.total_auto) : "auto"} style={{ width: 130 }} />
          </label>
          <button type="button" className="btnSecondary" onClick={() => cargar()} disabled={cargando}>{cargando ? "⟳ Calculando…" : "↻ Actualizar"}</button>
        </div>
      </div>

      {rep && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }} className="resultadoMensualGrid">
          {/* ── Costos operativos ── */}
          <div className="tablePanel" style={{ overflowX: "auto" }}>
            <h3 style={{ margin: "0 0 8px" }}>💸 Costos operativos · {rep.periodo}</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f8fafc", color: "#475569" }}>
                <th style={{ ...celda, textAlign: "left" }}>Rubro</th>
                <th style={{ ...num }}>Costo estimado</th>
                <th style={{ ...num }}>Gasto</th>
                <th style={{ ...num }}>Costo real</th>
              </tr></thead>
              <tbody>
                {rep.rubros.map((r) => (
                  <Fragment key={r.id}>
                    <tr style={{ cursor: r.detalle.length ? "pointer" : "default" }} onClick={() => r.detalle.length && setAbierto(abierto === r.id ? null : r.id)}>
                      <td style={{ ...celda, fontWeight: 600 }}>
                        {r.detalle.length ? (abierto === r.id ? "▾ " : "▸ ") : ""}{r.nombre}
                        <small className="muted" style={{ display: "block", fontWeight: 400, fontSize: 11 }}>
                          {[...r.categorias.map((c) => `Caja: ${nombreCategoria(c)}`), ...r.nomina.map((t) => `Nómina: ${NOMINA_LABEL[t] ?? t}`)].join(" · ") || "Sin categoría enlazada"}
                        </small>
                      </td>
                      <td style={num} onClick={(e) => e.stopPropagation()}>
                        {puedeEditar ? (
                          <input type="number" min="0" step="0.01" defaultValue={r.costo_estimado_qq.toFixed(2)} key={`${r.id}-${r.costo_estimado_qq}`}
                            onBlur={(e) => guardarEstimado(r, Number(e.target.value))} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            style={{ width: 72, textAlign: "right", padding: "3px 6px", borderRadius: 5, border: "1px solid #d1d5db" }} />
                        ) : porQq(r.costo_estimado_qq)}
                      </td>
                      <td style={num}>{r.gasto_total > 0 ? dinero(r.gasto_total) : "—"}</td>
                      <td style={{ ...num, fontWeight: 800, ...(r.gasto_total > 0 ? (r.alerta ? ROJO : VERDE) : {}) }} title={r.alerta ? "Supera el costo estimado" : ""}>
                        {r.gasto_total > 0 ? porQq(r.costo_real_qq) : "—"}
                      </td>
                    </tr>
                    {abierto === r.id && r.detalle.map((m, i) => (
                      <tr key={`${r.id}-${i}`} style={{ background: "#fbfdff", fontSize: 12 }}>
                        <td style={{ ...celda, paddingLeft: 26 }} colSpan={2}>{m.fecha} · {m.descripcion}{m.subcategoria ? <span className="muted"> · {m.subcategoria}</span> : null}</td>
                        <td style={num}>{dinero(m.monto)}</td><td style={celda} />
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {rep.sin_clasificar.monto > 0 && (
                  <>
                    <tr style={{ background: "#fff7ed", cursor: "pointer" }} onClick={() => setAbierto(abierto === "sin" ? null : "sin")}>
                      <td style={{ ...celda, fontWeight: 700, color: "#9a3412" }}>{abierto === "sin" ? "▾ " : "▸ "}Sin clasificar ({rep.sin_clasificar.detalle.length})</td>
                      <td style={num}>—</td><td style={num}>{dinero(rep.sin_clasificar.monto)}</td>
                      <td style={num}>{porQq(rep.cascara.total > 0 ? rep.sin_clasificar.monto / rep.cascara.total : 0)}</td>
                    </tr>
                    {abierto === "sin" && rep.sin_clasificar.detalle.map((m, i) => (
                      <tr key={`sin-${i}`} style={{ background: "#fffbf5", fontSize: 12 }}>
                        <td style={{ ...celda, paddingLeft: 26 }}>{m.fecha} · {m.descripcion}<span className="muted"> · {m.subcategoria || m.categoria}</span></td>
                        <td style={celda} colSpan={2}>
                          {puedeEditar && (
                            <select defaultValue="" onChange={(e) => asignar(m, e.target.value)} style={{ fontSize: 12, padding: "3px 6px", width: "100%" }}>
                              <option value="">Asignar a rubro…</option>
                              {rep.rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                            </select>
                          )}
                        </td>
                        <td style={num}>{dinero(m.monto)}</td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
              <tfoot>
                <tr style={{ background: "#0f766e", color: "#fff" }}>
                  <td style={{ ...celda, fontWeight: 800, color: "#fff" }}>TOTAL COSTO</td>
                  <td style={{ ...num, fontWeight: 800, color: "#fff" }}>{porQq(rep.costo_estimado_qq)}</td>
                  <td style={{ ...num, fontWeight: 800, color: "#fff" }}>{dinero(rep.total_costos)}</td>
                  <td style={{ ...num, fontWeight: 800, ...(costoAlto ? { background: "#CC0000", color: "#fff" } : { color: "#fff" }) }}>{porQq(rep.costo_real_qq)}</td>
                </tr>
              </tfoot>
            </table>
            {rep.excluidos.length > 0 && (
              <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
                No son costo operativo (no se suman): {rep.excluidos.map((e) => `${e.categoria} ${dinero(e.monto)}`).join(" · ")}.
              </p>
            )}
            <p className="muted" style={{ fontSize: 11.5, margin: "6px 0 0" }}>
              Cada egreso de la Caja de CEYRO entra al rubro de la <strong>categoría</strong> con que se registró; los pagos de <strong>Nómina</strong> se reparten por tipo (sueldo, cuadrilla, pilador…). Toca un rubro para ver sus egresos; un «Sin clasificar» se asigna una vez y el sistema lo recuerda.
            </p>
            {puedeEditar && (
              <div style={{ marginTop: 10 }}>
                <button type="button" className="btnSecondary" style={{ fontSize: 12 }} onClick={() => setVerRubros((v) => !v)}>{verRubros ? "Ocultar configuración" : "⚙️ Configurar rubros"}</button>
                {verRubros && (
                  <div style={{ marginTop: 10, border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#fbfdff" }}>
                    <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>
                      Cada rubro se llena con los egresos de su <strong>categoría de Caja</strong> (la que eliges al registrar el gasto en Caja → ➕ Nuevo movimiento).
                      Los pagos de <strong>Nómina</strong> usan una sola categoría, por eso se asignan por tipo de pago. Cambiar el nombre de un rubro cambia también el de su categoría en Caja.
                    </p>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                        <thead><tr style={{ color: "#475569", background: "#f1f5f9" }}>
                          <th style={{ ...celda, textAlign: "left" }}>Rubro</th>
                          <th style={{ ...celda, textAlign: "left" }}>Categoría de Caja</th>
                          <th style={{ ...celda, textAlign: "left" }}>Pagos de nómina</th>
                          <th style={celda} />
                        </tr></thead>
                        <tbody>
                          {rep.rubros.map((r) => {
                            const chip = (texto: string, quitar: () => void) => (
                              <span key={texto} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#e0f2fe", color: "#075985", borderRadius: 999, padding: "2px 8px", margin: "0 4px 4px 0", fontWeight: 600 }}>
                                {texto}<button type="button" onClick={quitar} title="Quitar" style={{ border: "none", background: "transparent", color: "#0369a1", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                              </span>
                            );
                            return (
                              <tr key={r.id} style={{ verticalAlign: "top" }}>
                                <td style={celda}>
                                  {editando?.id === r.id ? (
                                    <div style={{ display: "grid", gap: 4, minWidth: 180 }}>
                                      <input autoFocus value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                                        onKeyDown={(e) => { if (e.key === "Enter") guardarEdicion(r); if (e.key === "Escape") setEditando(null); }}
                                        placeholder="Nombre del rubro" style={{ fontSize: 12.5, padding: "4px 6px" }} />
                                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, margin: 0 }}>
                                        Costo estimado $/QQ
                                        <input type="number" min="0" step="0.01" value={editando.estimado} onChange={(e) => setEditando({ ...editando, estimado: e.target.value })}
                                          onKeyDown={(e) => { if (e.key === "Enter") guardarEdicion(r); if (e.key === "Escape") setEditando(null); }}
                                          style={{ width: 80, fontSize: 12, padding: "3px 6px", textAlign: "right" }} />
                                      </label>
                                    </div>
                                  ) : (
                                    <>
                                      <strong>{r.nombre}</strong>
                                      <small className="muted" style={{ display: "block" }}>Estimado {porQq(r.costo_estimado_qq)}/QQ</small>
                                    </>
                                  )}
                                </td>
                                <td style={celda}>
                                  {r.categorias.map((c) => chip(nombreCategoria(c), () => cambiarEnlaces(r, { categorias: r.categorias.filter((x) => x !== c) })))}
                                  <select value="" onChange={(e) => e.target.value && cambiarEnlaces(r, { categorias: [...r.categorias, e.target.value] })} style={{ fontSize: 12, padding: "2px 4px", maxWidth: 200 }}>
                                    <option value="">＋ Enlazar categoría…</option>
                                    {categoriasCaja.filter((c) => !r.categorias.includes(c.codigo)).map((c) => {
                                      const otro = rep.rubros.find((x) => x.id !== r.id && x.categorias.includes(c.codigo));
                                      return <option key={c.codigo} value={c.codigo}>{c.nombre}{otro ? ` (hoy en ${otro.nombre})` : ""}</option>;
                                    })}
                                  </select>
                                </td>
                                <td style={celda}>
                                  {r.nomina.map((t) => chip(NOMINA_LABEL[t] ?? t, () => cambiarEnlaces(r, { nomina: r.nomina.filter((x) => x !== t) })))}
                                  <select value="" onChange={(e) => e.target.value && cambiarEnlaces(r, { nomina: [...r.nomina, e.target.value] })} style={{ fontSize: 12, padding: "2px 4px", maxWidth: 170 }}>
                                    <option value="">＋ Pago de nómina…</option>
                                    {Object.entries(NOMINA_LABEL).filter(([t]) => !r.nomina.includes(t)).map(([t, l]) => {
                                      const otro = rep.rubros.find((x) => x.id !== r.id && x.nomina.includes(t));
                                      return <option key={t} value={t}>{l}{otro ? ` (hoy en ${otro.nombre})` : ""}</option>;
                                    })}
                                  </select>
                                </td>
                                <td style={{ ...celda, whiteSpace: "nowrap" }}>
                                  {editando?.id === r.id ? (
                                    <>
                                      <button type="button" className="primary" style={{ fontSize: 11 }} onClick={() => guardarEdicion(r)}>💾 Guardar</button>{" "}
                                      <button type="button" className="btnSecondary" style={{ fontSize: 11 }} onClick={() => setEditando(null)}>Cancelar</button>
                                    </>
                                  ) : (
                                    <>
                                      <button type="button" className="btnSecondary" style={{ fontSize: 11 }}
                                        onClick={() => setEditando({ id: r.id, nombre: r.nombre, estimado: String(r.costo_estimado_qq) })}>✏️ Editar</button>{" "}
                                      <button type="button" className="btnSecondary" style={{ fontSize: 11, color: "#b91c1c" }} onClick={() => desactivarRubro(r)}>Quitar</button>
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ marginTop: 12, fontWeight: 700, fontSize: 12.5 }}>➕ Nuevo rubro</div>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) 90px minmax(0, 1.4fr) auto", gap: 6, marginTop: 6 }}>
                      <input value={nuevoRubro.nombre} onChange={(e) => setNuevoRubro({ ...nuevoRubro, nombre: e.target.value })} placeholder="Nombre (ej: Fumigación)" style={{ fontSize: 12 }} />
                      <input type="number" min="0" step="0.01" value={nuevoRubro.estimado} onChange={(e) => setNuevoRubro({ ...nuevoRubro, estimado: e.target.value })} placeholder="$/QQ" style={{ fontSize: 12 }} />
                      <select value={nuevoRubro.categoria} onChange={(e) => setNuevoRubro({ ...nuevoRubro, categoria: e.target.value })} style={{ fontSize: 12 }}>
                        <option value="">Crear su categoría en Caja con el mismo nombre</option>
                        {categoriasCaja.map((c) => <option key={c.codigo} value={c.codigo}>Usar la categoría existente: {c.nombre}</option>)}
                      </select>
                      <button type="button" className="primary" style={{ fontSize: 12 }} onClick={crearRubro}>Agregar</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Base + ingresos adicionales ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="tablePanel">
              <h3 style={{ margin: "0 0 8px" }}>🌾 Cáscara comprada en el mes</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {rep.cascara.operaciones.map((o) => (
                    <tr key={o.operacion}><td style={celda}>{o.operacion}</td><td style={{ ...num, color: "#64748b" }}>{o.liquidaciones} liq.</td><td style={num}>{o.qq.toFixed(2)} QQ</td></tr>
                  ))}
                  <tr><td style={{ ...celda, fontWeight: 800 }}>Total {rep.cascara.manual ? "(manual)" : ""}</td><td style={celda} /><td style={{ ...num, fontWeight: 800 }}>{rep.cascara.total.toFixed(2)} QQ</td></tr>
                </tbody>
              </table>
            </div>

            <div className="tablePanel">
              <h3 style={{ margin: "0 0 8px" }}>💰 Ingresos adicionales</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {rep.ingresos.length === 0 && gana.length === 0 && <tr><td className="muted" style={celda}>Sin ingresos adicionales en el mes.</td></tr>}
                  {rep.ingresos.map((i, k) => (
                    <tr key={`${i.concepto}-${k}`}>
                      <td style={celda}>{i.concepto}{i.origen === "manual" && <span className="muted" style={{ fontSize: 11 }}> · manual</span>}</td>
                      <td style={num}>{dinero(i.monto)}</td>
                      <td style={{ ...celda, width: 28 }}>{i.origen === "manual" && i.id && puedeEditar && <button type="button" className="btnGhost" title="Quitar" onClick={() => borrarManual(i.id!)}>🗑</button>}</td>
                    </tr>
                  ))}
                  {gana.map((g) => (
                    <tr key={`gana-${g.operacion}`}>
                      <td style={celda}>Gana (arroz pilado propio) · {g.operacion} <span className="muted" style={{ fontSize: 11 }}>· {g.lotes} lote{g.lotes === 1 ? "" : "s"}</span></td>
                      <td style={{ ...num, color: g.utilidad < 0 ? "#b91c1c" : undefined }}>{dinero(g.utilidad)}</td><td style={celda} />
                    </tr>
                  ))}
                  <tr style={{ background: "#ecfdf5" }}><td style={{ ...celda, fontWeight: 800 }}>TOTAL INGRESOS ADICIONALES</td><td style={{ ...num, fontWeight: 800 }}>{dinero(totalIngresos)}</td><td style={celda} /></tr>
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 11.5, margin: "6px 0 0" }}>Automáticos: báscula, tamo (Caja), servicios de pilada/secado, cobros a socios, interés de fomentos cerrados en el mes y Gana de lotes con precio de venta. Agrega abajo lo que falte (envejecido, selectado…).</p>
            </div>
          </div>
        </div>
      )}

      {rep && (
        <div className="tablePanel">
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }} className="resultadoMensualGrid">
            <div>
              <h3 style={{ margin: "0 0 8px" }}>🏦 Gastos financieros</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {rep.financieros.length === 0 && <tr><td className="muted" style={celda}>Agrega hipoteca, préstamos o diferidos por avances del mes.</td></tr>}
                  {rep.financieros.map((f) => (
                    <tr key={f.id}><td style={celda}>{f.concepto}</td><td style={num}>{dinero(f.monto)}</td>
                      <td style={{ ...celda, width: 28 }}>{puedeEditar && <button type="button" className="btnGhost" title="Quitar" onClick={() => borrarManual(f.id)}>🗑</button>}</td></tr>
                  ))}
                  <tr><td style={{ ...celda, fontWeight: 800 }}>TOTAL GASTOS FINANCIEROS</td><td style={{ ...num, fontWeight: 800 }}>{dinero(rep.total_financieros)}</td><td style={celda} /></tr>
                </tbody>
              </table>
              {puedeEditar && (
                <div style={{ display: "grid", gridTemplateColumns: "130px minmax(0, 1fr) 110px auto", gap: 6, marginTop: 10 }}>
                  <select value={nuevo.seccion} onChange={(e) => setNuevo({ ...nuevo, seccion: e.target.value as "INGRESO" | "FINANCIERO" })} style={{ fontSize: 12 }}>
                    <option value="FINANCIERO">Gasto financiero</option>
                    <option value="INGRESO">Ingreso adicional</option>
                  </select>
                  <input value={nuevo.concepto} onChange={(e) => setNuevo({ ...nuevo, concepto: e.target.value })} placeholder={nuevo.seccion === "FINANCIERO" ? "Ej: Hipoteca, préstamo, diferido" : "Ej: Ganancia envejecido"} style={{ fontSize: 12 }} />
                  <input type="number" min="0" step="0.01" value={nuevo.monto} onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })} placeholder="0.00" style={{ fontSize: 12 }} />
                  <button type="button" className="primary" style={{ fontSize: 12 }} onClick={agregarManual}>Agregar</button>
                </div>
              )}
            </div>
            <div>
              <h3 style={{ margin: "0 0 8px" }}>🧮 Resultado del mes</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <tbody>
                  <tr><td style={celda}>Ingresos adicionales</td><td style={num}>{dinero(totalIngresos)}</td></tr>
                  <tr><td style={celda}>− Costos operativos</td><td style={num}>{dinero(rep.total_costos)}</td></tr>
                  <tr><td style={celda}>− Gastos financieros</td><td style={num}>{dinero(rep.total_financieros)}</td></tr>
                </tbody>
              </table>
              <div style={{ marginTop: 10, borderRadius: 12, padding: "14px 16px", ...(neto < 0 ? { background: "#CC0000", color: "#fff" } : { background: "#dcfce7", color: "#14532d", border: "1px solid #86efac" }) }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".05em" }}>TOTAL NETO DE GANANCIAS</div>
                <div style={{ fontSize: 30, fontWeight: 900 }}>{dinero(neto)}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                  {neto < 0 ? "⚠️ PÉRDIDA REAL: los ingresos no cubren los costos operativos y financieros del mes." : "✅ Se cubrieron todos los costos operativos y financieros del mes."}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
