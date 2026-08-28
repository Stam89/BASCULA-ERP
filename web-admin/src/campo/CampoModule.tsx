// MÓDULO INDEPENDIENTE: Caja de Campo (cosechadora + transporte/fletes).
// V1 = solo captura. Autocontenido: su propio estado y llamadas a /campo/*.
// No depende de la lógica de piladora/ventas/fomentos. Se engancha en App.tsx
// con una entrada de sidebar y un único render.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { apiFetch, apiGet, apiPost, apiPut } from "../api";

// PATCH a la maquinaria (campo_activos): el endpoint es PATCH (no PUT).
async function patchMaquina(id: string, body: unknown): Promise<void> {
  const r = await apiFetch(`/campo/activos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "No se pudo actualizar la maquinaria");
}
import { money } from "../format";

// Menú propio de la operación Campo (contexto aislado). Para agregar secciones
// nuevas: añade una entrada aquí y su caso en CampoModule (prop `section`).
const CAMPO_SECCIONES: Array<{ id: CampoSeccion; label: string; icon: string }> = [
  { id: "caja", label: "Caja", icon: "💰" },
  { id: "servicios", label: "Servicios", icon: "🚜" },
  { id: "reportes", label: "Reportes", icon: "📊" },
  { id: "config", label: "Configuración", icon: "⚙️" }
];

// Maquinaria / flota (tabla campo_activos). `activo` bool = estado (Activo/Inactivo).
type TipoMaquina = "cosechadora" | "camion" | "vehiculo" | "transporte" | "otro";
type Activo = { id: string; nombre: string; tipo: TipoMaquina; placa_codigo: string | null; operador: string | null; activo: boolean };
const TIPOS_MAQUINA: Array<{ id: TipoMaquina; label: string }> = [
  { id: "cosechadora", label: "Cosechadora" },
  { id: "camion", label: "Camión" },
  { id: "vehiculo", label: "Vehículo" },
  { id: "otro", label: "Otro" }
];
const tipoLabel = (t: string) => TIPOS_MAQUINA.find((x) => x.id === t)?.label ?? (t === "transporte" ? "Transporte" : t);
type Categoria = { id: string; nombre: string };
type Cuenta = { id: string; nombre: string; saldo: number };
type Cliente = { id: string; nombre: string; tipo: "piladora" | "externo" };
type Servicio = {
  id: string; fecha: string; tipo: "cosecha" | "flete"; qq: number | null; precio_unitario: number | null;
  valor: number; cliente_nombre: string; activo_nombre: string; cobrado: number; saldo_pendiente: number;
  estado: "pendiente" | "abonado" | "pagado"; notas: string | null;
};

const hoy = () => new Date().toISOString().slice(0, 10);
// Secciones del menú propio de Campo (contexto aislado). Se amplía agregando
// entradas aquí y en CAMPO_SECCIONES (ver CampoWorkspace).
export type CampoSeccion = "caja" | "servicios" | "reportes" | "config";

// ── Tipos de los reportes (V2) ───────────────────────────────────────────────
type SaldoCaja = { corte: string; cuentas: Array<{ id: string; nombre: string; saldo: number }>; total: number };
type PorCobrarCliente = { cliente_id: string; cliente_nombre: string; servicios: number; saldo: number; antiguedad_max_dias: number; tramo: string };
type PorCobrarDetalle = { servicio_id: string; fecha: string; cliente_id: string; cliente_nombre: string; activo_nombre: string; tipo: string; valor: number; cobrado: number; saldo: number; antiguedad_dias: number; tramo: string };
type PorCobrar = { por_cliente: PorCobrarCliente[]; detalle: PorCobrarDetalle[]; por_tramo: Array<{ tramo: string; saldo: number; servicios: number }>; total_general: number };
type Maquina = { activo_id: string | null; activo_nombre: string; activo_tipo: string | null; ingresos: number; gastos: number; ganancia: number; gastos_por_categoria: Array<{ categoria: string; gasto: number }> };
type PorMaquina = { periodo: { desde: string; hasta: string }; maquinas: Maquina[] };

export default function CampoModule({ section = "caja", nombre, onNombreChange }: {
  section?: CampoSeccion; nombre?: string; onNombreChange?: (n: string) => void;
}) {
  const [flash, setFlash] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 3500); };

  const [activos, setActivos] = useState<Activo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [cajaTab, setCajaTab] = useState<"ingreso" | "egreso" | "transferencia">("ingreso");
  const [servTab, setServTab] = useState<"servicio" | "abono" | "lista">("servicio");
  const [libroVersion, setLibroVersion] = useState(0); // fuerza recarga del libro tras cada movimiento

  const refreshCatalogos = useCallback(async () => {
    const [a, cat, ct] = await Promise.all([
      apiGet<Activo[]>("/campo/activos"),
      apiGet<Categoria[]>("/campo/categorias-gasto"),
      apiGet<Cuenta[]>("/campo/cuentas")
    ]);
    setActivos(a); setCategorias(cat); setCuentas(ct);
  }, []);
  const refreshServicios = useCallback(async () => {
    setServicios(await apiGet<Servicio[]>("/campo/servicios"));
  }, []);

  useEffect(() => { Promise.all([refreshCatalogos(), refreshServicios()]).catch((e) => notify(e.message, "err")); }, [refreshCatalogos, refreshServicios]);

  const activosActivos = useMemo(() => activos.filter((a) => a.activo), [activos]);
  const pendientes = useMemo(() => servicios.filter((s) => s.estado !== "pagado"), [servicios]);
  const totalCuentas = useMemo(() => cuentas.reduce((s, c) => s + c.saldo, 0), [cuentas]);

  const flashEl = flash && (
    <p style={{ margin: "0 0 10px", padding: "8px 12px", borderRadius: 8, fontWeight: 600,
      background: flash.kind === "ok" ? "var(--c-success-bg)" : "var(--c-danger-bg)",
      color: flash.kind === "ok" ? "#15803d" : "#b91c1c" }}>{flash.text}</p>
  );
  // Tras registrar un movimiento de caja: refresca saldos + servicios + libro.
  const onCajaSaved = async (msg: string) => {
    await Promise.all([refreshCatalogos(), refreshServicios()]);
    setLibroVersion((v) => v + 1);
    notify(msg);
  };

  if (section === "reportes") {
    return <section className="panelGrid">{flashEl}<ReportesView onError={(m) => notify(m, "err")} /></section>;
  }

  if (section === "config") {
    return (
      <section className="panelGrid">
        {flashEl}
        <ConfigSection nombreActual={nombre ?? "Campo"}
          onSaved={(n) => { onNombreChange?.(n); notify(`Nombre de la operación actualizado a “${n}”`); }}
          onError={(m) => notify(m, "err")} />
        <FlotaMaquinaria activos={activos}
          onChanged={async (msg) => { await refreshCatalogos(); notify(msg); }}
          onError={(m) => notify(m, "err")} />
      </section>
    );
  }

  if (section === "servicios") {
    return (
      <section className="panelGrid">
        <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
          <h2 style={{ marginBottom: 2 }}>🚜 Servicios <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· cosecha y flete + abonos</span></h2>
          <nav className="cajaSubNav" style={{ borderBottom: "none" }}>
            {([["servicio", "➕ Nuevo servicio"], ["abono", "💵 Abono"], ["lista", "📋 Lista"]] as Array<["servicio" | "abono" | "lista", string]>).map(([v, label]) => (
              <button key={v} type="button" className={servTab === v ? "active" : ""} onClick={() => setServTab(v)}>{label}</button>
            ))}
          </nav>
          {flashEl}
        </div>
        {servTab === "servicio" && (
          <ServicioForm activos={activosActivos}
            onSaved={async () => { await refreshServicios(); notify("Servicio registrado"); }}
            onError={(m) => notify(m, "err")} />
        )}
        {servTab === "abono" && (
          <AbonoForm pendientes={pendientes} cuentas={cuentas}
            onSaved={() => onCajaSaved("Abono registrado")}
            onError={(m) => notify(m, "err")} />
        )}
        {servTab === "lista" && <ServiciosList servicios={servicios} />}
        {servTab === "servicio" && activosActivos.length === 0 && (
          <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
            <p className="muted" style={{ margin: 0 }}>No hay maquinaria activa. Da de alta cosechadoras/vehículos en <strong>⚙️ Configuración → 🚜 Flota y Maquinaria</strong> antes de registrar servicios.</p>
          </div>
        )}
      </section>
    );
  }

  // section === "caja"
  return (
    <section className="panelGrid">
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <h2 style={{ marginBottom: 2 }}>💰 Caja <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· ingresos, egresos y transferencias</span></h2>
        {/* Saldos por cuenta + total */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "6px 0 10px" }}>
          {cuentas.map((c) => (
            <div key={c.id} className="totalBox" style={{ minWidth: 120, margin: 0 }}>
              <span>{c.nombre}</span>
              <strong style={{ color: c.saldo >= 0 ? "#15803d" : "#b91c1c" }}>{money(c.saldo)}</strong>
              <small>saldo</small>
            </div>
          ))}
          <div className="totalBox" style={{ minWidth: 130, margin: 0, background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <span>TOTAL</span>
            <strong style={{ color: totalCuentas >= 0 ? "#15803d" : "#b91c1c" }}>{money(totalCuentas)}</strong>
          </div>
        </div>
        <nav className="cajaSubNav" style={{ borderBottom: "none" }}>
          {([["ingreso", "＋ Ingreso"], ["egreso", "－ Egreso"], ["transferencia", "⇄ Transferencia"]] as Array<["ingreso" | "egreso" | "transferencia", string]>).map(([v, label]) => (
            <button key={v} type="button" className={cajaTab === v ? "active" : ""} onClick={() => setCajaTab(v)}>{label}</button>
          ))}
        </nav>
        {flashEl}
      </div>

      {cajaTab === "ingreso" && (
        <IngresoForm cuentas={cuentas} pendientes={pendientes}
          onSaved={() => onCajaSaved("Ingreso registrado")} onError={(m) => notify(m, "err")} />
      )}
      {cajaTab === "egreso" && (
        <EgresoForm cuentas={cuentas} categorias={categorias} activos={activosActivos}
          onSaved={() => onCajaSaved("Egreso registrado")} onError={(m) => notify(m, "err")} />
      )}
      {cajaTab === "transferencia" && (
        <TransferenciaForm cuentas={cuentas}
          onSaved={() => onCajaSaved("Transferencia registrada")} onError={(m) => notify(m, "err")} />
      )}

      <LibroView cuentas={cuentas} version={libroVersion} onError={(m) => notify(m, "err")} />
    </section>
  );
}

// Lista de servicios (tabla) — extraída de la antigua vista "Listas".
function ServiciosList({ servicios }: { servicios: Servicio[] }) {
  return (
    <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
      <h2>Servicios <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({servicios.length})</span></h2>
      <div style={{ overflowX: "auto" }}>
        <table className="cajaTable" style={{ marginTop: 6 }}>
          <thead><tr><th>Fecha</th><th>Cliente</th><th>Activo</th><th>Tipo</th><th className="num">Valor</th><th className="num">Cobrado</th><th className="num">Saldo</th><th>Estado</th></tr></thead>
          <tbody>
            {servicios.length === 0 ? <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin servicios registrados.</td></tr>
              : servicios.map((s) => (
              <tr key={s.id}>
                <td style={{ whiteSpace: "nowrap" }}>{String(s.fecha).slice(0, 10)}</td>
                <td>{s.cliente_nombre}</td>
                <td>{s.activo_nombre}</td>
                <td>{s.tipo === "cosecha" ? "Cosecha" : "Flete"}</td>
                <td className="num">{money(s.valor)}</td>
                <td className="num">{money(s.cobrado)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{money(s.saldo_pendiente)}</td>
                <td><span className={s.estado === "pagado" ? "chip ok" : s.estado === "abonado" ? "chip warn" : "chip info"}>{s.estado}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Reportes de Campo (V2) ───────────────────────────────────────────────────
// Selector de período (mes o rango) arriba + 3 paneles. El saldo de caja usa la
// fecha de corte (fin del período). Todo sale de los endpoints /campo/reportes/*.
function ReportesView({ onError }: { onError: (m: string) => void }) {
  const [modo, setModo] = useState<"mes" | "rango">("mes");
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [desde, setDesde] = useState(hoy().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoy());
  const [saldo, setSaldo] = useState<SaldoCaja | null>(null);
  const [cobrar, setCobrar] = useState<PorCobrar | null>(null);
  const [maquinas, setMaquinas] = useState<PorMaquina | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

  // Rango efectivo del período: por mes (1º→último día) o por fechas.
  const periodo = useMemo(() => {
    if (modo === "mes") {
      const [y, m] = mes.split("-").map(Number);
      const ini = `${mes}-01`;
      const fin = new Date(y, m, 0).toISOString().slice(0, 10);
      return { desde: ini, hasta: fin };
    }
    return { desde, hasta };
  }, [modo, mes, desde, hasta]);

  const cargar = useCallback(async () => {
    try {
      const qsMaq = modo === "mes" ? `?mes=${mes}` : `?desde=${periodo.desde}&hasta=${periodo.hasta}`;
      const [s, c, mq] = await Promise.all([
        apiGet<SaldoCaja>(`/campo/reportes/saldo-caja?hasta=${periodo.hasta}`),
        apiGet<PorCobrar>("/campo/reportes/por-cobrar"),
        apiGet<PorMaquina>(`/campo/reportes/por-maquina${qsMaq}`)
      ]);
      setSaldo(s); setCobrar(c); setMaquinas(mq);
    } catch (e) { onError((e as Error).message); }
  }, [modo, mes, periodo.desde, periodo.hasta, onError]);

  useEffect(() => { cargar(); }, [cargar]);

  const num = (n: number) => money(Number(n) || 0);
  const rojoSiNeg = (n: number): CSSProperties => ({ color: n < 0 ? "#b91c1c" : undefined, fontWeight: 700 });
  // Totales de la tabla por máquina (suma de columnas para la fila de totales).
  const totMaq = useMemo(() => {
    const ms = maquinas?.maquinas ?? [];
    return {
      ingresos: ms.reduce((s, m) => s + m.ingresos, 0),
      gastos: ms.reduce((s, m) => s + m.gastos, 0),
      ganancia: ms.reduce((s, m) => s + m.ganancia, 0)
    };
  }, [maquinas]);

  return (
    <>
      {/* Selector de período */}
      <div className="tablePanel" style={{ gridColumn: "1 / -1", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className={modo === "mes" ? "chip" : "chip"} style={modo === "mes" ? { background: "#059669", color: "#fff" } : undefined} onClick={() => setModo("mes")}>Por mes</button>
          <button type="button" className="chip" style={modo === "rango" ? { background: "#059669", color: "#fff" } : undefined} onClick={() => setModo("rango")}>Por rango</button>
        </div>
        {modo === "mes" ? (
          <label style={{ margin: 0 }}><span>Mes</span><input type="month" value={mes} onChange={(e) => setMes(e.target.value)} /></label>
        ) : (
          <>
            <label style={{ margin: 0 }}><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label style={{ margin: 0 }}><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          </>
        )}
        <button type="button" onClick={() => cargar()}>↻ Actualizar</button>
        <span className="muted" style={{ fontSize: 12 }}>Saldo de caja a corte {periodo.hasta}. Por cobrar es siempre a hoy.</span>
      </div>

      {/* Panel 1 — Saldo de caja */}
      <div className="tablePanel">
        <h2>💰 Saldo de caja <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>a corte {saldo?.corte ?? "—"}</span></h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
          {(saldo?.cuentas ?? []).map((c) => (
            <div key={c.id} className="totalBox" style={{ minWidth: 120, margin: 0 }}>
              <span>{c.nombre}</span>
              <strong style={{ color: c.saldo >= 0 ? "#15803d" : "#b91c1c" }}>{num(c.saldo)}</strong>
            </div>
          ))}
          <div className="totalBox" style={{ minWidth: 120, margin: 0, background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <span>TOTAL</span>
            <strong style={{ color: (saldo?.total ?? 0) >= 0 ? "#15803d" : "#b91c1c" }}>{num(saldo?.total ?? 0)}</strong>
          </div>
        </div>
      </div>

      {/* Panel 2 — Cuentas por cobrar */}
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <h2>📥 Cuentas por cobrar <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· a hoy</span></h2>
        {/* Subtotales por tramo de antigüedad */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "6px 0 12px" }}>
          {(cobrar?.por_tramo ?? []).map((t) => (
            <div key={t.tramo} className="totalBox" style={{ minWidth: 110, margin: 0 }}>
              <span>{t.tramo} días</span>
              <strong>{num(t.saldo)}</strong>
              <small>{t.servicios} serv.</small>
            </div>
          ))}
          <div className="totalBox" style={{ minWidth: 130, margin: 0, background: "#fef3c7", borderColor: "#fde68a" }}>
            <span>TOTAL POR COBRAR</span>
            <strong style={{ color: "#b45309" }}>{num(cobrar?.total_general ?? 0)}</strong>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable">
            <thead><tr><th>Cliente</th><th className="num">Servicios</th><th className="num">Saldo</th><th className="num">Antigüedad</th><th>Tramo</th><th /></tr></thead>
            <tbody>
              {(cobrar?.por_cliente ?? []).length === 0 ? (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 14 }}>Nadie debe: sin saldos pendientes.</td></tr>
              ) : (cobrar?.por_cliente ?? []).map((c) => (
                <Fragment key={c.cliente_id}>
                  <tr>
                    <td style={{ fontWeight: 600 }}>{c.cliente_nombre}</td>
                    <td className="num">{c.servicios}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{num(c.saldo)}</td>
                    <td className="num">{c.antiguedad_max_dias} d</td>
                    <td><span className={c.tramo === "+90" ? "chip bad" : c.tramo === "61-90" ? "chip warn" : "chip info"}>{c.tramo}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="btnSecondary" onClick={() => setExpandido(expandido === c.cliente_id ? null : c.cliente_id)}>
                        {expandido === c.cliente_id ? "▲ Ocultar" : "▼ Detalle"}
                      </button>
                    </td>
                  </tr>
                  {expandido === c.cliente_id && (
                    <tr>
                      <td colSpan={6} style={{ background: "var(--c-surface-2)", padding: 8 }}>
                        <table className="cajaTable" style={{ margin: 0 }}>
                          <thead><tr><th>Fecha</th><th>Activo</th><th>Tipo</th><th className="num">Valor</th><th className="num">Cobrado</th><th className="num">Saldo</th><th className="num">Días</th><th>Tramo</th></tr></thead>
                          <tbody>
                            {(cobrar?.detalle ?? []).filter((d) => d.cliente_id === c.cliente_id).map((d) => (
                              <tr key={d.servicio_id}>
                                <td style={{ whiteSpace: "nowrap" }}>{String(d.fecha).slice(0, 10)}</td>
                                <td>{d.activo_nombre}</td>
                                <td>{d.tipo}</td>
                                <td className="num">{num(d.valor)}</td>
                                <td className="num">{num(d.cobrado)}</td>
                                <td className="num" style={{ fontWeight: 700 }}>{num(d.saldo)}</td>
                                <td className="num">{d.antiguedad_dias}</td>
                                <td><span className={d.tramo === "+90" ? "chip bad" : d.tramo === "61-90" ? "chip warn" : "chip info"}>{d.tramo}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Panel 3 — Por máquina y mes */}
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <h2>🚜 Por máquina <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {maquinas?.periodo.desde} a {maquinas?.periodo.hasta}</span></h2>
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable">
            <thead><tr><th>Máquina</th><th className="num">Ingresos</th><th>Gastos por categoría</th><th className="num">Gastos</th><th className="num">Ganancia</th></tr></thead>
            <tbody>
              {(maquinas?.maquinas ?? []).length === 0 ? (
                <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin movimientos en el período.</td></tr>
              ) : (maquinas?.maquinas ?? []).map((m) => (
                <tr key={m.activo_id ?? "SIN"} style={m.activo_id ? undefined : { fontStyle: "italic", background: "var(--c-surface-2)" }}>
                  <td style={{ fontWeight: 600 }}>{m.activo_nombre}{m.activo_tipo ? <small className="muted" style={{ display: "block" }}>{m.activo_tipo}</small> : null}</td>
                  <td className="num">{num(m.ingresos)}</td>
                  <td>{m.gastos_por_categoria.length === 0 ? <span className="muted">—</span> : m.gastos_por_categoria.map((g) => `${g.categoria} ${num(g.gasto)}`).join(" · ")}</td>
                  <td className="num">{num(m.gastos)}</td>
                  <td className="num" style={rojoSiNeg(m.ganancia)}>{num(m.ganancia)}</td>
                </tr>
              ))}
            </tbody>
            {(maquinas?.maquinas ?? []).length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}>
                  <td>TOTALES</td>
                  <td className="num">{num(totMaq.ingresos)}</td>
                  <td />
                  <td className="num">{num(totMaq.gastos)}</td>
                  <td className="num" style={rojoSiNeg(totMaq.ganancia)}>{num(totMaq.ganancia)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

// ── Nuevo movimiento de caja ─────────────────────────────────────────────────
type OnSaved = () => void | Promise<void>;

// ＋ INGRESO: entrada a una cuenta. Opcional: ligarlo a un servicio como abono
// (respeta el bloqueo de sobrepago 422 del backend).
function IngresoForm({ cuentas, pendientes, onSaved, onError }: {
  cuentas: Cuenta[]; pendientes: Servicio[]; onSaved: OnSaved; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ fecha: hoy(), cuenta_id: "", monto: "", concepto: "", servicio_id: "" });
  const [busy, setBusy] = useState(false);
  const svc = pendientes.find((s) => s.id === f.servicio_id);
  async function submit() {
    try {
      setBusy(true);
      if (!f.cuenta_id) throw new Error("Elige la cuenta");
      const monto = Number(f.monto);
      if (!(monto > 0)) throw new Error("Ingresa un monto válido");
      await apiPost("/campo/movimientos", {
        fecha: f.fecha, cuenta_id: f.cuenta_id, signo: "entrada", monto,
        concepto: f.concepto.trim() || (f.servicio_id ? "Abono de servicio" : undefined),
        servicio_id: f.servicio_id || undefined
      });
      setF({ ...f, monto: "", concepto: "", servicio_id: "" });
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>＋ Nuevo ingreso</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>Cuenta (entra a)</span>
          <select value={f.cuenta_id} onChange={(e) => setF({ ...f, cuenta_id: e.target.value })}>
            <option value="">Seleccione</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>
      <label><span>Monto $</span><input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" /></label>
      <label><span>Ligar a un servicio (opcional — cuenta como abono)</span>
        <select value={f.servicio_id} onChange={(e) => setF({ ...f, servicio_id: e.target.value })}>
          <option value="">(ingreso suelto, sin servicio)</option>
          {pendientes.map((s) => <option key={s.id} value={s.id}>{String(s.fecha).slice(0, 10)} · {s.cliente_nombre} · saldo {money(s.saldo_pendiente)}</option>)}
        </select>
      </label>
      {svc && <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>Saldo del servicio: <strong>{money(svc.saldo_pendiente)}</strong>. Un abono mayor al saldo se rechaza.</p>}
      <label><span>Concepto</span><input type="text" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} placeholder="Ej: Pago cosecha" /></label>
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar ingreso"}</button>
    </form>
  );
}

// － EGRESO: salida de una cuenta. Categoría OBLIGATORIA; activo opcional.
function EgresoForm({ cuentas, categorias, activos, onSaved, onError }: {
  cuentas: Cuenta[]; categorias: Categoria[]; activos: Activo[]; onSaved: OnSaved; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ fecha: hoy(), cuenta_id: "", monto: "", concepto: "", categoria_id: "", activo_id: "" });
  const [busy, setBusy] = useState(false);
  async function submit() {
    try {
      setBusy(true);
      if (!f.cuenta_id) throw new Error("Elige la cuenta");
      if (!f.categoria_id) throw new Error("La categoría del gasto es obligatoria");
      const monto = Number(f.monto);
      if (!(monto > 0)) throw new Error("Ingresa un monto válido");
      await apiPost("/campo/movimientos", {
        fecha: f.fecha, cuenta_id: f.cuenta_id, signo: "salida", monto,
        concepto: f.concepto.trim() || undefined, categoria_id: f.categoria_id, activo_id: f.activo_id || undefined
      });
      setF({ ...f, monto: "", concepto: "", categoria_id: "", activo_id: "" });
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>－ Nuevo egreso (gasto)</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>Cuenta (sale de)</span>
          <select value={f.cuenta_id} onChange={(e) => setF({ ...f, cuenta_id: e.target.value })}>
            <option value="">Seleccione</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Monto $</span><input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" /></label>
        <label><span>Categoría <span style={{ color: "#ef4444" }}>*</span></span>
          <select value={f.categoria_id} onChange={(e) => setF({ ...f, categoria_id: e.target.value })}>
            <option value="">Seleccione</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>
      <label><span>Concepto</span><input type="text" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} placeholder="Ej: Diésel cosechadora" /></label>
      <label><span>Asignar a Máquina / Vehículo (Opcional)</span>
        <select value={f.activo_id} onChange={(e) => setF({ ...f, activo_id: e.target.value })}>
          <option value="">(ninguna — irá a “SIN ASIGNAR”)</option>
          {activos.map((a) => <option key={a.id} value={a.id}>{a.nombre} · {tipoLabel(a.tipo)}{a.placa_codigo ? ` · ${a.placa_codigo}` : ""}</option>)}
        </select>
      </label>
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar egreso"}</button>
    </form>
  );
}

// ⇄ TRANSFERENCIA: mueve dinero entre dos cuentas (par de movimientos). NO es
// ingreso ni egreso real; sí cambia el saldo de cada cuenta.
function TransferenciaForm({ cuentas, onSaved, onError }: {
  cuentas: Cuenta[]; onSaved: OnSaved; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ fecha: hoy(), origen: "", destino: "", monto: "", concepto: "" });
  const [busy, setBusy] = useState(false);
  async function submit() {
    try {
      setBusy(true);
      if (!f.origen || !f.destino) throw new Error("Elige cuenta origen y destino");
      if (f.origen === f.destino) throw new Error("Origen y destino deben ser distintas");
      const monto = Number(f.monto);
      if (!(monto > 0)) throw new Error("Ingresa un monto válido");
      await apiPost("/campo/transferencias", {
        fecha: f.fecha, cuenta_origen_id: f.origen, cuenta_destino_id: f.destino, monto,
        concepto: f.concepto.trim() || undefined
      });
      setF({ ...f, monto: "", concepto: "" });
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>⇄ Transferencia entre cuentas</h2>
      <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>No cuenta como ingreso ni egreso en los reportes; solo mueve el saldo entre cuentas.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Cuenta origen</span>
          <select value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value })}>
            <option value="">Seleccione</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({money(c.saldo)})</option>)}
          </select>
        </label>
        <label><span>Cuenta destino</span>
          <select value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })}>
            <option value="">Seleccione</option>
            {cuentas.filter((c) => c.id !== f.origen).map((c) => <option key={c.id} value={c.id}>{c.nombre} ({money(c.saldo)})</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>Monto $</span><input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" /></label>
      </div>
      <label><span>Concepto</span><input type="text" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} placeholder="Ej: Depósito de caja a banco" /></label>
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar transferencia"}</button>
    </form>
  );
}

// LIBRO DE MOVIMIENTOS con SALDO CORRIDO. Filtros por cuenta y rango de fecha.
type LibroRow = { id: string; fecha: string; concepto: string | null; cuenta_nombre: string; categoria_nombre: string | null; activo_nombre: string | null; naturaleza: string; entrada: number; salida: number; saldo_corrido: number };
function LibroView({ cuentas, version, onError }: { cuentas: Cuenta[]; version: number; onError: (m: string) => void }) {
  const [filtro, setFiltro] = useState({ cuenta_id: "", from: "", to: "" });
  const [rows, setRows] = useState<LibroRow[]>([]);
  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (filtro.cuenta_id) qs.set("cuenta_id", filtro.cuenta_id);
      if (filtro.from) qs.set("from", filtro.from);
      if (filtro.to) qs.set("to", filtro.to);
      setRows(await apiGet<LibroRow[]>(`/campo/caja/libro?${qs.toString()}`));
    } catch (e) { onError((e as Error).message); }
  }, [filtro.cuenta_id, filtro.from, filtro.to, onError]);
  useEffect(() => { cargar(); }, [cargar, version]);

  return (
    <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>📒 Libro de movimientos</h2>
        <label style={{ margin: 0 }}><span>Cuenta</span>
          <select value={filtro.cuenta_id} onChange={(e) => setFiltro({ ...filtro, cuenta_id: e.target.value })}>
            <option value="">Todas</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label style={{ margin: 0 }}><span>Desde</span><input type="date" value={filtro.from} onChange={(e) => setFiltro({ ...filtro, from: e.target.value })} /></label>
        <label style={{ margin: 0 }}><span>Hasta</span><input type="date" value={filtro.to} onChange={(e) => setFiltro({ ...filtro, to: e.target.value })} /></label>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="cajaTable" style={{ marginTop: 8 }}>
          <thead><tr>
            <th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Cuenta</th>
            <th className="num">Entrada</th><th className="num">Salida</th><th className="num">Saldo</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin movimientos.</td></tr>
              : rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{String(r.fecha).slice(0, 10)}</td>
                <td>
                  {r.concepto || "—"}
                  {r.activo_nombre ? <span className="chip" style={{ marginLeft: 6, background: "#065f46", color: "#fff" }}>🚜 {r.activo_nombre}</span> : null}
                  {r.naturaleza === "transferencia" ? <span className="chip info" style={{ marginLeft: 6 }}>transfer.</span> : null}
                </td>
                <td>{r.categoria_nombre || "—"}</td>
                <td>{r.cuenta_nombre}</td>
                <td className="num" style={{ color: r.entrada > 0 ? "#15803d" : undefined }}>{r.entrada > 0 ? money(r.entrada) : "—"}</td>
                <td className="num" style={{ color: r.salida > 0 ? "#b91c1c" : undefined }}>{r.salida > 0 ? money(r.salida) : "—"}</td>
                <td className="num" style={{ fontWeight: 700, color: r.saldo_corrido < 0 ? "#b91c1c" : undefined }}>{money(r.saldo_corrido)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Saldo corrido acumulado por orden de fecha. Con una cuenta filtrada es el saldo de esa cuenta.</p>
    </div>
  );
}

// ⚙️ CONFIGURACIÓN: nombre editable de la operación.
function ConfigSection({ nombreActual, onSaved, onError }: {
  nombreActual: string; onSaved: (n: string) => void; onError: (m: string) => void;
}) {
  const [nombre, setNombre] = useState(nombreActual);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNombre(nombreActual); }, [nombreActual]);
  async function submit() {
    try {
      setBusy(true);
      const n = nombre.trim();
      if (n.length < 1) throw new Error("El nombre no puede estar vacío");
      const r = await apiPut<{ nombre_operacion: string }>("/campo/config", { nombre_operacion: n });
      onSaved(r.nombre_operacion);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ gridColumn: "1 / -1", maxWidth: 520 }}>
      <h2>⚙️ Configuración de la operación</h2>
      <p className="muted" style={{ marginTop: -4 }}>El nombre se refleja en el selector de operación, el título del sidebar y la barra superior.</p>
      <label><span>Nombre de la operación</span>
        <input type="text" maxLength={60} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Cosechadora & Fletes" />
      </label>
      <button className="primary" disabled={busy || nombre.trim() === nombreActual}>{busy ? "Guardando…" : "Guardar nombre"}</button>
    </form>
  );
}

// ── Nuevo servicio (cosecha / flete) con autocompletar cliente ───────────────
function ServicioForm({ activos, onSaved, onError }: {
  activos: Activo[]; onSaved: () => Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ fecha: hoy(), activo_id: "", tipo: "cosecha" as "cosecha" | "flete", qq: "", precio_unitario: "", valor: "", notas: "" });
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [busy, setBusy] = useState(false);

  const valorCalc = useMemo(() => {
    const qq = Number(f.qq), pu = Number(f.precio_unitario);
    return qq > 0 && pu > 0 ? Math.round(qq * pu * 100) / 100 : null;
  }, [f.qq, f.precio_unitario]);

  async function submit() {
    try {
      setBusy(true);
      if (!cliente) throw new Error("Elige o crea el cliente");
      if (!f.activo_id) throw new Error("Elige la cosechadora / transporte");
      const qq = f.qq ? Number(f.qq) : null;
      const pu = f.precio_unitario ? Number(f.precio_unitario) : null;
      const valorManual = f.valor ? Number(f.valor) : undefined;
      if (valorCalc == null && (valorManual == null || !(valorManual >= 0))) {
        throw new Error("Ingresa el valor, o el QQ y el precio unitario");
      }
      await apiPost("/campo/servicios", {
        fecha: f.fecha, cliente_id: cliente.id, activo_id: f.activo_id, tipo: f.tipo,
        qq: qq ?? undefined, precio_unitario: pu ?? undefined,
        valor: valorCalc == null ? valorManual : undefined,
        notas: f.notas.trim() || undefined
      });
      setF({ fecha: f.fecha, activo_id: f.activo_id, tipo: f.tipo, qq: "", precio_unitario: "", valor: "", notas: "" });
      setCliente(null);
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>🚜 Nuevo servicio</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>Tipo</span>
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as "cosecha" | "flete" })}>
            <option value="cosecha">Cosecha</option>
            <option value="flete">Flete</option>
          </select>
        </label>
      </div>
      <ClientePicker value={cliente} onChange={setCliente} onError={onError} />
      <label><span>Cosechadora / Transporte</span>
        <select value={f.activo_id} onChange={(e) => setF({ ...f, activo_id: e.target.value })}>
          <option value="">Seleccione</option>
          {activos.map((a) => <option key={a.id} value={a.id}>{a.nombre} · {a.tipo}</option>)}
        </select>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>QQ (opcional)</span><input type="number" step="0.01" min="0" value={f.qq} onChange={(e) => setF({ ...f, qq: e.target.value })} placeholder="Ej: 120" /></label>
        <label><span>Precio unitario (opcional)</span><input type="number" step="0.0001" min="0" value={f.precio_unitario} onChange={(e) => setF({ ...f, precio_unitario: e.target.value })} placeholder="Ej: 1.50" /></label>
      </div>
      {valorCalc != null ? (
        <div className="totalBox" style={{ background: "#eff6ff", borderColor: "#bfdbfe" }}>
          <span>VALOR (calculado = QQ × precio)</span>
          <strong>{money(valorCalc)}</strong>
        </div>
      ) : (
        <label><span>Valor del servicio $ <span style={{ color: "#ef4444" }}>*</span></span>
          <input type="number" step="0.01" min="0" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} placeholder="Ingresar a mano (flete varía)" />
        </label>
      )}
      <label><span>Notas (opcional)</span><input type="text" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></label>
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar servicio"}</button>
    </form>
  );
}

// ── Registrar abono a un servicio (movimiento entrada ligado) ────────────────
function AbonoForm({ pendientes, cuentas, onSaved, onError }: {
  pendientes: Servicio[]; cuentas: Cuenta[]; onSaved: () => Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ fecha: hoy(), servicio_id: "", cuenta_id: "", monto: "", concepto: "" });
  const [busy, setBusy] = useState(false);
  const svc = pendientes.find((s) => s.id === f.servicio_id) ?? null;

  async function submit() {
    try {
      setBusy(true);
      if (!f.servicio_id) throw new Error("Elige el servicio a cobrar");
      if (!f.cuenta_id) throw new Error("Elige la cuenta donde entra el dinero");
      const monto = Number(f.monto);
      if (!(monto > 0)) throw new Error("Ingresa un monto válido");
      await apiPost("/campo/movimientos", {
        fecha: f.fecha, cuenta_id: f.cuenta_id, signo: "entrada", monto,
        servicio_id: f.servicio_id, concepto: f.concepto.trim() || "Abono de servicio de campo"
      });
      setF({ fecha: f.fecha, servicio_id: "", cuenta_id: f.cuenta_id, monto: "", concepto: "" });
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>💵 Registrar abono a un servicio</h2>
      <label><span>Servicio pendiente</span>
        <select value={f.servicio_id} onChange={(e) => setF({ ...f, servicio_id: e.target.value })}>
          <option value="">Seleccione</option>
          {pendientes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fecha} · {s.cliente_nombre} · {money(s.valor)} (saldo {money(s.saldo_pendiente)})
            </option>
          ))}
        </select>
      </label>
      {svc && (
        <div className="totalBox">
          <span>SALDO PENDIENTE</span>
          <strong style={{ color: "#b91c1c" }}>{money(svc.saldo_pendiente)}</strong>
          <small>{svc.cliente_nombre} · valor {money(svc.valor)} · cobrado {money(svc.cobrado)}</small>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>Cuenta (entra a)</span>
          <select value={f.cuenta_id} onChange={(e) => setF({ ...f, cuenta_id: e.target.value })}>
            <option value="">Seleccione</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>
      <label><span>Monto del abono $</span>
        <input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" />
        {svc && <small className="muted" style={{ cursor: "pointer" }} onClick={() => setF({ ...f, monto: String(svc.saldo_pendiente) })}>› Cobrar todo el saldo ({money(svc.saldo_pendiente)})</small>}
      </label>
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar abono"}</button>
    </form>
  );
}

// ── Autocompletar cliente con alta rápida (como en ventas) ───────────────────
function ClientePicker({ value, onChange, onError }: {
  value: Cliente | null; onChange: (c: Cliente | null) => void; onError: (m: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Cliente[]>([]);
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<"piladora" | "externo">("externo");

  useEffect(() => {
    if (value) return;
    const t = setTimeout(() => {
      apiGet<Cliente[]>(`/campo/clientes?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, value]);

  async function crearRapido() {
    try {
      const nombre = q.trim();
      if (nombre.length < 2) throw new Error("Escribe el nombre del cliente");
      const c = await apiPost<Cliente>("/campo/clientes", { nombre, tipo });
      onChange(c); setOpen(false);
    } catch (e) { onError((e as Error).message); }
  }

  if (value) {
    return (
      <label><span>Cliente</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="text" readOnly value={`${value.nombre} · ${value.tipo}`} style={{ flex: 1 }} />
          <button type="button" className="btnSecondary" onClick={() => { onChange(null); setQ(""); }}>Cambiar</button>
        </div>
      </label>
    );
  }

  return (
    <label style={{ position: "relative" }}><span>Cliente</span>
      <input type="text" value={q} placeholder="🔍 Buscar o escribir para crear…"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && (
        <div style={{ border: "1px solid var(--c-border)", borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto", background: "var(--c-surface)" }}>
          {results.map((c) => (
            <div key={c.id} style={{ padding: "6px 10px", cursor: "pointer" }} onClick={() => { onChange(c); setOpen(false); }}>
              {c.nombre} <span className="muted">· {c.tipo}</span>
            </div>
          ))}
          {q.trim().length >= 2 && !results.some((c) => c.nombre.toLowerCase() === q.trim().toLowerCase()) && (
            <div style={{ padding: "8px 10px", borderTop: results.length ? "1px solid var(--c-border)" : "none", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as "piladora" | "externo")} style={{ width: "auto" }}>
                <option value="externo">externo</option>
                <option value="piladora">piladora</option>
              </select>
              <button type="button" className="primary" onClick={crearRapido}>➕ Crear “{q.trim()}”</button>
            </div>
          )}
          {results.length === 0 && q.trim().length < 2 && <div className="muted" style={{ padding: "8px 10px" }}>Escribe para buscar…</div>}
        </div>
      )}
    </label>
  );
}

