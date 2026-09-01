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
import PartesModule from "./PartesModule";

// Menú propio de la operación Campo (contexto aislado). Para agregar secciones
// nuevas: añade una entrada aquí y su caso en CampoModule (prop `section`).
const CAMPO_SECCIONES: Array<{ id: CampoSeccion; label: string; icon: string }> = [
  { id: "caja", label: "Caja", icon: "💰" },
  { id: "servicios", label: "Servicios", icon: "🚜" },
  { id: "clientes", label: "Clientes", icon: "👥" },
  { id: "vales", label: "Vales", icon: "📋" },
  { id: "partes", label: "Partes Diarios", icon: "📝" },
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
export type CampoSeccion = "caja" | "servicios" | "clientes" | "vales" | "partes" | "reportes" | "config";

// Parte Diario pendiente (para importar/liquidar desde el form de servicio).
type PartePendiente = { id: string; fecha: string; activo_id: string; activo_nombre: string; operador: string | null; cliente: string; qq: number };

// Sesión de caja (apertura/arqueo/cierre).
type ArqueoResumen = { saldo_inicial: number; ingresos: number; egresos: number; saldo_teorico: number };
type SesionActiva = { id: string; usuario_nombre: string | null; fecha_apertura: string; saldo_inicial: number; observaciones: string | null; arqueo: ArqueoResumen };
type SesionResp = { activa: SesionActiva | null; saldo_sugerido: number };
type SesionHist = { id: string; fecha_apertura: string; fecha_cierre: string | null; saldo_inicial: number; saldo_teorico: number | null; saldo_real: number | null; diferencia: number | null; estado: "ABIERTA" | "CERRADA"; observaciones: string | null; usuario_nombre: string | null };

// Estado de cuenta de clientes (Campo).
type ClienteCuenta = { id: string; nombre: string; identificacion: string | null; telefono: string | null; tipo: string; debe: number; haber: number; saldo: number; servicios: number };
// Crédito a favor por fletes retenidos en liquidaciones (cruce Planta→Campo).
type CreditoConcil = { cliente_id: string; cliente_nombre: string; credito: number; partes_pendientes: number };
// Parte pendiente para el modal de conversión (subset de /campo/partes).
type ParteConcil = { id: string; fecha: string; activo_nombre: string; cliente: string; qq: number; observaciones: string | null; origen: string; estado: string };
type EstadoLinea = { fecha: string; clase: "servicio" | "abono"; detalle: string; maquina: string | null; qq: number | null; precio_unitario: number | null; debe: number; haber: number; cuenta: string | null; saldo: number };
type EstadoCuenta = { cliente: { id: string; nombre: string; identificacion: string | null; tipo: string }; periodo: { from: string; to: string }; saldo_apertura: number; lineas: EstadoLinea[]; total_debe: number; total_haber: number; saldo_final: number };

// Estandarización de mantenimientos: para egresos de REPARACION_MANT el Concepto
// se arma con dos selects (Pieza + Acción) que se concatenan "Pieza - Acción".
const REPARACION_MANT = "REPARACION_MANT"; // nombre de la categoría gatillo (semilla)
const ACCIONES_MANT: string[] = [
  "Cambio / Reemplazo",
  "Reparación / Soldadura / Relleno",
  "Ajuste / Tensionado",
  "Mantenimiento / Engrase"
];
const PIEZAS_MANT: Array<{ grupo: string; items: string[] }> = [
  { grupo: "Cabezal y Acarreador", items: [
    "Cuchillas de corte", "Puntones / Mandíbulas", "Púas / Dedos del molinete",
    "Sinfín de alimentación", "Cadenas y paletas del acarreador"
  ] },
  { grupo: "Sistema de Trilla y Limpieza", items: [
    "Dientes / Muelas del rotor", "Cóncavo (rejilla de trilla)", "Zarandas / Cribas de limpieza",
    "Correas y poleas del ventilador", "Cadenas y cangilones del elevador de grano"
  ] },
  { grupo: "Tren de Rodaje (Orugas)", items: [
    "Orugas de goma (bandas)", "Rodillos inferiores / superiores",
    "Rueda motriz (Catalina)", "Rueda tensora (Idler)"
  ] },
  { grupo: "Motor, Hidráulico y Descarga", items: [
    "Filtros (aceite, diésel, aire)", "Mangueras y acoples hidráulicos", "Bomba hidrostática (HST)",
    "Radiador y mangueras", "Sinfín interno del tubo de descarga"
  ] },
  { grupo: "Motor y Combustible (Vehículos)", items: [
    "Filtros (aceite, aire, diésel)", "Inyectores y bomba", "Bandas/correas de accesorios", "Mangueras y turbo"
  ] },
  { grupo: "Frenos (Vehículos)", items: [
    "Pastillas, bandas y zapatas", "Discos y tambores", "Cilindros o válvulas de aire"
  ] },
  { grupo: "Suspensión y Dirección", items: [
    "Llantas / Neumáticos", "Amortiguadores y ballestas", "Rótulas y terminales", "Rodamientos/rulimanes de bocín"
  ] },
  { grupo: "Transmisión (Vehículos)", items: [
    "Kit de embrague", "Crucetas y cardán", "Juntas y retenes", "Aceite de caja y diferencial"
  ] },
  { grupo: "Eléctrico y Climatización", items: [
    "Alternador y motor de arranque", "Faros y bombillos", "Sensores y cableado", "Compresor y gas A/C"
  ] },
  { grupo: "Carrocería y Estructura", items: [
    "Parabrisas y plumas", "Cerraduras y elevavidrios", "Soldadura de chasis o cajón"
  ] }
];

// Conceptos predefinidos para el INGRESO (select con optgroups). El usuario puede
// elegir uno y agregarle un detalle extra, o escribir el concepto a mano.
const CONCEPTOS_INGRESO: Array<{ grupo: string; items: string[] }> = [
  { grupo: "Servicios Agrícolas", items: [
    "Pago por servicio de cosecha", "Abono por servicio de cosecha"
  ] },
  { grupo: "Transporte", items: [
    "Pago por flete / transporte", "Abono por flete"
  ] },
  { grupo: "Otros Ingresos", items: [
    "Venta de chatarra/repuestos", "Devolución de proveedor", "Aporte de socio"
  ] }
];

// Opción por defecto del selector de máquina en el egreso: gasto general/admin
// (se guarda como activo_id nulo → fila "Gastos Generales / Administración").
const ACTIVO_GENERAL = "GENERAL";

// Operador (catálogo para Partes Diarios).
type Operador = { id: string; nombre: string; identificacion: string | null; telefono: string | null; activo: boolean };

// Vale / anticipo por rendir (egreso con estado). entregado = monto del vale.
type Vale = {
  id: string; fecha: string; entregado: number; monto_rendido: number | null;
  concepto: string | null; estado: "PENDIENTE_RENDICION" | "LIQUIDADO";
  cuenta_nombre: string; categoria_nombre: string | null; activo_nombre: string | null;
};

// ── Tipos de los reportes (V2) ───────────────────────────────────────────────
type SaldoCaja = { corte: string; cuentas: Array<{ id: string; nombre: string; saldo: number }>; total: number };
type PorCobrarCliente = { cliente_id: string; cliente_nombre: string; servicios: number; saldo: number; antiguedad_max_dias: number; tramo: string };
type PorCobrarDetalle = { servicio_id: string; fecha: string; cliente_id: string; cliente_nombre: string; activo_nombre: string; tipo: string; valor: number; cobrado: number; saldo: number; antiguedad_dias: number; tramo: string };
type PorCobrar = { por_cliente: PorCobrarCliente[]; detalle: PorCobrarDetalle[]; por_tramo: Array<{ tramo: string; saldo: number; servicios: number }>; total_general: number };
type Maquina = { activo_id: string | null; activo_nombre: string; activo_tipo: string | null; ingresos: number; gastos: number; ganancia: number; qq: number; gastos_por_categoria: Array<{ categoria: string; gasto: number }> };
type PorMaquina = { periodo: { desde: string; hasta: string }; maquinas: Maquina[] };

export default function CampoModule({ section = "caja", nombre, onNombreChange }: {
  section?: CampoSeccion; nombre?: string; onNombreChange?: (n: string) => void;
}) {
  const [flash, setFlash] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 3500); };

  const [activos, setActivos] = useState<Activo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [cajaTab, setCajaTab] = useState<"ingreso" | "egreso" | "transferencia" | "cierres">("ingreso");
  const [sesion, setSesion] = useState<SesionResp | null>(null);
  const [modalCaja, setModalCaja] = useState<"" | "abrir" | "cerrar">("");
  const refreshSesion = useCallback(async () => {
    try { setSesion(await apiGet<SesionResp>("/campo/caja/sesion-activa")); } catch { /* opcional */ }
  }, []);
  const [servTab, setServTab] = useState<"servicio" | "abono" | "lista">("servicio");
  const [libroVersion, setLibroVersion] = useState(0); // fuerza recarga del libro tras cada movimiento

  const refreshCatalogos = useCallback(async () => {
    const [a, cat, ct, op] = await Promise.all([
      apiGet<Activo[]>("/campo/activos"),
      apiGet<Categoria[]>("/campo/categorias-gasto"),
      apiGet<Cuenta[]>("/campo/cuentas"),
      apiGet<Operador[]>("/campo/operadores")
    ]);
    setActivos(a); setCategorias(cat); setCuentas(ct); setOperadores(op);
  }, []);
  const refreshServicios = useCallback(async () => {
    setServicios(await apiGet<Servicio[]>("/campo/servicios"));
  }, []);

  useEffect(() => { Promise.all([refreshCatalogos(), refreshServicios(), refreshSesion()]).catch((e) => notify(e.message, "err")); }, [refreshCatalogos, refreshServicios, refreshSesion]);

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
    await Promise.all([refreshCatalogos(), refreshServicios(), refreshSesion()]);
    setLibroVersion((v) => v + 1);
    notify(msg);
  };

  if (section === "reportes") {
    return <section className="panelGrid">{flashEl}<ReportesView onError={(m) => notify(m, "err")} /></section>;
  }

  if (section === "clientes") {
    return <section className="panelGrid">{flashEl}<ClientesView nombreOperacion={nombre ?? "Campo"} onNotify={notify} onError={(m) => notify(m, "err")} /></section>;
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
        <OperadoresCatalogo operadores={operadores}
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

  if (section === "vales") {
    return (
      <section className="panelGrid">
        {flashEl}
        <ValesPanel onLiquidated={() => onCajaSaved("Vale liquidado")} onError={(m) => notify(m, "err")} />
      </section>
    );
  }

  if (section === "partes") {
    return <PartesModule />;
  }

  // section === "caja"
  const cajaAbierta = !!sesion?.activa;
  return (
    <section className="panelGrid">
      {/* Barra de estado de la sesión de caja */}
      <div className="tablePanel" style={{ gridColumn: "1 / -1", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
        background: cajaAbierta ? "var(--c-success-bg)" : "var(--c-danger-bg)" }}>
        {cajaAbierta ? (
          <>
            <strong style={{ color: "#15803d" }}>🟢 Caja Abierta</strong>
            <span className="muted">por {sesion!.activa!.usuario_nombre ?? "—"} · Saldo Inicial: <strong>{money(sesion!.activa!.saldo_inicial)}</strong> · abierta {new Date(sesion!.activa!.fecha_apertura).toLocaleString("es-EC")}</span>
            <button type="button" className="primary" style={{ marginLeft: "auto" }} onClick={() => setModalCaja("cerrar")}>🔒 Cerrar / Arquear Caja</button>
          </>
        ) : (
          <>
            <strong style={{ color: "#b91c1c" }}>🔴 Caja Cerrada</strong>
            <span className="muted">Debes abrir caja para registrar ingresos/egresos en CAJA.</span>
            <button type="button" className="primary" style={{ marginLeft: "auto" }} onClick={() => setModalCaja("abrir")}>🔓 Abrir Caja</button>
          </>
        )}
      </div>

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
          {([["ingreso", "＋ Ingreso"], ["egreso", "－ Egreso"], ["transferencia", "⇄ Transferencia"], ["cierres", "📋 Cierres de Caja"]] as Array<["ingreso" | "egreso" | "transferencia" | "cierres", string]>).map(([v, label]) => (
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
      {cajaTab === "cierres" && <CierresCajaView />}

      {cajaTab !== "cierres" && <LibroView cuentas={cuentas} version={libroVersion} onError={(m) => notify(m, "err")} />}

      {modalCaja === "abrir" && (
        <AperturaCajaModal saldoSugerido={sesion?.saldo_sugerido ?? 0}
          onClose={() => setModalCaja("")}
          onDone={async () => { setModalCaja(""); await refreshSesion(); notify("Caja abierta"); }}
          onError={(m) => notify(m, "err")} />
      )}
      {modalCaja === "cerrar" && (
        <CierreCajaModal
          onClose={() => setModalCaja("")}
          onDone={async (msg) => { setModalCaja(""); await Promise.all([refreshSesion(), refreshCatalogos()]); setLibroVersion((v) => v + 1); notify(msg); }}
          onError={(m) => notify(m, "err")} />
      )}
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
      ganancia: ms.reduce((s, m) => s + m.ganancia, 0),
      qq: ms.reduce((s, m) => s + (m.qq ?? 0), 0)
    };
  }, [maquinas]);
  const qqFmt = (n: number) => (Number(n) || 0).toLocaleString("es-EC", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

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
            <thead><tr><th>Máquina</th><th className="num">QQ trab.</th><th className="num">Ingresos</th><th>Gastos por categoría</th><th className="num">Gastos</th><th className="num">Ganancia</th></tr></thead>
            <tbody>
              {(maquinas?.maquinas ?? []).length === 0 ? (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin movimientos en el período.</td></tr>
              ) : (maquinas?.maquinas ?? []).map((m) => (
                <tr key={m.activo_id ?? "SIN"} style={m.activo_id ? undefined : { fontStyle: "italic", background: "var(--c-surface-2)" }}>
                  <td style={{ fontWeight: 600 }}>{m.activo_nombre}{m.activo_tipo ? <small className="muted" style={{ display: "block" }}>{m.activo_tipo}</small> : null}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{qqFmt(m.qq)}</td>
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
                  <td className="num">{qqFmt(totMaq.qq)}</td>
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

// ── 👥 CLIENTES · Estado de Cuenta (Campo) ───────────────────────────────────
// Lista de clientes con saldo (debe−haber) + buscador y filtro de estado. Al
// elegir uno, abre su Estado de Cuenta (línea de tiempo Debe/Haber/Saldo) con
// rango de fecha y ficha imprimible. El saldo se deriva en vivo, así que los
// ajustes de tarifa / des-cobros de Campo se reflejan al recargar.
async function patchCliente(id: string, body: unknown): Promise<void> {
  const r = await apiFetch(`/campo/clientes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "No se pudo actualizar el cliente");
}
function ClientesView({ nombreOperacion, onNotify, onError }: {
  nombreOperacion: string; onNotify: (m: string, k?: "ok" | "err") => void; onError: (m: string) => void;
}) {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<"" | "al_dia" | "pendiente">("");
  const [data, setData] = useState<{ clientes: ClienteCuenta[]; total_pendiente: number } | null>(null);
  const [verCuenta, setVerCuenta] = useState<ClienteCuenta | null>(null);
  const [editar, setEditar] = useState<ClienteCuenta | null>(null);
  const [nuevo, setNuevo] = useState(false);
  // Conciliación / cruce de fletes: créditos a favor por cliente-piladora.
  const [creditos, setCreditos] = useState<CreditoConcil[]>([]);
  const [conciliar, setConciliar] = useState<CreditoConcil | null>(null);

  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      if (estado) qs.set("estado", estado);
      const [ec, cr] = await Promise.all([
        apiGet<{ clientes: ClienteCuenta[]; total_pendiente: number }>(`/campo/clientes/estado-cuenta?${qs.toString()}`),
        apiGet<{ creditos: CreditoConcil[]; total_credito: number }>("/campo/conciliacion/creditos").catch(() => ({ creditos: [], total_credito: 0 }))
      ]);
      setData(ec);
      setCreditos(cr.creditos);
    } catch (e) { onError((e as Error).message); }
  }, [q, estado, onError]);
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);
  const creditoDe = (cid: string) => creditos.find((x) => x.cliente_id === cid) ?? null;

  const clientes = data?.clientes ?? [];
  return (
    <>
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>👥 Clientes <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· estado de cuenta</span></h2>
          <button type="button" className="primary" onClick={() => setNuevo(true)}>＋ Nuevo Cliente</button>
          <div className="totalBox" style={{ minWidth: 170, margin: 0, marginLeft: "auto", background: "#fef3c7", borderColor: "#fde68a" }}>
            <span>TOTAL POR COBRAR</span>
            <strong style={{ color: "#b45309" }}>{money(data?.total_pendiente ?? 0)}</strong>
          </div>
        </div>
        {creditos.length > 0 && (
          <div style={{ marginTop: 10, padding: "10px 12px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8 }}>
            <strong style={{ color: "#1d4ed8" }}>⚡ Conciliación de fletes</strong>
            <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
              {creditos.length} cliente(s) con crédito a favor por fletes retenidos en liquidaciones. Convierte sus partes pendientes a servicio y aplica el crédito.
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {creditos.map((cr) => (
                <button key={cr.cliente_id} type="button" className="btnSecondary"
                  onClick={() => setConciliar(cr)}
                  style={{ borderColor: "#93c5fd" }}
                  title={`${cr.partes_pendientes} parte(s) pendiente(s)`}>
                  {cr.cliente_nombre}: <strong style={{ color: "#1d4ed8" }}>{money(cr.credito)}</strong>
                  {cr.partes_pendientes > 0 && <span className="muted"> · {cr.partes_pendientes} parte(s)</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <label style={{ margin: 0, flex: "1 1 240px" }}><span>Buscar (nombre o identificación)</span>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Ej: Juan / 0912345678" />
          </label>
          <label style={{ margin: 0 }}><span>Estado</span>
            <select value={estado} onChange={(e) => setEstado(e.target.value as "" | "al_dia" | "pendiente")}>
              <option value="">Todos</option>
              <option value="pendiente">Con saldo pendiente</option>
              <option value="al_dia">Al día</option>
            </select>
          </label>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable" style={{ marginTop: 8 }}>
            <thead><tr>
              <th>Cliente</th><th>Identificación</th><th className="num">Servicios</th>
              <th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo</th><th>Acciones</th>
            </tr></thead>
            <tbody>
              {clientes.length === 0 ? (
                <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin clientes.</td></tr>
              ) : clientes.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.nombre}<small className="muted" style={{ display: "block" }}>{c.tipo}</small></td>
                  <td>{c.identificacion || "—"}</td>
                  <td className="num">{c.servicios}</td>
                  <td className="num">{money(c.debe)}</td>
                  <td className="num" style={{ color: "#15803d" }}>{money(c.haber)}</td>
                  <td className="num" style={{ fontWeight: 700, color: c.saldo > 0.005 ? "#b45309" : "#15803d" }}>{money(c.saldo)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {creditoDe(c.id) && (
                        <button type="button" className="btnSecondary" style={{ borderColor: "#93c5fd", color: "#1d4ed8" }}
                          onClick={() => setConciliar(creditoDe(c.id)!)}
                          title={`Crédito a favor ${money(creditoDe(c.id)!.credito)} · ${creditoDe(c.id)!.partes_pendientes} parte(s) pendiente(s)`}>
                          ⚡ Convertir parte y aplicar crédito
                        </button>
                      )}
                      <button type="button" className="btnSecondary" onClick={() => setVerCuenta(c)}>📄 Estado de cuenta</button>
                      <button type="button" className="btnSecondary" onClick={() => setEditar(c)}>✏️ Editar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Debe = servicios de cosecha/flete · Haber = abonos en Caja · Saldo = pendiente por cobrar (histórico, en vivo).</p>
      </div>

      {verCuenta && (
        <EstadoCuentaModal cliente={verCuenta} nombreOperacion={nombreOperacion}
          onClose={() => setVerCuenta(null)} onError={onError} />
      )}
      {editar && (
        <EditarClienteModal cliente={editar}
          onClose={() => setEditar(null)}
          onDone={async () => { setEditar(null); await cargar(); onNotify("Cliente actualizado"); }}
          onError={onError} />
      )}
      {conciliar && (
        <ConvertirAplicarModal credito={conciliar}
          onClose={() => setConciliar(null)}
          onDone={async (msg) => { setConciliar(null); await cargar(); onNotify(msg); }}
          onError={onError} />
      )}
      {nuevo && (
        <NuevoClienteModal
          onClose={() => setNuevo(false)}
          onDone={async () => { setNuevo(false); await cargar(); onNotify("Cliente creado"); }}
          onError={onError} />
      )}
    </>
  );
}

// Modal: crear un nuevo cliente (nombre obligatorio; identificación y teléfono
// opcionales). POST a /campo/clientes; el alta rápida reutiliza si el nombre ya existe.
function NuevoClienteModal({ onClose, onDone, onError }: {
  onClose: () => void; onDone: () => void | Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ nombre: "", identificacion: "", telefono: "", tipo: "externo" as "piladora" | "externo" });
  const [busy, setBusy] = useState(false);
  async function submit() {
    try {
      setBusy(true);
      if (f.nombre.trim().length < 2) throw new Error("Escribe el nombre / razón social");
      await apiPost("/campo/clientes", {
        nombre: f.nombre.trim(), tipo: f.tipo,
        identificacion: f.identificacion.trim() || undefined,
        telefono: f.telefono.trim() || undefined
      });
      await onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ maxWidth: 440, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>＋ Nuevo cliente</h2>
        <label><span>Nombre / Razón social <span style={{ color: "#ef4444" }}>*</span></span>
          <input type="text" autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej: Juan Piguave" />
        </label>
        <label><span>Identificación / RUC / Cédula (opcional)</span>
          <input type="text" value={f.identificacion} onChange={(e) => setF({ ...f, identificacion: e.target.value })} placeholder="Ej: 0912345678" />
        </label>
        <label><span>Teléfono (opcional)</span>
          <input type="text" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} placeholder="Ej: 0991234567" />
        </label>
        <label><span>Tipo</span>
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as "piladora" | "externo" })}>
            <option value="externo">externo</option>
            <option value="piladora">piladora</option>
          </select>
        </label>
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Crear cliente"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

// Modal: convertir un Parte Diario a Servicio y aplicar el crédito a favor del
// cliente (cruce de fletes). Elige el parte, fija la tarifa y confirma el crédito.
function ConvertirAplicarModal({ credito, onClose, onDone, onError }: {
  credito: CreditoConcil;
  onClose: () => void; onDone: (msg: string) => void | Promise<void>; onError: (m: string) => void;
}) {
  const [partes, setPartes] = useState<ParteConcil[] | null>(null);
  const [parteId, setParteId] = useState("");
  const [modo, setModo] = useState<"precio" | "valor">("precio");
  const [precio, setPrecio] = useState("");
  const [valorFijo, setValorFijo] = useState("");
  const [aplicar, setAplicar] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<ParteConcil[]>("/campo/partes?estado=por_cobrar")
      .then((rows) => {
        const nombre = credito.cliente_nombre.trim().toLowerCase();
        setPartes(rows.filter((p) => (p.cliente ?? "").trim().toLowerCase() === nombre));
      })
      .catch((e) => { onError((e as Error).message); setPartes([]); });
  }, [credito.cliente_nombre, onError]);

  const parte = partes?.find((p) => p.id === parteId) ?? null;
  const valor = modo === "precio"
    ? Math.round((Number(parte?.qq ?? 0) * Number(precio || 0)) * 100) / 100
    : Math.round(Number(valorFijo || 0) * 100) / 100;
  // Por defecto se aplica el máximo posible (min entre crédito y valor del servicio).
  const aplicarDefault = Math.min(credito.credito, valor);
  const aplicarReal = aplicar.trim() ? Math.min(Number(aplicar || 0), credito.credito, valor) : aplicarDefault;
  const saldoRestante = Math.max(0, Math.round((valor - aplicarReal) * 100) / 100);
  const creditoRestante = Math.max(0, Math.round((credito.credito - aplicarReal) * 100) / 100);

  async function submit() {
    try {
      setBusy(true);
      if (!parteId) throw new Error("Elige el parte a convertir");
      if (!(valor > 0)) throw new Error("Indica la tarifa del flete (precio por QQ o valor cerrado)");
      const body: Record<string, unknown> = { parte_id: parteId, cliente_id: credito.cliente_id };
      if (modo === "precio") body.precio_unitario = Number(precio);
      else body.valor = Number(valorFijo);
      if (aplicar.trim()) body.aplicar_credito = Number(aplicar);
      const r = await apiPost<{ aplicado: number; credito_restante: number; saldo_servicio: number }>(
        "/campo/conciliacion/convertir-y-aplicar", body
      );
      await onDone(`Parte convertido · aplicado ${money(r.aplicado)} de crédito · saldo del servicio ${money(r.saldo_servicio)}`);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ maxWidth: 480, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>⚡ Convertir parte y aplicar crédito</h2>
        <div style={{ padding: "8px 12px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, marginBottom: 10 }}>
          <strong>{credito.cliente_nombre}</strong>
          <span style={{ marginLeft: 8 }}>Crédito a favor disponible: <strong style={{ color: "#1d4ed8" }}>{money(credito.credito)}</strong></span>
        </div>

        <label><span>Parte Diario a convertir <span style={{ color: "#ef4444" }}>*</span></span>
          <select autoFocus value={parteId} onChange={(e) => setParteId(e.target.value)}>
            <option value="">{partes === null ? "Cargando…" : partes.length ? "— seleccionar parte —" : "Sin partes pendientes de este cliente"}</option>
            {(partes ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {String(p.fecha).slice(0, 10)} · {p.activo_nombre} · {p.qq.toFixed(2)} QQ{p.origen === "bascula" ? " · ⚖️ Báscula" : ""}
              </option>
            ))}
          </select>
        </label>

        <label><span>Tarifa del flete</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={modo} onChange={(e) => setModo(e.target.value as "precio" | "valor")} style={{ flex: "0 0 auto" }}>
              <option value="precio">$ por QQ</option>
              <option value="valor">Valor cerrado</option>
            </select>
            {modo === "precio" ? (
              <input type="number" step="0.0001" min="0" placeholder="Precio/QQ" value={precio} onChange={(e) => setPrecio(e.target.value)} />
            ) : (
              <input type="number" step="0.01" min="0" placeholder="Valor $" value={valorFijo} onChange={(e) => setValorFijo(e.target.value)} />
            )}
          </div>
        </label>

        <label><span>Crédito a aplicar (por defecto el máximo)</span>
          <input type="number" step="0.01" min="0" placeholder={aplicarDefault.toFixed(2)} value={aplicar} onChange={(e) => setAplicar(e.target.value)} />
        </label>

        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Valor del servicio</span><strong>{money(valor)}</strong></div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#1d4ed8" }}><span>Crédito a aplicar</span><strong>-{money(aplicarReal)}</strong></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}><span>Saldo del servicio</span><span style={{ color: saldoRestante > 0.005 ? "#b45309" : "#15803d" }}>{money(saldoRestante)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b" }}><span>Crédito restante</span><span>{money(creditoRestante)}</span></div>
        </div>

        <div className="buttonRow" style={{ marginTop: 12 }}>
          <button type="submit" className="primary" disabled={busy || !parteId || !(valor > 0)}>{busy ? "Procesando…" : "⚡ Convertir y aplicar"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

// Modal: ficha de Estado de Cuenta con rango de fecha, línea de tiempo y impresión.
function EstadoCuentaModal({ cliente, nombreOperacion, onClose, onError }: {
  cliente: ClienteCuenta; nombreOperacion: string; onClose: () => void; onError: (m: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ec, setEc] = useState<EstadoCuenta | null>(null);
  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      setEc(await apiGet<EstadoCuenta>(`/campo/clientes/${cliente.id}/estado-cuenta?${qs.toString()}`));
    } catch (e) { onError((e as Error).message); }
  }, [cliente.id, from, to, onError]);
  useEffect(() => { cargar(); }, [cargar]);

  function imprimir() {
    if (!ec) return;
    const filas = ec.lineas.map((l) => `<tr>
      <td>${String(l.fecha).slice(0, 10)}</td>
      <td>${l.detalle}${l.cuenta ? ` (${l.cuenta})` : ""}</td>
      <td>${l.maquina ?? ""}</td>
      <td style="text-align:right">${l.qq != null ? l.qq : ""}</td>
      <td style="text-align:right">${l.debe ? l.debe.toFixed(2) : ""}</td>
      <td style="text-align:right;color:#15803d">${l.haber ? l.haber.toFixed(2) : ""}</td>
      <td style="text-align:right;font-weight:700">${l.saldo.toFixed(2)}</td></tr>`).join("");
    const w = window.open("", "_blank", "width=820,height=900");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Estado de Cuenta · ${cliente.nombre}</title>
      <style>@page{size:A4;margin:14mm} body{font-family:Arial,sans-serif;color:#111;font-size:12px}
        h1{font-size:18px;margin:0} .muted{color:#555} table{width:100%;border-collapse:collapse;margin-top:10px}
        th,td{border:1px solid #ccc;padding:5px 7px} th{background:#f3f4f6;text-align:left}
        .tot{font-weight:700} .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
        .box{border:1px solid #ccc;border-radius:8px;padding:8px 10px;min-width:150px;text-align:right}</style></head>
      <body>
        <div class="head">
          <div><h1>${nombreOperacion} · CEYRO</h1><div class="muted">Estado de Cuenta de Cliente</div></div>
          <div class="box"><div class="muted">SALDO ACTUAL</div><div style="font-size:18px;font-weight:700">$ ${ec.saldo_final.toFixed(2)}</div></div>
        </div>
        <div><strong>${cliente.nombre}</strong> ${cliente.identificacion ? `· ${cliente.identificacion}` : ""}</div>
        <div class="muted">Período: ${ec.periodo.from} a ${ec.periodo.to} · Emitido: ${new Date().toLocaleDateString("es-EC")}</div>
        <table>
          <thead><tr><th>Fecha</th><th>Detalle</th><th>Máquina</th><th style="text-align:right">QQ</th><th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th style="text-align:right">Saldo</th></tr></thead>
          <tbody>
            <tr><td colspan="6" class="muted">Saldo anterior</td><td style="text-align:right;font-weight:700">${ec.saldo_apertura.toFixed(2)}</td></tr>
            ${filas}
            <tr class="tot"><td colspan="4">TOTALES DEL PERÍODO</td><td style="text-align:right">${ec.total_debe.toFixed(2)}</td><td style="text-align:right">${ec.total_haber.toFixed(2)}</td><td style="text-align:right">${ec.saldo_final.toFixed(2)}</td></tr>
          </tbody>
        </table>
        <p class="muted" style="margin-top:14px">Debe = servicios de cosecha/flete · Haber = abonos recibidos.</p>
      </body></html>`);
    w.document.close(); w.focus(); w.print();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: 16, overflowY: "auto" }}>
      <div className="tablePanel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: "100%", margin: "16px 0" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>📄 Estado de Cuenta</h2>
          <span className="muted">· {cliente.nombre}{cliente.identificacion ? ` · ${cliente.identificacion}` : ""}</span>
          <button type="button" className="btnSecondary" style={{ marginLeft: "auto" }} onClick={imprimir}>🖨️ Imprimir / PDF</button>
          <button type="button" onClick={onClose}>Cerrar</button>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <label style={{ margin: 0 }}><span>Desde</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={{ margin: 0 }}><span>Hasta</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div className="totalBox" style={{ minWidth: 140, margin: 0, marginLeft: "auto", background: "#eff6ff", borderColor: "#bfdbfe" }}>
            <span>SALDO FINAL</span>
            <strong style={{ color: (ec?.saldo_final ?? 0) > 0.005 ? "#b45309" : "#15803d" }}>{money(ec?.saldo_final ?? 0)}</strong>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable" style={{ marginTop: 8 }}>
            <thead><tr><th>Fecha</th><th>Detalle</th><th>Máquina</th><th className="num">QQ</th><th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo</th></tr></thead>
            <tbody>
              <tr><td colSpan={6} className="muted">Saldo anterior</td><td className="num" style={{ fontWeight: 700 }}>{money(ec?.saldo_apertura ?? 0)}</td></tr>
              {(ec?.lineas ?? []).map((l, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{String(l.fecha).slice(0, 10)}</td>
                  <td>{l.detalle}{l.cuenta ? <small className="muted"> · {l.cuenta}</small> : null}{l.clase === "abono" ? <span className="chip ok" style={{ marginLeft: 6 }}>abono</span> : null}</td>
                  <td>{l.maquina ?? "—"}</td>
                  <td className="num">{l.qq != null ? l.qq : "—"}</td>
                  <td className="num">{l.debe ? money(l.debe) : "—"}</td>
                  <td className="num" style={{ color: l.haber ? "#15803d" : undefined }}>{l.haber ? money(l.haber) : "—"}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(l.saldo)}</td>
                </tr>
              ))}
              {(ec?.lineas ?? []).length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 12 }}>Sin movimientos en el período.</td></tr>}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}>
                <td colSpan={4}>TOTALES DEL PERÍODO</td>
                <td className="num">{money(ec?.total_debe ?? 0)}</td>
                <td className="num">{money(ec?.total_haber ?? 0)}</td>
                <td className="num">{money(ec?.saldo_final ?? 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// Modal: editar datos del cliente (nombre, identificación, tipo).
function EditarClienteModal({ cliente, onClose, onDone, onError }: {
  cliente: ClienteCuenta; onClose: () => void; onDone: () => void | Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ nombre: cliente.nombre, identificacion: cliente.identificacion ?? "", telefono: cliente.telefono ?? "", tipo: cliente.tipo as "piladora" | "externo" });
  const [busy, setBusy] = useState(false);
  async function submit() {
    try {
      setBusy(true);
      if (f.nombre.trim().length < 2) throw new Error("Escribe el nombre del cliente");
      await patchCliente(cliente.id, { nombre: f.nombre.trim(), identificacion: f.identificacion.trim() || null, telefono: f.telefono.trim() || null, tipo: f.tipo });
      await onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ maxWidth: 440, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>✏️ Editar cliente</h2>
        <label><span>Nombre</span><input type="text" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
        <label><span>Identificación (RUC / cédula)</span><input type="text" value={f.identificacion} onChange={(e) => setF({ ...f, identificacion: e.target.value })} placeholder="Ej: 0912345678" /></label>
        <label><span>Teléfono</span><input type="text" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} placeholder="Ej: 0991234567" /></label>
        <label><span>Tipo</span>
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as "piladora" | "externo" })}>
            <option value="externo">externo</option>
            <option value="piladora">piladora</option>
          </select>
        </label>
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

// ＋ INGRESO: entrada a una cuenta. Opcional: ligarlo a un servicio como abono
// (respeta el bloqueo de sobrepago 422 del backend).
function IngresoForm({ cuentas, pendientes, onSaved, onError }: {
  cuentas: Cuenta[]; pendientes: Servicio[]; onSaved: OnSaved; onError: (m: string) => void;
}) {
  // Concepto = base (predefinido, opcional) + detalle extra. Si no hay base, el
  // detalle ES el concepto escrito a mano ("Escribir concepto manualmente…").
  const [f, setF] = useState({ fecha: hoy(), cuenta_id: "", monto: "", concepto_base: "", concepto_extra: "", servicio_id: "" });
  const [busy, setBusy] = useState(false);
  const svc = pendientes.find((s) => s.id === f.servicio_id);
  const conceptoFinal = f.concepto_base
    ? (f.concepto_extra.trim() ? `${f.concepto_base} - ${f.concepto_extra.trim()}` : f.concepto_base)
    : f.concepto_extra.trim();
  async function submit() {
    try {
      setBusy(true);
      if (!f.cuenta_id) throw new Error("Elige la cuenta");
      const monto = Number(f.monto);
      if (!(monto > 0)) throw new Error("Ingresa un monto válido");
      await apiPost("/campo/movimientos", {
        fecha: f.fecha, cuenta_id: f.cuenta_id, signo: "entrada", monto,
        concepto: conceptoFinal || (f.servicio_id ? "Abono de servicio" : undefined),
        servicio_id: f.servicio_id || undefined
      });
      setF({ ...f, monto: "", concepto_base: "", concepto_extra: "", servicio_id: "" });
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
      {/* Concepto: select de opciones predefinidas (o manual) + detalle extra. */}
      <label><span>Concepto</span>
        <select value={f.concepto_base} onChange={(e) => setF({ ...f, concepto_base: e.target.value })}>
          <option value="">✍️ Escribir concepto manualmente…</option>
          {CONCEPTOS_INGRESO.map((g) => (
            <optgroup key={g.grupo} label={g.grupo}>
              {g.items.map((it) => <option key={it} value={it}>{it}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label><span>{f.concepto_base ? "Detalle adicional (opcional)" : "Concepto (texto libre)"}</span>
        <input type="text" value={f.concepto_extra} onChange={(e) => setF({ ...f, concepto_extra: e.target.value })}
          placeholder={f.concepto_base ? "Ej: Finca El Tesoro" : "Ej: Pago cosecha"} />
      </label>
      {conceptoFinal && <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>Concepto: <strong>{conceptoFinal}</strong></p>}
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar ingreso"}</button>
    </form>
  );
}

// － EGRESO: salida de una cuenta. Orden estricto de campos (ver requisito):
// Fecha · Máquina/Vehículo* · Categoría* · Concepto · Monto · Cuenta. La máquina
// es OBLIGATORIA (por defecto "🏢 Gastos Generales / Administración" = sin activo).
// Si la categoría es REPARACION_MANT, el Concepto se arma con dos selects
// (Pieza + Acción → "Pieza - Acción"), quedando editable para un detalle extra.
// Un checkbox lo marca como anticipo (fondo por rendir) → pendiente de rendición.
function EgresoForm({ cuentas, categorias, activos, onSaved, onError }: {
  cuentas: Cuenta[]; categorias: Categoria[]; activos: Activo[]; onSaved: OnSaved; onError: (m: string) => void;
}) {
  const [f, setF] = useState({
    fecha: hoy(), activo_sel: ACTIVO_GENERAL, categoria_id: "", concepto: "", monto: "", cuenta_id: "", es_anticipo: false,
    // Solo para REPARACION_MANT: la pieza y la acción arman el concepto "Pieza - Acción".
    pieza: "", accion: ""
  });
  const [busy, setBusy] = useState(false);
  const catNombre = categorias.find((c) => c.id === f.categoria_id)?.nombre ?? "";
  const esReparacion = catNombre === REPARACION_MANT;

  // Al elegir pieza/acción, se reescribe el concepto (queda editable después).
  const setMant = (pieza: string, accion: string) =>
    setF((prev) => ({ ...prev, pieza, accion, concepto: [pieza, accion].filter(Boolean).join(" - ") }));

  async function submit() {
    try {
      setBusy(true);
      if (!f.activo_sel) throw new Error("Elige la máquina/vehículo o Gastos Generales");
      if (!f.categoria_id) throw new Error("La categoría del gasto es obligatoria");
      if (!f.cuenta_id) throw new Error("Elige la cuenta");
      const monto = Number(f.monto);
      if (!(monto > 0)) throw new Error("Ingresa un monto válido");
      await apiPost("/campo/movimientos", {
        fecha: f.fecha, cuenta_id: f.cuenta_id, signo: "salida", monto,
        concepto: f.concepto.trim() || undefined, categoria_id: f.categoria_id,
        activo_id: f.activo_sel === ACTIVO_GENERAL ? undefined : f.activo_sel,
        es_anticipo: f.es_anticipo || undefined
      });
      setF({ ...f, concepto: "", monto: "", categoria_id: "", es_anticipo: false, pieza: "", accion: "" });
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  const req = <span style={{ color: "#ef4444" }}>*</span>;
  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>－ Nuevo egreso (gasto)</h2>
      {/* 1 · Fecha */}
      <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
      {/* 2 · Máquina / Vehículo (obligatorio, default = Gastos Generales) */}
      <label><span>Asignar a Máquina / Vehículo {req}</span>
        <select value={f.activo_sel} onChange={(e) => setF({ ...f, activo_sel: e.target.value })}>
          <option value={ACTIVO_GENERAL}>🏢 Gastos Generales / Administración</option>
          {activos.map((a) => <option key={a.id} value={a.id}>{a.nombre} · {tipoLabel(a.tipo)}{a.placa_codigo ? ` · ${a.placa_codigo}` : ""}</option>)}
        </select>
      </label>
      {/* 3 · Categoría (obligatoria) */}
      <label><span>Categoría {req}</span>
        <select value={f.categoria_id} onChange={(e) => setF({ ...f, categoria_id: e.target.value })}>
          <option value="">Seleccione</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </label>
      {/* 4 · Concepto. Para REPARACION_MANT se arma con Pieza + Acción; el input
          queda editable para agregar un detalle extra. Otras categorías: texto libre. */}
      {esReparacion && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Pieza Afectada</span>
            <select value={f.pieza} onChange={(e) => setMant(e.target.value, f.accion)}>
              <option value="">Seleccione…</option>
              {PIEZAS_MANT.map((g) => (
                <optgroup key={g.grupo} label={g.grupo}>
                  {g.items.map((it) => <option key={it} value={it}>{it}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label><span>Acción Realizada</span>
            <select value={f.accion} onChange={(e) => setMant(f.pieza, e.target.value)}>
              <option value="">Seleccione…</option>
              {ACCIONES_MANT.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
      )}
      <label><span>Concepto{esReparacion ? " · autollenado (editable para detalle extra)" : ""}</span>
        <input type="text" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })}
          placeholder={esReparacion ? "Ej: Orugas de goma (bandas) - Cambio / Reemplazo" : "Ej: Diésel cosechadora"} />
      </label>
      {/* 5 · Monto */}
      <label><span>Monto $</span><input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" /></label>
      {/* 6 · Cuenta */}
      <label><span>Cuenta (sale de) {req}</span>
        <select value={f.cuenta_id} onChange={(e) => setF({ ...f, cuenta_id: e.target.value })}>
          <option value="">Seleccione</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </label>
      {/* Fondos por rendir (vale de anticipo) */}
      <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={f.es_anticipo} onChange={(e) => setF({ ...f, es_anticipo: e.target.checked })} style={{ width: "auto" }} />
        <span style={{ margin: 0 }}>Marca si es dinero entregado por rendir (Anticipo)</span>
      </label>
      {f.es_anticipo && <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>Se guardará como <strong>vale pendiente</strong>. Podrás liquidarlo en 📋 Vales / Anticipos.</p>}
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : f.es_anticipo ? "Registrar anticipo" : "Registrar egreso"}</button>
    </form>
  );
}

// ── 📋 Vales / Anticipos: fondos por rendir ──────────────────────────────────
// Lista los egresos marcados como anticipo. Los PENDIENTES se pueden liquidar
// (rendir): se ingresa lo realmente gastado y el backend genera el ajuste de
// caja (devolución si sobró, reembolso si faltó) y marca el vale como liquidado.
function ValesPanel({ onLiquidated, onError }: {
  onLiquidated: () => void | Promise<void>; onError: (m: string) => void;
}) {
  const [vista, setVista] = useState<"PENDIENTE_RENDICION" | "LIQUIDADO">("PENDIENTE_RENDICION");
  const [vales, setVales] = useState<Vale[]>([]);
  const [liquidando, setLiquidando] = useState<Vale | null>(null);

  const cargar = useCallback(async () => {
    try { setVales(await apiGet<Vale[]>(`/campo/movimientos/vales?estado=${vista}`)); }
    catch (e) { onError((e as Error).message); }
  }, [vista, onError]);
  useEffect(() => { cargar(); }, [cargar]);

  const pend = vista === "PENDIENTE_RENDICION";
  const totalPend = useMemo(() => vales.reduce((s, v) => s + v.entregado, 0), [vales]);

  return (
    <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>📋 Vales / Anticipos <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· fondos por rendir</span></h2>
        <nav className="cajaSubNav" style={{ borderBottom: "none", marginLeft: "auto" }}>
          <button type="button" className={pend ? "active" : ""} onClick={() => setVista("PENDIENTE_RENDICION")}>⏳ Pendientes</button>
          <button type="button" className={!pend ? "active" : ""} onClick={() => setVista("LIQUIDADO")}>✅ Liquidados</button>
        </nav>
      </div>
      {pend && vales.length > 0 && (
        <div className="totalBox" style={{ minWidth: 180, margin: "8px 0", background: "#fef3c7", borderColor: "#fde68a" }}>
          <span>TOTAL POR RENDIR</span>
          <strong style={{ color: "#b45309" }}>{money(totalPend)}</strong>
          <small>{vales.length} vale(s)</small>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="cajaTable" style={{ marginTop: 6 }}>
          <thead><tr>
            <th>Fecha</th><th>Máquina / Destino</th><th>Categoría</th><th>Concepto</th>
            <th className="num">Entregado</th>{!pend && <th className="num">Rendido</th>}<th>Cuenta</th><th />
          </tr></thead>
          <tbody>
            {vales.length === 0 ? (
              <tr><td colSpan={pend ? 7 : 8} className="muted" style={{ textAlign: "center", padding: 14 }}>
                {pend ? "No hay vales pendientes de rendición." : "No hay vales liquidados."}
              </td></tr>
            ) : vales.map((v) => (
              <tr key={v.id}>
                <td style={{ whiteSpace: "nowrap" }}>{String(v.fecha).slice(0, 10)}</td>
                <td>{v.activo_nombre || "🏢 Gastos Generales"}</td>
                <td>{v.categoria_nombre || "—"}</td>
                <td>{v.concepto || "—"}</td>
                <td className="num" style={{ fontWeight: 700 }}>{money(v.entregado)}</td>
                {!pend && <td className="num">{v.monto_rendido != null ? money(v.monto_rendido) : "—"}</td>}
                <td>{v.cuenta_nombre}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {pend
                    ? <button type="button" className="primary" onClick={() => setLiquidando(v)}>🧾 Liquidar / Rendir</button>
                    : <span className="chip ok">Liquidado</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {liquidando && (
        <LiquidarValeModal vale={liquidando}
          onClose={() => setLiquidando(null)}
          onDone={async () => { setLiquidando(null); await cargar(); await onLiquidated(); }}
          onError={onError} />
      )}
    </div>
  );
}

// Modal de liquidación: ingresa el monto REAL gastado y muestra el ajuste que se
// hará (devolución si sobró, reembolso si faltó). Confirma → liquida en backend.
function LiquidarValeModal({ vale, onClose, onDone, onError }: {
  vale: Vale; onClose: () => void; onDone: () => void | Promise<void>; onError: (m: string) => void;
}) {
  const [montoReal, setMontoReal] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [busy, setBusy] = useState(false);
  const real = Number(montoReal);
  const valido = montoReal !== "" && real >= 0;
  const diff = valido ? Math.round((vale.entregado - real) * 100) / 100 : 0;

  async function submit() {
    try {
      setBusy(true);
      if (!valido) throw new Error("Ingresa el monto realmente gastado (0 o más)");
      await apiPost(`/campo/movimientos/${vale.id}/liquidar`, { monto_real: real, fecha });
      await onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }}
        style={{ maxWidth: 460, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>🧾 Liquidar vale / rendición</h2>
        <div className="totalBox" style={{ margin: "0 0 6px" }}>
          <span>ENTREGADO (por rendir)</span>
          <strong>{money(vale.entregado)}</strong>
          <small>{vale.activo_nombre || "🏢 Gastos Generales"}{vale.concepto ? ` · ${vale.concepto}` : ""}</small>
        </div>
        <label><span>Monto real gastado $</span>
          <input type="number" step="0.01" min="0" autoFocus value={montoReal}
            onChange={(e) => setMontoReal(e.target.value)} placeholder="0.00" />
        </label>
        <label><span>Fecha de la rendición</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        {valido && Math.abs(diff) > 0.005 && (
          <p style={{ margin: "2px 0 4px", padding: "8px 12px", borderRadius: 8, fontWeight: 600,
            background: diff > 0 ? "var(--c-success-bg)" : "var(--c-danger-bg)",
            color: diff > 0 ? "#15803d" : "#b91c1c" }}>
            {diff > 0
              ? <>Sobró: se creará un <strong>Ingreso a caja</strong> por la devolución de {money(diff)}.</>
              : <>Faltó: se creará un <strong>Egreso adicional</strong> (reembolso) por {money(-diff)}.</>}
          </p>
        )}
        {valido && Math.abs(diff) <= 0.005 && (
          <p className="muted" style={{ marginTop: 2, fontSize: 12 }}>Gastó exactamente lo entregado: no habrá devolución ni reembolso.</p>
        )}
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy || !valido}>{busy ? "Liquidando…" : "Confirmar rendición"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
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
type LibroRow = { id: string; fecha: string; concepto: string | null; cuenta_nombre: string; categoria_nombre: string | null; activo_nombre: string | null; naturaleza: string; estado: string | null; entrada: number; salida: number; saldo_corrido: number };
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
                  {r.naturaleza === "ajuste_vale" ? <span className="chip info" style={{ marginLeft: 6 }}>ajuste vale</span> : null}
                  {r.estado === "PENDIENTE_RENDICION" ? <span className="chip warn" style={{ marginLeft: 6 }}>📋 por rendir</span> : null}
                  {r.estado === "LIQUIDADO" ? <span className="chip ok" style={{ marginLeft: 6 }}>vale liquidado</span> : null}
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

// ── 🔓 Apertura de caja ──────────────────────────────────────────────────────
function AperturaCajaModal({ saldoSugerido, onClose, onDone, onError }: {
  saldoSugerido: number; onClose: () => void; onDone: () => void | Promise<void>; onError: (m: string) => void;
}) {
  const [monto, setMonto] = useState(saldoSugerido ? String(saldoSugerido) : "");
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    try {
      setBusy(true);
      const saldo = Number(monto);
      if (!(saldo >= 0)) throw new Error("Ingresa el monto inicial (0 o más)");
      await apiPost("/campo/caja/abrir", { saldo_inicial: saldo, observaciones: obs.trim() || undefined });
      await onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ maxWidth: 440, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>🔓 Abrir caja</h2>
        <label><span>Monto inicial en efectivo $</span>
          <input type="number" step="0.01" min="0" autoFocus value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
          <small className="muted" style={{ cursor: "pointer" }} onClick={() => setMonto(String(saldoSugerido))}>› Sugerido (cierre anterior): {money(saldoSugerido)}</small>
        </label>
        <label><span>Observaciones (opcional)</span><input type="text" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: Turno mañana" /></label>
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy}>{busy ? "Abriendo…" : "Abrir caja"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

// ── 🔒 Arqueo y cierre de caja ───────────────────────────────────────────────
function CierreCajaModal({ onClose, onDone, onError }: {
  onClose: () => void; onDone: (msg: string) => void | Promise<void>; onError: (m: string) => void;
}) {
  const [prev, setPrev] = useState<{ saldo_inicial: number; ingresos: number; egresos: number; saldo_teorico: number } | null>(null);
  const [real, setReal] = useState("");
  const [obs, setObs] = useState("");
  const [ajuste, setAjuste] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiGet<{ saldo_inicial: number; ingresos: number; egresos: number; saldo_teorico: number }>("/campo/caja/cierre-preview").then(setPrev).catch((e) => onError((e as Error).message)); }, [onError]);

  const real$ = Number(real);
  const valido = real !== "" && real$ >= 0;
  const dif = valido && prev ? Math.round((real$ - prev.saldo_teorico) * 100) / 100 : 0;
  const estadoDif = !valido ? "" : Math.abs(dif) <= 0.005 ? "cuadrado" : dif > 0 ? "sobrante" : "faltante";

  async function submit() {
    try {
      setBusy(true);
      if (!valido) throw new Error("Ingresa el efectivo físico contado");
      const r = await apiPost<{ diferencia: number }>("/campo/caja/cerrar", { saldo_real: real$, observaciones: obs.trim() || undefined, generar_ajuste: ajuste });
      const d = r.diferencia;
      await onDone(Math.abs(d) <= 0.005 ? "Caja cerrada · cuadrada" : d > 0 ? `Caja cerrada · sobrante ${money(d)}` : `Caja cerrada · faltante ${money(-d)}`);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ maxWidth: 460, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>🔒 Arqueo y cierre de caja</h2>
        <table className="cajaTable" style={{ marginBottom: 8 }}>
          <tbody>
            <tr><td>Saldo inicial</td><td className="num">{money(prev?.saldo_inicial ?? 0)}</td></tr>
            <tr><td>＋ Ingresos en efectivo</td><td className="num" style={{ color: "#15803d" }}>{money(prev?.ingresos ?? 0)}</td></tr>
            <tr><td>－ Egresos en efectivo</td><td className="num" style={{ color: "#b91c1c" }}>{money(prev?.egresos ?? 0)}</td></tr>
            <tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border-strong)" }}><td>= Saldo teórico</td><td className="num">{money(prev?.saldo_teorico ?? 0)}</td></tr>
          </tbody>
        </table>
        <label><span>Efectivo físico contado $</span>
          <input type="number" step="0.01" min="0" autoFocus value={real} onChange={(e) => setReal(e.target.value)} placeholder="0.00" />
        </label>
        {valido && (
          <p style={{ margin: "2px 0 4px", padding: "8px 12px", borderRadius: 8, fontWeight: 700,
            background: estadoDif === "cuadrado" ? "var(--c-success-bg)" : "var(--c-danger-bg)",
            color: estadoDif === "cuadrado" ? "#15803d" : estadoDif === "sobrante" ? "#b45309" : "#b91c1c" }}>
            {estadoDif === "cuadrado" ? "✅ Cuadrado (sin diferencia)" : estadoDif === "sobrante" ? `⬆️ Sobrante: ${money(dif)}` : `⬇️ Faltante: ${money(-dif)}`}
          </p>
        )}
        {valido && estadoDif !== "cuadrado" && (
          <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={ajuste} onChange={(e) => setAjuste(e.target.checked)} style={{ width: "auto" }} />
            <span style={{ margin: 0 }}>Generar ajuste en el libro por el descuadre</span>
          </label>
        )}
        <label><span>Observaciones (opcional)</span><input type="text" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: cierre turno tarde" /></label>
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy || !valido || !prev}>{busy ? "Cerrando…" : "Confirmar cierre"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

// ── 📋 Historial de cierres de caja (auditoría) ──────────────────────────────
function CierresCajaView() {
  const [rows, setRows] = useState<SesionHist[]>([]);
  useEffect(() => { apiGet<SesionHist[]>("/campo/caja/sesiones").then(setRows).catch(() => setRows([])); }, []);
  const fmt = (d: string | null) => d ? new Date(d).toLocaleString("es-EC") : "—";
  const difChip = (d: number | null) => d == null ? <span className="muted">—</span>
    : Math.abs(d) <= 0.005 ? <span className="chip ok">Cuadrado</span>
    : d > 0 ? <span className="chip warn">Sobrante {money(d)}</span>
    : <span className="chip bad">Faltante {money(-d)}</span>;
  return (
    <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
      <h2>📋 Cierres de Caja <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· auditoría ({rows.length})</span></h2>
      <div style={{ overflowX: "auto" }}>
        <table className="cajaTable" style={{ marginTop: 6 }}>
          <thead><tr>
            <th>Apertura</th><th>Cierre</th><th>Responsable</th>
            <th className="num">Saldo inicial</th><th className="num">Teórico</th><th className="num">Real</th><th>Diferencia</th><th>Estado</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin sesiones de caja.</td></tr>
              : rows.map((s) => (
              <tr key={s.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmt(s.fecha_apertura)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{fmt(s.fecha_cierre)}</td>
                <td>{s.usuario_nombre ?? "—"}</td>
                <td className="num">{money(s.saldo_inicial)}</td>
                <td className="num">{s.saldo_teorico != null ? money(s.saldo_teorico) : "—"}</td>
                <td className="num" style={{ fontWeight: 700 }}>{s.saldo_real != null ? money(s.saldo_real) : "—"}</td>
                <td>{difChip(s.diferencia)}</td>
                <td><span className={s.estado === "ABIERTA" ? "chip info" : "chip ok"}>{s.estado}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  // Importar/liquidar un Parte Diario pendiente.
  const [partes, setPartes] = useState<PartePendiente[]>([]);
  const [parteId, setParteId] = useState("");

  const cargarPartes = useCallback(async () => {
    try { setPartes(await apiGet<PartePendiente[]>("/campo/partes?estado=por_cobrar")); } catch { /* opcional */ }
  }, []);
  useEffect(() => { cargarPartes(); }, [cargarPartes]);

  const valorCalc = useMemo(() => {
    const qq = Number(f.qq), pu = Number(f.precio_unitario);
    return qq > 0 && pu > 0 ? Math.round(qq * pu * 100) / 100 : null;
  }, [f.qq, f.precio_unitario]);

  // Al elegir un parte: autocompleta fecha/máquina/QQ, resuelve/crea el cliente y
  // guarda el parte_id. El precio unitario lo ingresa el usuario (o ajuste manual).
  async function elegirParte(id: string) {
    setParteId(id);
    if (!id) return;
    const p = partes.find((x) => x.id === id);
    if (!p) return;
    try {
      const c = await apiPost<Cliente>("/campo/clientes", { nombre: p.cliente });
      setCliente(c);
      setF((prev) => ({ ...prev, fecha: String(p.fecha).slice(0, 10), activo_id: p.activo_id, tipo: "cosecha", qq: String(p.qq), valor: "" }));
    } catch (e) { onError((e as Error).message); }
  }
  function quitarParte() { setParteId(""); }

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
        notas: f.notas.trim() || undefined,
        parte_id: parteId || undefined
      });
      setF({ fecha: f.fecha, activo_id: f.activo_id, tipo: f.tipo, qq: "", precio_unitario: "", valor: "", notas: "" });
      setCliente(null); setParteId("");
      await Promise.all([onSaved(), cargarPartes()]);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>🚜 Nuevo servicio</h2>
      {/* Importar un Parte Diario pendiente (opcional). Autollena y lo liquida. */}
      <label><span>📋 Seleccionar Parte Diario pendiente (opcional)</span>
        <select value={parteId} onChange={(e) => elegirParte(e.target.value)}>
          <option value="">— Registro manual (sin parte) —</option>
          {partes.map((p) => (
            <option key={p.id} value={p.id}>
              {String(p.fecha).slice(0, 10)} · {p.activo_nombre} · {p.cliente}{p.operador ? ` · ${p.operador}` : ""} · {p.qq} QQ
            </option>
          ))}
        </select>
      </label>
      {parteId && (
        <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>
          Al guardar se liquidará el parte (pasa a <strong>Cobro generado</strong>). <span style={{ cursor: "pointer", color: "#2563eb" }} onClick={quitarParte}>✕ quitar parte</span>
        </p>
      )}
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

// 👷 OPERADORES — catálogo (campo_operadores): alta, edición y archivar/activar.
// Se usa en el selector de Operador de Partes Diarios.
async function patchOperador(id: string, body: unknown): Promise<void> {
  const r = await apiFetch(`/campo/operadores/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "No se pudo actualizar el operador");
}
const operadorVacio = { nombre: "", identificacion: "", telefono: "" };
function OperadoresCatalogo({ operadores, onChanged, onError }: {
  operadores: Operador[]; onChanged: (msg: string) => Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState(operadorVacio);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function editar(o: Operador) {
    setEditId(o.id);
    setF({ nombre: o.nombre, identificacion: o.identificacion ?? "", telefono: o.telefono ?? "" });
  }
  function cancelar() { setEditId(null); setF(operadorVacio); }

  async function guardar() {
    try {
      setBusy(true);
      if (f.nombre.trim().length < 2) throw new Error("Escribe el nombre del operador");
      const payload = { nombre: f.nombre.trim(), identificacion: f.identificacion.trim() || null, telefono: f.telefono.trim() || null };
      if (editId) await patchOperador(editId, payload);
      else await apiPost("/campo/operadores", { ...payload, identificacion: payload.identificacion ?? undefined, telefono: payload.telefono ?? undefined });
      cancelar();
      await onChanged(editId ? "Operador actualizado" : "Operador agregado");
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  async function archivar(o: Operador) {
    try {
      await patchOperador(o.id, { activo: !o.activo });
      if (editId === o.id) cancelar();
      await onChanged(o.activo ? "Operador archivado" : "Operador reactivado");
    } catch (e) { onError((e as Error).message); }
  }

  return (
    <div className="formPanel" style={{ gridColumn: "1 / -1" }}>
      <h2>👷 Operadores</h2>
      <p className="muted" style={{ marginTop: -4 }}>Personal que opera la maquinaria. Alimenta el selector de Operador en Partes Diarios.</p>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
        <label><span>Nombre</span><input type="text" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej: Juan Pérez" /></label>
        <label><span>Cédula / Identificación</span><input type="text" value={f.identificacion} onChange={(e) => setF({ ...f, identificacion: e.target.value })} placeholder="Ej: 0912345678" /></label>
        <label><span>Teléfono</span><input type="text" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} placeholder="Ej: 0991234567" /></label>
      </div>
      <div className="buttonRow">
        <button type="button" className="primary" onClick={guardar} disabled={busy}>{busy ? "Guardando…" : editId ? "Guardar cambios" : "➕ Agregar operador"}</button>
        {editId && <button type="button" onClick={cancelar}>Cancelar</button>}
      </div>
      {operadores.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table className="cajaTable">
            <thead><tr><th>Nombre</th><th>Cédula / ID</th><th>Teléfono</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {operadores.map((o) => (
                <tr key={o.id} style={{ opacity: o.activo ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 600 }}>{o.nombre}</td>
                  <td>{o.identificacion || "—"}</td>
                  <td>{o.telefono || "—"}</td>
                  <td><span className={o.activo ? "chip ok" : "chip bad"}>{o.activo ? "Activo" : "Inactivo"}</span></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="btnSecondary" style={{ marginRight: 6 }} onClick={() => editar(o)}>✏️ Editar</button>
                    <button type="button" className="btnSecondary" onClick={() => archivar(o)}>{o.activo ? "🗄️ Archivar" : "↩️ Activar"}</button>
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
