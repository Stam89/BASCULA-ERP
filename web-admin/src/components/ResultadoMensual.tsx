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

type Mov = { fecha: string; descripcion: string; monto: number; categoria: string; subcategoria: string | null };
type Rubro = { id: string; nombre: string; claves: string[]; costo_estimado_qq: number; gasto_total: number; costo_real_qq: number; alerta: boolean; detalle: Mov[] };
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

export function ResultadoMensual({ puedeEditar, avisar, calcularGana }: {
  puedeEditar: boolean;
  avisar: (msg: string, tipo: "success" | "error" | "warn") => void;
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
  const [nuevoRubro, setNuevoRubro] = useState({ nombre: "", estimado: "", claves: "" });

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
  async function guardarClaves(r: Rubro, texto: string) {
    const claves = texto.split(",").map((c) => c.trim()).filter((c) => c.length >= 2);
    if (claves.join("|") === r.claves.join("|")) return;
    try { await apiPatch(`/resultado-mensual/rubros/${r.id}`, { claves }); await cargar(); avisar(`Claves de «${r.nombre}» actualizadas`, "success"); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo guardar", "error"); }
  }
  async function asignar(m: Mov, rubroId: string) {
    const clave = (m.subcategoria || m.descripcion || "").trim().slice(0, 60);
    if (!rubroId || clave.length < 2) return;
    try {
      await apiPost(`/resultado-mensual/rubros/${rubroId}/claves`, { clave });
      avisar(`Desde ahora «${clave}» cuenta en ese rubro`, "success");
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
      await apiPost("/resultado-mensual/rubros", {
        nombre: nuevoRubro.nombre.trim(), costo_estimado_qq: est,
        claves: nuevoRubro.claves.split(",").map((c) => c.trim()).filter((c) => c.length >= 2)
      });
      setNuevoRubro({ nombre: "", estimado: "", claves: "" });
      await cargar();
    } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo crear", "error"); }
  }
  async function desactivarRubro(r: Rubro) {
    if (!window.confirm(`¿Quitar el rubro «${r.nombre}» del reporte? Sus egresos pasarán a «Sin clasificar».`)) return;
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
                      <td style={{ ...celda, fontWeight: 600 }}>{r.detalle.length ? (abierto === r.id ? "▾ " : "▸ ") : ""}{r.nombre}</td>
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
              Cada egreso de la Caja de CEYRO entra al rubro según su <strong>subcategoría</strong> (o descripción). Toca un rubro para ver sus egresos; los «Sin clasificar» se asignan una vez y el sistema lo recuerda.
            </p>
            {puedeEditar && (
              <div style={{ marginTop: 10 }}>
                <button type="button" className="btnSecondary" style={{ fontSize: 12 }} onClick={() => setVerRubros((v) => !v)}>{verRubros ? "Ocultar" : "⚙️ Rubros y claves"}</button>
                {verRubros && (
                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    {rep.rubros.map((r) => (
                      <div key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr) auto", gap: 6, alignItems: "center", fontSize: 12 }}>
                        <strong>{r.nombre}</strong>
                        <input defaultValue={r.claves.join(", ")} key={`${r.id}-${r.claves.join(",")}`} onBlur={(e) => guardarClaves(r, e.target.value)}
                          title="Palabras separadas por coma: si aparecen en la subcategoría o descripción del egreso, cuenta en este rubro" style={{ fontSize: 12, padding: "4px 6px" }} />
                        <button type="button" className="btnSecondary" style={{ fontSize: 11, color: "#b91c1c" }} onClick={() => desactivarRubro(r)}>Quitar</button>
                      </div>
                    ))}
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 90px minmax(0, 2fr) auto", gap: 6, marginTop: 6 }}>
                      <input value={nuevoRubro.nombre} onChange={(e) => setNuevoRubro({ ...nuevoRubro, nombre: e.target.value })} placeholder="Nuevo rubro" style={{ fontSize: 12 }} />
                      <input type="number" min="0" step="0.01" value={nuevoRubro.estimado} onChange={(e) => setNuevoRubro({ ...nuevoRubro, estimado: e.target.value })} placeholder="$/QQ" style={{ fontSize: 12 }} />
                      <input value={nuevoRubro.claves} onChange={(e) => setNuevoRubro({ ...nuevoRubro, claves: e.target.value })} placeholder="claves, separadas, por coma" style={{ fontSize: 12 }} />
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