// ── Gestión mínima de activos (cosechadora / transporte) ─────────────────────
// 🚜 FLOTA Y MAQUINARIA — CRUD de la maquinaria (campo_activos): alta, edición y
// archivar/activar. Los egresos y servicios se asignan a esta flota.
const flotaVacia = { nombre: "", tipo: "cosechadora" as TipoMaquina, placa_codigo: "", operador: "" };
function FlotaMaquinaria({ activos, onChanged, onError }: {
  activos: Activo[]; onChanged: (msg: string) => Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState(flotaVacia);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function editar(a: Activo) {
    setEditId(a.id);
    setF({ nombre: a.nombre, tipo: a.tipo, placa_codigo: a.placa_codigo ?? "", operador: a.operador ?? "" });
  }
  function cancelar() { setEditId(null); setF(flotaVacia); }

  async function guardar() {
    try {
      setBusy(true);
      if (f.nombre.trim().length < 2) throw new Error("Escribe el nombre / alias de la máquina");
      const payload = {
        nombre: f.nombre.trim(), tipo: f.tipo,
        placa_codigo: f.placa_codigo.trim() || null,
        operador: f.operador.trim() || null
      };
      if (editId) await patchMaquina(editId, payload);
      else await apiPost("/campo/activos", { ...payload, placa_codigo: payload.placa_codigo ?? undefined, operador: payload.operador ?? undefined });
      cancelar();
      await onChanged(editId ? "Maquinaria actualizada" : "Maquinaria agregada");
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  async function archivar(a: Activo) {
    try {
      await patchMaquina(a.id, { activo: !a.activo });
      if (editId === a.id) cancelar();
      await onChanged(a.activo ? "Maquinaria archivada" : "Maquinaria reactivada");
    } catch (e) { onError((e as Error).message); }
  }

  return (
    <div className="formPanel" style={{ gridColumn: "1 / -1" }}>
      <h2>🚜 Flota y Maquinaria</h2>
      <p className="muted" style={{ marginTop: -4 }}>Vehículos y cosechadoras de la empresa. Los egresos y servicios se asignan aquí.</p>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
        <label><span>Nombre / Alias</span><input type="text" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej: Cosechadora 1" /></label>
        <label><span>Tipo</span>
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoMaquina })}>
            {TIPOS_MAQUINA.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label><span>Placa / Código</span><input type="text" value={f.placa_codigo} onChange={(e) => setF({ ...f, placa_codigo: e.target.value })} placeholder="Ej: PBA-1234" /></label>
      </div>
      <label><span>Operador (opcional)</span><input type="text" value={f.operador} onChange={(e) => setF({ ...f, operador: e.target.value })} /></label>
      <div className="buttonRow">
        <button type="button" className="primary" onClick={guardar} disabled={busy}>{busy ? "Guardando…" : editId ? "Guardar cambios" : "➕ Agregar máquina"}</button>
        {editId && <button type="button" onClick={cancelar}>Cancelar</button>}
      </div>
      {activos.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table className="cajaTable">
            <thead><tr><th>Nombre / Alias</th><th>Tipo</th><th>Placa / Código</th><th>Operador</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {activos.map((a) => (
                <tr key={a.id} style={{ opacity: a.activo ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 600 }}>{a.nombre}</td>
                  <td>{tipoLabel(a.tipo)}</td>
                  <td>{a.placa_codigo || "—"}</td>
                  <td>{a.operador || "—"}</td>
                  <td><span className={a.activo ? "chip ok" : "chip bad"}>{a.activo ? "Activo" : "Inactivo"}</span></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="btnSecondary" style={{ marginRight: 6 }} onClick={() => editar(a)}>✏️ Editar</button>
                    <button type="button" className="btnSecondary" onClick={() => archivar(a)}>{a.activo ? "🗄️ Archivar" : "↩️ Activar"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Contexto AISLADO de Campo: layout propio (sidebar + menú Captura/Reportes) ──
// Se renderiza en lugar del layout estándar cuando la operación activa es Campo.
// El resto de operaciones (Planta/Matriz, socios) no se ven aquí.
export function CampoWorkspace({ operationSelector, userName, roleName, apiOnline, onLogout, nombre, onNombreChange }: {
  operationSelector: ReactNode;
  userName: string;
  roleName: string;
  apiOnline: boolean;
  onLogout: () => void;
  nombre: string;               // nombre editable de la operación (campo_config)
  onNombreChange: (n: string) => void;
}) {
  const [seccion, setSeccion] = useState<CampoSeccion>("caja");
  const activa = CAMPO_SECCIONES.find((s) => s.id === seccion) ?? CAMPO_SECCIONES[0];
  const iniciales = userName.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandMark">🚜</span>
          <div>
            <strong>{nombre}</strong>
            <small>Operación · CEYRO</small>
          </div>
        </div>
        {operationSelector}
        <nav>
          <div className="navSection" data-group="Campo">
            <button type="button" className="navLabel" style={{ cursor: "default" }}><span>{nombre}</span></button>
            {CAMPO_SECCIONES.map((s) => (
              <button key={s.id} className={seccion === s.id ? "active" : ""} onClick={() => setSeccion(s.id)}>
                <span style={{ width: 15, display: "inline-block", textAlign: "center" }}>{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </nav>
        <div className="sidebarFooter">
          <div className="userBox">
            <span className="userAvatar">{iniciales}</span>
            <div>
              <strong>{userName}</strong>
              <small>{(roleName ?? "usuario").toLowerCase()}</small>
            </div>
            <button className="logoutBtn" title="Cerrar sesión" onClick={onLogout}>⏻</button>
          </div>
          <span className={apiOnline ? "apiState on" : "apiState"}><i />API {apiOnline ? "conectada" : "sin conexión"}</span>
          <small>{nombre} · CEYRO</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbarLeft">
            <h1>{nombre} · {activa.label}</h1>
            <p>Operación de campo (cosechadora, transporte, fletes)</p>
          </div>
          <div className="topbarRight">
            <span className="topbarDate">{new Date().toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
            <span className={apiOnline ? "pill online" : "pill offline"}>API {apiOnline ? "conectada" : "sin conexión"}</span>
          </div>
        </header>
        <div className="content">
          <CampoModule section={seccion} nombre={nombre} onNombreChange={onNombreChange} />
        </div>
      </section>
    </main>
  );
}
