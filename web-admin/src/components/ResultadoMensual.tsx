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
  // Pestañas del módulo y menú «+ Asignar» (rubro + tipo de enlace).
  const [vista, setVista] = useState<"reporte" | "mapeo">("reporte");
  const [menu, setMenu] = useState<{ id: string; tipo: "caja" | "nomina" } | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
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

  // Menú «+ Asignar» abierto: rubro y tipo de enlace (categoría de Caja o nómina).
  const cerrarMenu = () => setMenu(null);
  useEffect(() => {
    if (!menu) return;
    const cerrar = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.(".rm-pop, .rm-link")) setMenu(null); };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [menu]);

  const tarjetaNeto = (
    <div className={`rm-neto ${neto < 0 ? "is-perdida" : "is-ganancia"}`}>
      <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".06em" }}>TOTAL NETO DE GANANCIAS</div>
      <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.15 }}>{dinero(neto)}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>
        {neto < 0 ? "⚠️ PÉRDIDA REAL: los ingresos no cubren los costos operativos y financieros del mes." : "✅ Se cubrieron todos los costos operativos y financieros del mes."}
      </div>
    </div>
  );

  return (
    <div className="rm-wrap">
      {/* ── Encabezado: título, pestañas y filtros ── */}
      <div className="rm-card" style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px" }}>
          <h2 className="rm-title" style={{ fontSize: 18 }}>📊 Resultado mensual</h2>
          <p className="rm-sub">Costo real = gasto del rubro ÷ QQ de cáscara comprada en el mes (CEYRO + ROVINSON + STALYN).</p>
          <div className="rm-tabs" style={{ marginTop: 12 }} role="tablist">
            <button type="button" role="tab" className={`rm-tab ${vista === "reporte" ? "is-active" : ""}`} onClick={() => setVista("reporte")}>📊 Reporte de costos vs estimado</button>
            {puedeEditar && (
              <button type="button" role="tab" className={`rm-tab ${vista === "mapeo" ? "is-active" : ""}`} onClick={() => setVista("mapeo")}>⚙️ Mapeo y configuración de rubros</button>
            )}
          </div>
        </div>
        <label style={{ margin: 0 }}><span>Mes</span><input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} /></label>
        <label style={{ margin: 0 }}><span>QQ cáscara (opcional)</span>
          <input type="number" min="0" step="0.01" value={qqManual} onChange={(e) => setQqManual(e.target.value)} placeholder={rep ? String(rep.cascara.total_auto) : "auto"} style={{ width: 130 }} />
        </label>
        <button type="button" className="btnSecondary" onClick={() => cargar()} disabled={cargando}>{cargando ? "⟳ Calculando…" : "↻ Actualizar"}</button>
      </div>

      {/* ════════════════════ PESTAÑA: REPORTE ════════════════════ */}
      {rep && vista === "reporte" && (
        <div className="rm-grid">
          <div className="rm-main">
            <div className="rm-card" style={{ overflowX: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <h3 className="rm-title">💸 Costos operativos · {rep.periodo}</h3>
                <span className="rm-sub" style={{ margin: 0 }}>Toca un rubro para ver sus egresos</span>
              </div>
              <table className="rm-table">
                <thead><tr>
                  <th>Rubro</th><th className="num">Costo estimado</th><th className="num">Gasto</th><th className="num">Costo real</th>
                </tr></thead>
                <tbody>
                  {rep.rubros.map((r) => (
                    <Fragment key={r.id}>
                      <tr className={r.detalle.length ? "rm-click" : ""} onClick={() => r.detalle.length && setAbierto(abierto === r.id ? null : r.id)}>
                        <td>
                          <span style={{ fontWeight: 600 }}>{r.detalle.length ? (abierto === r.id ? "▾ " : "▸ ") : ""}{r.nombre}</span>
                          {r.detalle.length > 0 && <span className="rm-muted" style={{ fontSize: 11.5 }}> · {r.detalle.length} egreso{r.detalle.length === 1 ? "" : "s"}</span>}
                        </td>
                        <td className="num">{porQq(r.costo_estimado_qq)}</td>
                        <td className="num">{r.gasto_total > 0 ? dinero(r.gasto_total) : <span className="rm-muted">—</span>}</td>
                        <td className={`num ${r.gasto_total > 0 ? (r.alerta ? "rm-alerta" : "rm-ok") : ""}`} title={r.alerta ? "Supera el costo estimado" : ""}>
                          {r.gasto_total > 0 ? porQq(r.costo_real_qq) : <span className="rm-muted">—</span>}
                        </td>
                      </tr>
                      {abierto === r.id && r.detalle.map((m, i) => (
                        <tr key={`${r.id}-${i}`} className="rm-det">
                          <td colSpan={2} style={{ paddingLeft: 26 }}>{m.fecha} · {m.descripcion}{m.subcategoria ? <span className="rm-muted"> · {m.subcategoria}</span> : null}</td>
                          <td className="num">{dinero(m.monto)}</td><td />
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  {rep.sin_clasificar.monto > 0 && (
                    <>
                      <tr className="rm-click" onClick={() => setAbierto(abierto === "sin" ? null : "sin")} style={{ background: "#fff7ed" }}>
                        <td style={{ fontWeight: 700, color: "#9a3412" }}>{abierto === "sin" ? "▾ " : "▸ "}Sin clasificar ({rep.sin_clasificar.detalle.length})</td>
                        <td className="num rm-muted">—</td><td className="num">{dinero(rep.sin_clasificar.monto)}</td>
                        <td className="num">{porQq(rep.cascara.total > 0 ? rep.sin_clasificar.monto / rep.cascara.total : 0)}</td>
                      </tr>
                      {abierto === "sin" && rep.sin_clasificar.detalle.map((m, i) => (
                        <tr key={`sin-${i}`} className="rm-det">
                          <td style={{ paddingLeft: 26 }}>{m.fecha} · {m.descripcion}<span className="rm-muted"> · {m.subcategoria || m.categoria}</span></td>
                          <td colSpan={2}>
                            {puedeEditar && (
                              <select defaultValue="" onChange={(e) => asignar(m, e.target.value)} style={{ fontSize: 12, padding: "4px 6px", width: "100%" }}>
                                <option value="">Asignar a rubro…</option>
                                {rep.rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                              </select>
                            )}
                          </td>
                          <td className="num">{dinero(m.monto)}</td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td>TOTAL COSTO</td>
                    <td className="num">{porQq(rep.costo_estimado_qq)}</td>
                    <td className="num">{dinero(rep.total_costos)}</td>
                    <td className={`num ${costoAlto ? "rm-alerta" : "rm-ok"}`}>{porQq(rep.costo_real_qq)}</td>
                  </tr>
                </tfoot>
              </table>
              {rep.excluidos.length > 0 && (
                <p className="rm-sub" style={{ fontSize: 11.5 }}>No son costo operativo (no se suman): {rep.excluidos.map((e) => `${e.categoria} ${dinero(e.monto)}`).join(" · ")}.</p>
              )}
            </div>

            <div className="rm-card">
              <h3 className="rm-title" style={{ marginBottom: 10 }}>🧮 Resultado del mes</h3>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", gap: 16, alignItems: "center" }}>
                <table className="rm-table" style={{ fontSize: 13.5 }}>
                  <tbody>
                    <tr><td>Ingresos adicionales</td><td className="num">{dinero(totalIngresos)}</td></tr>
                    <tr><td>− Costos operativos</td><td className="num">{dinero(rep.total_costos)}</td></tr>
                    <tr><td>− Gastos financieros</td><td className="num">{dinero(rep.total_financieros)}</td></tr>
                  </tbody>
                </table>
                {tarjetaNeto}
              </div>
            </div>
          </div>

          <div className="rm-side">
            <div className="rm-card">
              <h3 className="rm-title" style={{ marginBottom: 8 }}>🌾 Cáscara comprada</h3>
              <table className="rm-table">
                <tbody>
                  {rep.cascara.operaciones.map((o) => (
                    <tr key={o.operacion}><td>{o.operacion}<span className="rm-muted" style={{ fontSize: 11.5 }}> · {o.liquidaciones} liq.</span></td><td className="num">{o.qq.toFixed(2)} QQ</td></tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total {rep.cascara.manual ? "(manual)" : ""}</td><td className="num">{rep.cascara.total.toFixed(2)} QQ</td></tr></tfoot>
              </table>
            </div>

            <div className="rm-card">
              <h3 className="rm-title" style={{ marginBottom: 8 }}>💰 Ingresos adicionales</h3>
              <table className="rm-table">
                <tbody>
                  {rep.ingresos.length === 0 && gana.length === 0 && <tr><td className="rm-muted">Sin ingresos adicionales en el mes.</td></tr>}
                  {rep.ingresos.map((i, k) => (
                    <tr key={`${i.concepto}-${k}`}>
                      <td>{i.concepto}{i.origen === "manual" && <span className="rm-muted" style={{ fontSize: 11 }}> · manual</span>}</td>
                      <td className="num">{dinero(i.monto)}</td>
                      <td style={{ width: 28 }}>{i.origen === "manual" && i.id && puedeEditar && <button type="button" className="btnGhost" title="Quitar" onClick={() => borrarManual(i.id!)}>🗑</button>}</td>
                    </tr>
                  ))}
                  {gana.map((g) => (
                    <tr key={`gana-${g.operacion}`}>
                      <td>Gana · {g.operacion}<span className="rm-muted" style={{ fontSize: 11 }}> · {g.lotes} lote{g.lotes === 1 ? "" : "s"}</span></td>
                      <td className="num" style={{ color: g.utilidad < 0 ? "#dc2626" : undefined }}>{dinero(g.utilidad)}</td><td />
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total</td><td className="num">{dinero(totalIngresos)}</td><td /></tr></tfoot>
              </table>
            </div>

            <div className="rm-card">
              <h3 className="rm-title" style={{ marginBottom: 8 }}>🏦 Gastos financieros</h3>
              <table className="rm-table">
                <tbody>
                  {rep.financieros.length === 0 && <tr><td className="rm-muted">Hipoteca, préstamos o diferidos del mes.</td></tr>}
                  {rep.financieros.map((f) => (
                    <tr key={f.id}><td>{f.concepto}</td><td className="num">{dinero(f.monto)}</td>
                      <td style={{ width: 28 }}>{puedeEditar && <button type="button" className="btnGhost" title="Quitar" onClick={() => borrarManual(f.id)}>🗑</button>}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total</td><td className="num">{dinero(rep.total_financieros)}</td><td /></tr></tfoot>
              </table>
              {puedeEditar && (
                <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
                  <select value={nuevo.seccion} onChange={(e) => setNuevo({ ...nuevo, seccion: e.target.value as "INGRESO" | "FINANCIERO" })} style={{ fontSize: 12.5 }}>
                    <option value="FINANCIERO">➕ Gasto financiero</option>
                    <option value="INGRESO">➕ Ingreso adicional</option>
                  </select>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 100px auto", gap: 6 }}>
                    <input value={nuevo.concepto} onChange={(e) => setNuevo({ ...nuevo, concepto: e.target.value })} placeholder={nuevo.seccion === "FINANCIERO" ? "Hipoteca, préstamo…" : "Ganancia envejecido…"} style={{ fontSize: 12.5 }} />
                    <input type="number" min="0" step="0.01" value={nuevo.monto} onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })} placeholder="0.00" style={{ fontSize: 12.5 }} />
                    <button type="button" className="primary" style={{ fontSize: 12.5 }} onClick={agregarManual}>Agregar</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════ PESTAÑA: MAPEO DE RUBROS ════════════════════ */}
      {rep && vista === "mapeo" && puedeEditar && (
        <div className="rm-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <h3 className="rm-title">⚙️ Mapeo y configuración de rubros</h3>
            <p className="rm-sub">
              Cada rubro se llena con los egresos de su <strong>categoría de Caja</strong> (la que eliges en Caja → ➕ Nuevo movimiento). Los pagos de <strong>Nómina</strong> comparten una sola categoría, por eso se asignan por tipo de pago.
              Cambiar el nombre de un rubro cambia también el de su categoría en Caja.
            </p>
            <div style={{ marginTop: 8 }}>
              <span className="rm-badge rm-badge-caja">Categoría de Caja</span>
              <span className="rm-badge rm-badge-nom">Pago de nómina</span>
            </div>
          </div>

          {rep.rubros.map((r) => {
            const enEdicion = editando?.id === r.id;
            const libresCaja = categoriasCaja.filter((c) => !r.categorias.includes(c.codigo));
            const libresNom = Object.entries(NOMINA_LABEL).filter(([t]) => !r.nomina.includes(t));
            return (
              <div key={r.id} className="rm-rubro">
                <div>
                  {enEdicion ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <input autoFocus value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") guardarEdicion(r); if (e.key === "Escape") setEditando(null); }}
                        placeholder="Nombre del rubro" style={{ fontSize: 13, padding: "6px 8px" }} />
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: 0, color: "#475569" }}>
                        Costo estimado $/QQ
                        <input type="number" min="0" step="0.01" value={editando.estimado} onChange={(e) => setEditando({ ...editando, estimado: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") guardarEdicion(r); if (e.key === "Escape") setEditando(null); }}
                          style={{ width: 90, fontSize: 12.5, padding: "4px 6px", textAlign: "right" }} />
                      </label>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600, color: "#1e293b" }}>{r.nombre}</div>
                      <div className="rm-sub" style={{ marginTop: 2 }}>Estimado {porQq(r.costo_estimado_qq)}/QQ</div>
                    </>
                  )}
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <span className="rm-label">Categorías de Caja</span>
                    <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center" }}>
                      {r.categorias.map((c) => (
                        <span key={c} className="rm-badge rm-badge-caja">
                          {nombreCategoria(c)}
                          <button type="button" title="Quitar enlace" onClick={() => cambiarEnlaces(r, { categorias: r.categorias.filter((x) => x !== c) })}>×</button>
                        </span>
                      ))}
                      <button type="button" className="rm-link" onClick={() => setMenu(menu?.id === r.id && menu.tipo === "caja" ? null : { id: r.id, tipo: "caja" })}>+ Asignar</button>
                      {menu?.id === r.id && menu.tipo === "caja" && (
                        <div className="rm-pop" role="menu">
                          {libresCaja.length === 0 && <small style={{ display: "block", padding: 8 }}>No hay más categorías.</small>}
                          {libresCaja.map((c) => {
                            const otro = rep.rubros.find((x) => x.id !== r.id && x.categorias.includes(c.codigo));
                            return (
                              <button key={c.codigo} type="button" onClick={() => { cerrarMenu(); cambiarEnlaces(r, { categorias: [...r.categorias, c.codigo] }); }}>
                                {c.nombre}{otro && <small> · hoy en {otro.nombre}</small>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="rm-label">Pagos de nómina</span>
                    <div style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center" }}>
                      {r.nomina.map((t) => (
                        <span key={t} className="rm-badge rm-badge-nom">
                          {NOMINA_LABEL[t] ?? t}
                          <button type="button" title="Quitar enlace" onClick={() => cambiarEnlaces(r, { nomina: r.nomina.filter((x) => x !== t) })}>×</button>
                        </span>
                      ))}
                      <button type="button" className="rm-link" onClick={() => setMenu(menu?.id === r.id && menu.tipo === "nomina" ? null : { id: r.id, tipo: "nomina" })}>+ Asignar</button>
                      {menu?.id === r.id && menu.tipo === "nomina" && (
                        <div className="rm-pop" role="menu">
                          {libresNom.length === 0 && <small style={{ display: "block", padding: 8 }}>Ya tiene todos los tipos.</small>}
                          {libresNom.map(([t, l]) => {
                            const otro = rep.rubros.find((x) => x.id !== r.id && x.nomina.includes(t));
                            return (
                              <button key={t} type="button" onClick={() => { cerrarMenu(); cambiarEnlaces(r, { nomina: [...r.nomina, t] }); }}>
                                {l}{otro && <small> · hoy en {otro.nombre}</small>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {enEdicion ? (
                    <>
                      <button type="button" className="primary" style={{ fontSize: 12 }} onClick={() => guardarEdicion(r)}>💾 Guardar</button>
                      <button type="button" className="btnSecondary" style={{ fontSize: 12 }} onClick={() => setEditando(null)}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btnSecondary" style={{ fontSize: 12 }} onClick={() => setEditando({ id: r.id, nombre: r.nombre, estimado: String(r.costo_estimado_qq) })}>✏️ Editar</button>
                      <button type="button" className="btnSecondary" style={{ fontSize: 12, color: "#dc2626" }} onClick={() => desactivarRubro(r)}>Quitar</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Nuevo rubro (colapsable) ── */}
          <div style={{ border: "1px dashed #cbd5e1", borderRadius: 12, padding: nuevoAbierto ? 16 : 0 }}>
            {!nuevoAbierto ? (
              <button type="button" className="rm-link" style={{ width: "100%", margin: 0, padding: "12px", borderRadius: 12, border: "none", fontSize: 13 }} onClick={() => setNuevoAbierto(true)}>＋ Nuevo rubro</button>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <strong style={{ color: "#1e293b" }}>＋ Nuevo rubro</strong>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  <label style={{ margin: 0 }}><span>Nombre</span><input value={nuevoRubro.nombre} onChange={(e) => setNuevoRubro({ ...nuevoRubro, nombre: e.target.value })} placeholder="Ej: Fumigación" /></label>
                  <label style={{ margin: 0 }}><span>Costo estimado $/QQ</span><input type="number" min="0" step="0.01" value={nuevoRubro.estimado} onChange={(e) => setNuevoRubro({ ...nuevoRubro, estimado: e.target.value })} placeholder="0.00" /></label>
                  <label style={{ margin: 0 }}><span>Categoría de Caja</span>
                    <select value={nuevoRubro.categoria} onChange={(e) => setNuevoRubro({ ...nuevoRubro, categoria: e.target.value })}>
                      <option value="">Crear una nueva con el mismo nombre</option>
                      {categoriasCaja.map((c) => <option key={c.codigo} value={c.codigo}>Usar existente: {c.nombre}</option>)}
                    </select>
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="primary" onClick={async () => { await crearRubro(); setNuevoAbierto(false); }}>Crear rubro</button>
                  <button type="button" className="btnSecondary" onClick={() => setNuevoAbierto(false)}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
