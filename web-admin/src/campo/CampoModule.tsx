// MÓDULO INDEPENDIENTE: Caja de Campo (cosechadora + transporte/fletes).
// V1 = solo captura. Autocontenido: su propio estado y llamadas a /campo/*.
// No depende de la lógica de piladora/ventas/fomentos. Se engancha en App.tsx
// con una entrada de sidebar y un único render.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiFetch, apiGet, apiOk, apiPost, apiPut } from "../api";

// PATCH a la maquinaria (campo_activos): el endpoint es PATCH (no PUT).
async function patchMaquina(id: string, body: unknown): Promise<void> {
  const r = await apiFetch(`/campo/activos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "No se pudo actualizar la maquinaria");
}
import { money } from "../format";
import PartesModule from "./PartesModule";
import EstadoResultadosCampo from "./EstadoResultadosCampo";
import NominaOperadores, { TarifasOperadorCatalogo } from "./NominaOperadores";
import { BuscadorHistorial } from "../components/BuscadorHistorial";
import { BuscadorCombo, type OpcionCombo } from "../components/BuscadorCombo";

// Menú propio de la operación Campo (contexto aislado). Para agregar secciones
// nuevas: añade una entrada aquí y su caso en CampoModule (prop `section`).
// Menú propio de la operación aislada "Transporte y Cosechadora". El workspace
// completo (CampoWorkspace) solo se renderiza cuando esta operación está activa en
// el selector superior, así que el sidebar ya es contextual por operación.
const CAMPO_SECCIONES: Array<{ id: CampoSeccion; label: string; icon: string }> = [
  { id: "caja", label: "Caja", icon: "💰" },
  { id: "clientes", label: "Clientes", icon: "👥" },
  { id: "partes", label: "Partes Diarios", icon: "📝" },
  { id: "nomina", label: "Nómina Operadores", icon: "💵" },
  { id: "cxc", label: "Cuentas por Cobrar", icon: "📥" },
  { id: "cxp", label: "Cuentas por Pagar", icon: "📤" },
  { id: "vales", label: "Vales por Rendir", icon: "🧾" },
  { id: "historial", label: "¿Cuándo se hizo?", icon: "🔎" },
  { id: "resultados", label: "Estado de Resultados", icon: "📈" },
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
export type CampoSeccion = "caja" | "servicios" | "clientes" | "cxc" | "cxp" | "vales" | "partes" | "mantenimiento" | "nomina" | "historial" | "reportes" | "resultados" | "config";

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

// Estandarización de mantenimientos: un egreso de REPARACION_MANT se registra con
// el «Detalle de Intervención» (tipo, repuesto/trabajo y descripción) y queda como
// mantenimiento de la máquina. PIEZAS_MANT es el catálogo de piezas por sistema.
const REPARACION_MANT = "REPARACION_MANT"; // nombre de la categoría gatillo (semilla)
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

// ── Nuevo egreso · sensible al tipo de máquina ───────────────────────────────
// Familia de la máquina (por su tipo y, si no alcanza, palabras clave del nombre):
// decide la unidad de desgaste (horómetro / km) y qué repuestos se sugieren primero.
type FamiliaMaquina = "cosechadora" | "pesado" | "liviano" | "general";
function familiaDe(a?: Activo): FamiliaMaquina {
  if (!a) return "general";
  const n = `${a.tipo} ${a.nombre}`.toLowerCase();
  if (a.tipo === "cosechadora" || /cosech|combinada|trilladora/.test(n)) return "cosechadora";
  if (a.tipo === "camion" || /cami[oó]n|volqueta|plataforma|tr[aá]iler|cabezal|mula|hino|isuzu|tolva/.test(n)) return "pesado";
  if (a.tipo === "vehiculo" || /camioneta|toyota|hilux|auto|moto|pick ?up|jeep|vitara/.test(n)) return "liviano";
  return "general";
}
const FAMILIA_INFO: Record<FamiliaMaquina, { icono: string; label: string; unidad: "KM" | "HORAS" }> = {
  cosechadora: { icono: "🌾", label: "Cosechadora · se mide en horas (horómetro)", unidad: "HORAS" },
  pesado: { icono: "🚛", label: "Vehículo pesado · se mide en km", unidad: "KM" },
  liviano: { icono: "🚙", label: "Vehículo liviano · se mide en km", unidad: "KM" },
  general: { icono: "🛠️", label: "Otro equipo", unidad: "HORAS" }
};
// Categorías que piden horómetro / kilometraje (por su nombre en Configuración).
const CATEGORIAS_CON_LECTURA = ["DIESEL", "GASOLINA", REPARACION_MANT];
// Repuestos / trabajos más frecuentes de cada familia: salen PRIMERO en el buscador.
const REPUESTOS_AFINES: Record<FamiliaMaquina, string[]> = {
  cosechadora: ["Bandas / correas", "Rodamientos", "Aceite hidráulico", "Aceite de motor y filtros", "Cuchillas de corte",
    "Cadenas del acarreador", "Orugas de goma (bandas)", "Mangueras hidráulicas", "Zarandas / cribas", "Engrase general"],
  pesado: ["Aceite de motor y filtros", "Llantas / neumáticos", "Frenos de aire (zapatas, válvulas)", "Rodamientos de bocín",
    "Kit de embrague", "Ballestas y amortiguadores", "Baterías", "Aceite de caja y diferencial"],
  liviano: ["Aceite de motor y filtro", "Bujías", "Pastillas de freno", "Batería", "Banda de distribución / accesorios",
    "Llantas", "Filtro de aire", "Amortiguadores", "Alineación y balanceo"],
  general: []
};
// Grupos del catálogo general (PIEZAS_MANT) que son de cada familia; los demás valen para todas.
const FAMILIAS_GRUPO: Record<string, FamiliaMaquina[]> = {
  "Cabezal y Acarreador": ["cosechadora"], "Sistema de Trilla y Limpieza": ["cosechadora"],
  "Tren de Rodaje (Orugas)": ["cosechadora"], "Motor, Hidráulico y Descarga": ["cosechadora"],
  "Motor y Combustible (Vehículos)": ["pesado", "liviano"], "Frenos (Vehículos)": ["pesado", "liviano"],
  "Suspensión y Dirección": ["pesado", "liviano"], "Transmisión (Vehículos)": ["pesado", "liviano"]
};
const TRABAJOS_GENERALES = ["Mano de obra mecánica", "Soldadura", "Revisión / diagnóstico", "Lavado y engrase"];
/** Opciones del buscador «Repuesto / Trabajo Realizado», priorizadas por la familia de la máquina. */
function opcionesRepuesto(familia: FamiliaMaquina): OpcionCombo[] {
  const vistos = new Set<string>();
  const out: OpcionCombo[] = [];
  const add = (titulo: string, etiqueta: string) => {
    const k = titulo.toLowerCase();
    if (vistos.has(k)) return;
    vistos.add(k);
    out.push({ key: titulo, titulo, etiqueta });
  };
  REPUESTOS_AFINES[familia].forEach((t) => add(t, "⭐ Afín"));
  const esDeFamilia = (g: string) => !FAMILIAS_GRUPO[g] || familia === "general" || FAMILIAS_GRUPO[g].includes(familia);
  PIEZAS_MANT.filter((g) => esDeFamilia(g.grupo)).forEach((g) => g.items.forEach((t) => add(t, g.grupo)));
  TRABAJOS_GENERALES.forEach((t) => add(t, "Trabajo"));
  PIEZAS_MANT.filter((g) => !esDeFamilia(g.grupo)).forEach((g) => g.items.forEach((t) => add(t, `${g.grupo} · otro equipo`)));
  return out;
}

// Conceptos predefinidos para el INGRESO (select con optgroups). El usuario puede
// elegir uno y agregarle un detalle extra, o escribir el concepto a mano.
// Ingreso principal de esta caja: el flete externo (fuera de báscula). Va primero
// y viene preseleccionado en «＋ Nuevo ingreso».
const CONCEPTO_INGRESO_PRINCIPAL = "Flete externo / Fuera de báscula";
const CONCEPTOS_INGRESO: Array<{ grupo: string; items: string[] }> = [
  { grupo: "Transporte", items: [
    CONCEPTO_INGRESO_PRINCIPAL, "Pago por flete / transporte", "Abono por flete"
  ] },
  { grupo: "Servicios Agrícolas", items: [
    "Pago por servicio de cosecha", "Abono por servicio de cosecha"
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

type MantenimientoTipo = "CAMBIO_ACEITE" | "PREVENTIVO" | "CORRECTIVO" | "REPUESTO" | "LLANTAS" | "INSPECCION" | "OTRO";
type Mantenimiento = {
  id: string; fecha: string; activo_id: string; activo_nombre: string; activo_tipo: string;
  placa_codigo: string | null; tipo: MantenimientoTipo; componente: string | null;
  detalle: string; lectura: number | null; unidad_lectura: "KM" | "HORAS" | null;
  proxima_fecha: string | null; proxima_lectura: number | null; proveedor: string | null;
  factura: string | null; costo: number; cuenta_nombre: string | null;
  observaciones: string | null; creado_por: string | null;
  anulado_at: string | null;
  estado_proximo: "SIN_PROGRAMAR" | "VENCIDO" | "PROXIMO" | "PROGRAMADO" | "ANULADO";
};

// ── Tipos de los reportes (V2) ───────────────────────────────────────────────
type SaldoCaja = { corte: string; cuentas: Array<{ id: string; nombre: string; saldo: number }>; total: number; total_disponible: number };
type PorCobrarCliente = { cliente_id: string; cliente_nombre: string; servicios: number; saldo: number; antiguedad_max_dias: number; tramo: string };
type PorCobrarDetalle = { servicio_id: string; fecha: string; cliente_id: string; cliente_nombre: string; activo_nombre: string; tipo: string; valor: number; cobrado: number; saldo: number; antiguedad_dias: number; tramo: string };
type PorCobrar = { por_cliente: PorCobrarCliente[]; detalle: PorCobrarDetalle[]; por_tramo: Array<{ tramo: string; saldo: number; servicios: number }>; total_general: number };
type Maquina = { activo_id: string | null; activo_nombre: string; activo_tipo: string | null; ingresos: number; gastos: number; ganancia: number; qq: number; gastos_por_categoria: Array<{ categoria: string; gasto: number }> };
type PorMaquina = { periodo: { desde: string; hasta: string }; maquinas: Maquina[] };

type AlertaCampoUI = { key: string; nivel: "atencion" | "info"; icono: string; titulo: string; detalle: string; seccion: CampoSeccion };

/** Franja de «lo que hay que atender» al abrir Transporte y Cosechadora. Si falla, no se muestra (no estorba). */
function AlertasCampo({ onIr, version }: { onIr?: (s: CampoSeccion) => void; version: number }) {
  const [alertas, setAlertas] = useState<AlertaCampoUI[]>([]);
  useEffect(() => {
    let vivo = true;
    apiGet<{ alertas: AlertaCampoUI[] }>("/campo/alertas").then((r) => { if (vivo) setAlertas(r.alertas); }).catch(() => { if (vivo) setAlertas([]); });
    return () => { vivo = false; };
  }, [version]);
  if (alertas.length === 0) return null;
  return (
    <div className="campoAlertas" role="region" aria-label="Pendientes de Transporte y Cosechadora">
      {alertas.map((a) => (
        <button key={a.key} type="button" className={`campoAlerta campoAlerta--${a.nivel}`} onClick={() => onIr?.(a.seccion)} disabled={!onIr}>
          <span className="campoAlerta__ico" aria-hidden="true">{a.icono}</span>
          <span className="campoAlerta__txt"><strong>{a.titulo}</strong><small>{a.detalle}</small></span>
        </button>
      ))}
    </div>
  );
}

export default function CampoModule({ section = "caja", nombre, matrizName = "Matriz", onNombreChange, onIrSeccion }: {
  section?: CampoSeccion; nombre?: string; matrizName?: string; onNombreChange?: (n: string) => void;
  /** Cambia de sección del menú de Transporte (p. ej. de la caja al Estado de Resultados). */
  onIrSeccion?: (s: CampoSeccion) => void;
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
  const [menuCaja, setMenuCaja] = useState(false);
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

  useEffect(() => {
    // La sesion activa repara primero cualquier saldo inicial antiguo; despues
    // se consultan las tarjetas para que CAJA ya refleje ese movimiento.
    refreshSesion()
      .then(() => Promise.all([refreshCatalogos(), refreshServicios()]))
      .catch((e) => notify(e.message, "err"));
  }, [refreshCatalogos, refreshServicios, refreshSesion]);

  const activosActivos = useMemo(() => activos.filter((a) => a.activo), [activos]);
  const pendientes = useMemo(() => servicios.filter((s) => s.estado !== "pagado"), [servicios]);
  // CRUCE PILADORA es una cuenta puente contable, no dinero disponible para
  // pagar gastos. Se muestra por transparencia, pero no infla el disponible.
  const totalDisponible = useMemo(
    () => cuentas.filter((c) => c.nombre !== "CRUCE PILADORA").reduce((s, c) => s + c.saldo, 0),
    [cuentas]
  );

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

  if (section === "resultados") {
    return <section className="panelGrid"><div style={{ gridColumn: "1 / -1" }}>{flashEl}<EstadoResultadosCampo nombre={nombre ?? "Transporte y Cosechadora"} onError={(m) => notify(m, "err")} /></div></section>;
  }

  if (section === "reportes") {
    return <section className="panelGrid">{flashEl}<ReportesView onError={(m) => notify(m, "err")} /></section>;
  }

  // 🔎 ¿Cuándo se hizo?: reparaciones/cambios/compras de SU flota y SU caja
  // (independiente del buscador de la Matriz).
  if (section === "historial") {
    return <section className="panelGrid">{flashEl}<BuscadorHistorial ambito="transporte" titulo={nombre ?? "Transporte y Cosechadora"} /></section>;
  }

  if (section === "clientes") {
    return <section className="panelGrid">{flashEl}<ClientesView nombreOperacion={nombre ?? "Campo"} matrizName={matrizName} onNotify={notify} onError={(m) => notify(m, "err")} /></section>;
  }

  if (section === "cxc") {
    return <section className="panelGrid">{flashEl}<CxCView nombreOperacion={nombre ?? "Campo"} matrizName={matrizName} onNotify={notify} onError={(m) => notify(m, "err")} /></section>;
  }

  if (section === "cxp") {
    return <section className="panelGrid">{flashEl}<CxPView onNotify={notify} onError={(m) => notify(m, "err")} /></section>;
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
        <TarifasOperadorCatalogo activos={activos} operadores={operadores}
          onChanged={(msg) => notify(msg)}
          onError={(m) => notify(m, "err")} />
      </section>
    );
  }

  if (section === "servicios") {
    return (
      <section className="panelGrid">
        <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>🚜 Servicios <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· cosecha y flete</span></h2>
            <div className="segmented">
              {([["servicio", "Nuevo servicio"], ["abono", "Abono"], ["lista", "Lista"]] as Array<["servicio" | "abono" | "lista", string]>).map(([v, label]) => (
                <button key={v} type="button" className={servTab === v ? "active" : ""} onClick={() => setServTab(v)}>{label}</button>
              ))}
            </div>
          </div>
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

  if (section === "nomina") {
    return <NominaOperadores />;
  }

  if (section === "mantenimiento") {
    return (
      <section className="panelGrid">
        {flashEl}
        <MantenimientoFlota activos={activos} cuentas={cuentas.filter((c) => c.nombre !== "CRUCE PILADORA")}
          onSaved={() => onCajaSaved("Mantenimiento registrado en la hoja de vida")}
          onError={(m) => notify(m, "err")} />
      </section>
    );
  }

  // section === "caja" · mismo formato que la Caja Principal (cj-*): encabezado,
  // tarjetas de saldo, barra de acciones y luego el formulario y el libro.
  const cajaAbierta = !!sesion?.activa;
  const arqueo = sesion?.activa?.arqueo;
  const accionesCaja: Array<["ingreso" | "egreso" | "transferencia", string]> = [["ingreso", "➕ Ingreso"], ["egreso", "➖ Egreso"], ["transferencia", "⇄ Transferencia"]];
  return (
    <section className="panelGrid">
      <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
        {/* Encabezado */}
        <div className="cj-head">
          <div>
            <h2 className="cj-title">💰 Caja · {nombre ?? "Transporte y Cosechadora"}</h2>
            <p className="cj-sub">
              {cajaAbierta
                ? <><span className="cj-live" /> Caja abierta por {sesion!.activa!.usuario_nombre ?? "—"} · desde {new Date(sesion!.activa!.fecha_apertura).toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</>
                : <><span className="cj-live cj-live--off" /> Caja cerrada · ábrela para registrar ingresos y egresos en efectivo</>}
            </p>
          </div>
          {!cajaAbierta && <button type="button" className="cj-btn cj-btn--primary" onClick={() => setModalCaja("abrir")}>🔓 Abrir caja</button>}
        </div>

        <AlertasCampo onIr={onIrSeccion} version={libroVersion} />

        {/* Tarjetas de saldo */}
        <div className="cj-kpis">
          <div className="cj-kpi cj-kpi--hero">
            <div className="cj-kpi-label">Disponible</div>
            <div className="cj-kpi-value">{money(totalDisponible)}</div>
            <div className="cj-kpi-hint">Caja + bancos + otros (sin el cruce interno)</div>
          </div>
          <div className="cj-kpi">
            <div className="cj-kpi-label"><span className="cj-ico cj-ico--in">⬆</span>Ingresos</div>
            <div className="cj-kpi-value cj-pos">+{money(arqueo?.ingresos ?? 0)}</div>
            <div className="cj-kpi-hint">{cajaAbierta ? "Entradas en efectivo de la sesión" : "Sin sesión abierta"}</div>
          </div>
          <div className="cj-kpi">
            <div className="cj-kpi-label"><span className="cj-ico cj-ico--out">⬇</span>Egresos</div>
            <div className="cj-kpi-value cj-neg">-{money(arqueo?.egresos ?? 0)}</div>
            <div className="cj-kpi-hint">{cajaAbierta ? "Salidas en efectivo de la sesión" : "Sin sesión abierta"}</div>
          </div>
          <div className="cj-kpi">
            <div className="cj-kpi-label"><span className="cj-ico cj-ico--base">◎</span>Saldos por cuenta</div>
            <div className="cj-kpi-value">{money(arqueo?.saldo_inicial ?? 0)}</div>
            <div className="cj-kpi-hint">Saldo inicial de la caja</div>
            <div className="cj-kpi-split">
              {cuentas.map((c) => (
                <span key={c.id}>{c.nombre === "CAJA" ? "💵" : c.nombre === "BANCO" ? "🏦" : c.nombre === "CRUCE PILADORA" ? "🔁" : "📁"} {c.nombre} <b className={c.saldo < 0 ? "cj-neg" : undefined}>{money(c.saldo)}</b></span>
              ))}
            </div>
          </div>
        </div>

        {/* Barra de acciones */}
        <div className="cj-toolbar">
          <div className="cj-toolbar-group">
            {accionesCaja.map(([v, label]) => (
              <button key={v} type="button" className={`cj-btn ${v === "ingreso" ? "cj-btn--primary" : ""} ${cajaTab === v ? "is-on is-open" : ""}`} onClick={() => setCajaTab(v)}>{label}</button>
            ))}
            {cajaTab === "cierres" && <button type="button" className="cj-btn cj-btn--ghost" onClick={() => setCajaTab("ingreso")}>📋 Ver movimientos</button>}
          </div>
          <div className="cj-toolbar-group">
            {onIrSeccion && <button type="button" className="cj-btn" onClick={() => onIrSeccion("resultados")}>📈 Estado de resultados</button>}
            <div className="cj-dd">
              <button type="button" className={`cj-btn ${menuCaja ? "is-open" : ""}`} aria-haspopup="menu" aria-expanded={menuCaja} onClick={() => setMenuCaja((m) => !m)}>
                ⚙️ Opciones <span className="cj-caret">▾</span>
              </button>
              {menuCaja && (
                <div className="cj-menu cj-menu--right" role="menu">
                  <button type="button" role="menuitem" className={`cj-menu-item ${cajaTab === "cierres" ? "is-current" : ""}`} onClick={() => { setMenuCaja(false); setCajaTab("cierres"); }}>
                    <span className="cj-menu-ico">📋</span><span><span className="cj-menu-label">Cierres de caja</span><span className="cj-menu-hint">Historial de aperturas y arqueos</span></span>
                  </button>
                  {onIrSeccion && (
                    <button type="button" role="menuitem" className="cj-menu-item" onClick={() => { setMenuCaja(false); onIrSeccion("reportes"); }}>
                      <span className="cj-menu-ico">📊</span><span><span className="cj-menu-label">Reportes</span><span className="cj-menu-hint">Saldos, por cobrar y por máquina</span></span>
                    </button>
                  )}
                  <div className="cj-menu-sep" />
                  {cajaAbierta ? (
                    <button type="button" role="menuitem" className="cj-menu-item cj-menu-item--danger" onClick={() => { setMenuCaja(false); setModalCaja("cerrar"); }}>
                      <span className="cj-menu-ico">🔒</span><span className="cj-menu-label">Cerrar / arquear caja</span>
                    </button>
                  ) : (
                    <button type="button" role="menuitem" className="cj-menu-item" onClick={() => { setMenuCaja(false); setModalCaja("abrir"); }}>
                      <span className="cj-menu-ico">🔓</span><span className="cj-menu-label">Abrir caja</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {flashEl}
      </div>

      {cajaTab === "ingreso" && (
        <IngresoForm cuentas={cuentas}
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

      {cajaTab !== "cierres" && <LibroView cuentas={cuentas} version={libroVersion}
        onReversed={() => onCajaSaved("Movimiento reversado y registrado en el libro")}
        onError={(m) => notify(m, "err")} />}

      {modalCaja === "abrir" && (
        <AperturaCajaModal saldoSugerido={sesion?.saldo_sugerido ?? 0}
          onClose={() => setModalCaja("")}
          onDone={async () => {
            setModalCaja("");
            await Promise.all([refreshSesion(), refreshCatalogos()]);
            setLibroVersion((v) => v + 1);
            notify("Caja abierta");
          }}
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

// ── Hoja de vida de maquinaria ───────────────────────────────────────────────
const MANT_TIPOS: Array<{ id: MantenimientoTipo; label: string }> = [
  { id: "CAMBIO_ACEITE", label: "Cambio de aceite / filtros" },
  { id: "PREVENTIVO", label: "Mantenimiento preventivo" },
  { id: "CORRECTIVO", label: "Reparacion correctiva" },
  { id: "REPUESTO", label: "Cambio de pieza / repuesto" },
  { id: "LLANTAS", label: "Llantas / tren de rodaje" },
  { id: "INSPECCION", label: "Inspeccion / revision" },
  { id: "OTRO", label: "Otro" }
];
const mantTipoLabel = (tipo: MantenimientoTipo) => MANT_TIPOS.find((x) => x.id === tipo)?.label ?? tipo;

function MantenimientoFlota({ activos, cuentas, onSaved, onError }: {
  activos: Activo[]; cuentas: Cuenta[]; onSaved: OnSaved; onError: (m: string) => void;
}) {
  const vacio = {
    fecha: hoy(), activo_id: "", tipo: "CAMBIO_ACEITE" as MantenimientoTipo,
    componente: "", detalle: "", lectura: "", unidad_lectura: "HORAS" as "KM" | "HORAS",
    proxima_fecha: "", proxima_lectura: "", proveedor: "", factura: "",
    costo: "", cuenta_id: "", observaciones: ""
  };
  const [f, setF] = useState(vacio);
  const [rows, setRows] = useState<Mantenimiento[]>([]);
  const [filtroActivo, setFiltroActivo] = useState("");
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const qs = filtroActivo ? `?activo_id=${encodeURIComponent(filtroActivo)}` : "";
      setRows(await apiGet<Mantenimiento[]>(`/campo/mantenimientos${qs}`));
    } catch (e) { onError((e as Error).message); }
  }, [filtroActivo, onError]);
  useEffect(() => { cargar(); }, [cargar]);

  const vencidos = rows.filter((r) => r.estado_proximo === "VENCIDO").length;
  const proximos = rows.filter((r) => r.estado_proximo === "PROXIMO").length;
  const ultimoPorActivo = useMemo(() => {
    const m = new Map<string, Mantenimiento>();
    for (const r of rows) if (!r.anulado_at && !m.has(r.activo_id)) m.set(r.activo_id, r);
    return m;
  }, [rows]);

  async function submit() {
    try {
      setBusy(true);
      if (!f.activo_id) throw new Error("Selecciona la maquina o vehiculo");
      if (f.detalle.trim().length < 2) throw new Error("Describe el trabajo realizado");
      const costo = Number(f.costo || 0);
      if (costo > 0 && !f.cuenta_id) throw new Error("Elige la cuenta de donde se pago");
      await apiPost("/campo/mantenimientos", {
        fecha: f.fecha, activo_id: f.activo_id, tipo: f.tipo,
        componente: f.componente || undefined, detalle: f.detalle.trim(),
        lectura: f.lectura ? Number(f.lectura) : undefined,
        unidad_lectura: (f.lectura || f.proxima_lectura) ? f.unidad_lectura : undefined,
        proxima_fecha: f.proxima_fecha || undefined,
        proxima_lectura: f.proxima_lectura ? Number(f.proxima_lectura) : undefined,
        proveedor: f.proveedor.trim() || undefined, factura: f.factura.trim() || undefined,
        costo, cuenta_id: costo > 0 ? f.cuenta_id : undefined,
        observaciones: f.observaciones.trim() || undefined
      });
      setF({ ...vacio, activo_id: f.activo_id, fecha: hoy() });
      await cargar();
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  const estadoChip = (r: Mantenimiento) => {
    if (r.estado_proximo === "ANULADO") return <span className="chip bad">Anulado</span>;
    if (r.estado_proximo === "VENCIDO") return <span className="chip bad">Vencido</span>;
    if (r.estado_proximo === "PROXIMO") return <span className="chip warn">Proximo</span>;
    if (r.estado_proximo === "PROGRAMADO") return <span className="chip ok">Programado</span>;
    return <span className="chip info">Sin programar</span>;
  };

  return (
    <>
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div><h2 style={{ margin: 0 }}>🔧 Mantenimiento de flota</h2><p className="muted" style={{ margin: "3px 0 0" }}>Hoja de vida de cosechadoras, camiones y vehiculos.</p></div>
          <div className="totalBox" style={{ minWidth: 130, margin: "0 0 0 auto" }}><span>REGISTROS</span><strong>{rows.length}</strong></div>
          <div className="totalBox" style={{ minWidth: 130, margin: 0, background: vencidos ? "#fef2f2" : undefined, borderColor: vencidos ? "#fecaca" : undefined }}><span>VENCIDOS</span><strong style={{ color: vencidos ? "#b91c1c" : "#15803d" }}>{vencidos}</strong></div>
          <div className="totalBox" style={{ minWidth: 130, margin: 0, background: proximos ? "#fffbeb" : undefined, borderColor: proximos ? "#fde68a" : undefined }}><span>PROXIMOS 30 DIAS</span><strong style={{ color: proximos ? "#b45309" : "#15803d" }}>{proximos}</strong></div>
        </div>
      </div>

      <form className="formPanel" onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ alignSelf: "start" }}>
        <h2>＋ Registrar trabajo</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
          <label><span>Maquina / Vehiculo *</span><select value={f.activo_id} onChange={(e) => setF({ ...f, activo_id: e.target.value })}><option value="">Seleccione</option>{activos.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.placa_codigo ? ` · ${a.placa_codigo}` : ""}</option>)}</select></label>
        </div>
        <label><span>Tipo de trabajo</span><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as MantenimientoTipo })}>{MANT_TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        <label><span>Pieza / Sistema</span><select value={f.componente} onChange={(e) => setF({ ...f, componente: e.target.value })}><option value="">Seleccione (opcional)</option>{PIEZAS_MANT.map((g) => <optgroup key={g.grupo} label={g.grupo}>{g.items.map((it) => <option key={it}>{it}</option>)}</optgroup>)}</select></label>
        <label><span>Trabajo realizado *</span><textarea value={f.detalle} onChange={(e) => setF({ ...f, detalle: e.target.value })} placeholder="Ej: Cambio de aceite 15W-40 y filtros" rows={2} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
          <label><span>Lectura actual</span><input type="number" min="0" step="0.01" value={f.lectura} onChange={(e) => setF({ ...f, lectura: e.target.value })} placeholder="Horometro o kilometraje" /></label>
          <label><span>Unidad</span><select value={f.unidad_lectura} onChange={(e) => setF({ ...f, unidad_lectura: e.target.value as "KM" | "HORAS" })}><option>HORAS</option><option>KM</option></select></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Proximo por fecha</span><input type="date" value={f.proxima_fecha} onChange={(e) => setF({ ...f, proxima_fecha: e.target.value })} /></label>
          <label><span>Proxima lectura</span><input type="number" min="0" step="0.01" value={f.proxima_lectura} onChange={(e) => setF({ ...f, proxima_lectura: e.target.value })} placeholder={f.unidad_lectura} /></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Taller / Proveedor</span><input value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} /></label>
          <label><span>Factura / Comprobante</span><input value={f.factura} onChange={(e) => setF({ ...f, factura: e.target.value })} /></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label><span>Costo $</span><input type="number" min="0" step="0.01" value={f.costo} onChange={(e) => setF({ ...f, costo: e.target.value, cuenta_id: Number(e.target.value || 0) > 0 ? f.cuenta_id : "" })} placeholder="0.00" /></label>
          <label><span>Cuenta de pago</span><select disabled={!(Number(f.costo) > 0)} value={f.cuenta_id} onChange={(e) => setF({ ...f, cuenta_id: e.target.value })}><option value="">{Number(f.costo) > 0 ? "Seleccione" : "Sin costo"}</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {money(c.saldo)}</option>)}</select></label>
        </div>
        <label><span>Observaciones</span><textarea value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} rows={2} /></label>
        <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar en hoja de vida"}</button>
      </form>

      <div className="tablePanel" style={{ alignSelf: "start" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div><h2 style={{ margin: 0 }}>Ultimo trabajo por equipo</h2><small className="muted">Que se cambio, cuando y cual es el siguiente control.</small></div>
          <label style={{ margin: "0 0 0 auto", minWidth: 220 }}><span>Filtrar equipo</span><select value={filtroActivo} onChange={(e) => setFiltroActivo(e.target.value)}><option value="">Toda la flota</option>{activos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
        </div>
        <div style={{ overflowX: "auto" }}><table className="cajaTable" style={{ marginTop: 8 }}><thead><tr><th>Equipo</th><th>Ultimo trabajo</th><th>Fecha</th><th>Lectura</th><th>Proximo</th></tr></thead><tbody>
          {(filtroActivo ? activos.filter((a) => a.id === filtroActivo) : activos).map((a) => { const r = ultimoPorActivo.get(a.id); return <tr key={a.id}><td><strong>{a.nombre}</strong><small className="muted" style={{ display: "block" }}>{tipoLabel(a.tipo)}</small></td><td>{r ? r.detalle : <span className="muted">Sin historial</span>}</td><td>{r ? String(r.fecha).slice(0, 10) : "—"}</td><td>{r?.lectura != null ? `${r.lectura} ${r.unidad_lectura}` : "—"}</td><td>{r ? <>{r.proxima_fecha ? String(r.proxima_fecha).slice(0, 10) : r.proxima_lectura != null ? `${r.proxima_lectura} ${r.unidad_lectura}` : "—"} <span style={{ marginLeft: 4 }}>{estadoChip(r)}</span></> : "—"}</td></tr>; })}
        </tbody></table></div>
      </div>

      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <h2>Historial tecnico</h2>
        <div style={{ overflowX: "auto" }}><table className="cajaTable"><thead><tr><th>Fecha</th><th>Equipo</th><th>Tipo / Trabajo</th><th>Lectura</th><th>Proximo</th><th>Taller / Factura</th><th className="num">Costo</th><th>Cuenta</th></tr></thead><tbody>
          {rows.length === 0 ? <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 14 }}>Todavia no hay mantenimientos registrados.</td></tr> : rows.map((r) => <tr key={r.id}><td style={{ whiteSpace: "nowrap" }}>{String(r.fecha).slice(0, 10)}</td><td><strong>{r.activo_nombre}</strong>{r.placa_codigo && <small className="muted" style={{ display: "block" }}>{r.placa_codigo}</small>}</td><td><span className="chip info">{mantTipoLabel(r.tipo)}</span><div style={{ marginTop: 4 }}>{r.detalle}</div>{r.componente && <small className="muted">{r.componente}</small>}</td><td>{r.lectura != null ? `${r.lectura} ${r.unidad_lectura}` : "—"}</td><td>{r.proxima_fecha ? String(r.proxima_fecha).slice(0, 10) : r.proxima_lectura != null ? `${r.proxima_lectura} ${r.unidad_lectura}` : "—"}<div style={{ marginTop: 4 }}>{estadoChip(r)}</div></td><td>{r.proveedor ?? "—"}{r.factura && <small className="muted" style={{ display: "block" }}>Doc. {r.factura}</small>}</td><td className="num">{money(r.costo)}</td><td>{r.cuenta_nombre ?? "—"}</td></tr>)}
        </tbody></table></div>
      </div>
    </>
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
            <span>DISPONIBLE</span>
            <strong style={{ color: (saldo?.total_disponible ?? 0) >= 0 ? "#15803d" : "#b91c1c" }}>{num(saldo?.total_disponible ?? 0)}</strong>
            <small>sin cruce interno</small>
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
function ClientesView({ nombreOperacion, matrizName, onNotify, onError }: {
  nombreOperacion: string; matrizName: string; onNotify: (m: string, k?: "ok" | "err") => void; onError: (m: string) => void;
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
        <EstadoCuentaModal cliente={verCuenta} nombreOperacion={nombreOperacion} matrizName={matrizName}
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
                {String(p.fecha).slice(0, 10)} · {p.activo_nombre} · {p.qq.enReal()} QQ{p.origen === "bascula" ? " · ⚖️ Báscula" : ""}
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
          <input type="number" step="0.01" min="0" placeholder={aplicarDefault.enReal()} value={aplicar} onChange={(e) => setAplicar(e.target.value)} />
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
function EstadoCuentaModal({ cliente, nombreOperacion, matrizName, cajaCuenta, onAbonoRegistrado, onClose, onError }: {
  cliente: ClienteCuenta;
  nombreOperacion: string;
  matrizName: string;
  cajaCuenta?: Cuenta;
  onAbonoRegistrado?: (mensaje: string) => void | Promise<void>;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ec, setEc] = useState<EstadoCuenta | null>(null);
  const [montoAbono, setMontoAbono] = useState("");
  const [fechaAbono, setFechaAbono] = useState(hoy());
  const [cobrando, setCobrando] = useState(false);
  const cargar = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      setEc(await apiGet<EstadoCuenta>(`/campo/clientes/${cliente.id}/estado-cuenta?${qs.toString()}`));
    } catch (e) { onError((e as Error).message); }
  }, [cliente.id, from, to, onError]);
  useEffect(() => { cargar(); }, [cargar]);

  async function registrarAbono(montoSolicitado?: number) {
    try {
      setCobrando(true);
      if (!cajaCuenta) throw new Error("No existe la cuenta CAJA en Configuración.");
      const saldo = Number(ec?.saldo_final ?? cliente.saldo);
      const monto = montoSolicitado ?? Number(montoAbono);
      if (!(monto > 0)) throw new Error("Indica el valor del abono.");
      if (monto > saldo + 0.005) throw new Error(`El abono no puede superar el saldo de ${money(saldo)}.`);
      const r = await apiPost<{ aplicado: number; servicios_afectados: number }>("/campo/cxc/abono", {
        cliente_id: cliente.id,
        monto,
        cuenta_id: cajaCuenta.id,
        fecha: fechaAbono,
        concepto: `Cobro CxC de ${cliente.nombre}`
      });
      setMontoAbono("");
      await cargar();
      await onAbonoRegistrado?.(`Ingresaron ${money(r.aplicado)} a CAJA y se aplicaron a ${r.servicios_afectados} cargo(s).`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setCobrando(false);
    }
  }

  function imprimir() {
    if (!ec) return;
    const filas = ec.lineas.map((l) => `<tr>
      <td>${String(l.fecha).slice(0, 10)}</td>
      <td>${l.detalle}${l.cuenta ? ` (${l.cuenta})` : ""}</td>
      <td>${l.maquina ?? ""}</td>
      <td style="text-align:right">${l.qq != null ? l.qq : ""}</td>
      <td style="text-align:right">${l.debe ? l.debe.enReal() : ""}</td>
      <td style="text-align:right;color:#15803d">${l.haber ? l.haber.enReal() : ""}</td>
      <td style="text-align:right;font-weight:700">${l.saldo.enReal()}</td></tr>`).join("");
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
          <div><h1>${nombreOperacion} · ${matrizName}</h1><div class="muted">Estado de Cuenta de Cliente</div></div>
          <div class="box"><div class="muted">SALDO ACTUAL</div><div style="font-size:18px;font-weight:700">$ ${ec.saldo_final.enReal()}</div></div>
        </div>
        <div><strong>${cliente.nombre}</strong> ${cliente.identificacion ? `· ${cliente.identificacion}` : ""}</div>
        <div class="muted">Período: ${ec.periodo.from} a ${ec.periodo.to} · Emitido: ${new Date().toLocaleDateString("es-EC")}</div>
        <table>
          <thead><tr><th>Fecha</th><th>Detalle</th><th>Máquina</th><th style="text-align:right">QQ</th><th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th style="text-align:right">Saldo</th></tr></thead>
          <tbody>
            <tr><td colspan="6" class="muted">Saldo anterior</td><td style="text-align:right;font-weight:700">${ec.saldo_apertura.enReal()}</td></tr>
            ${filas}
            <tr class="tot"><td colspan="4">TOTALES DEL PERÍODO</td><td style="text-align:right">${ec.total_debe.enReal()}</td><td style="text-align:right">${ec.total_haber.enReal()}</td><td style="text-align:right">${ec.saldo_final.enReal()}</td></tr>
          </tbody>
        </table>
        <p class="muted" style="margin-top:14px">Debe = servicios de cosecha/flete · Haber = abonos recibidos.</p>
      </body></html>`);
    w.document.close(); w.focus(); w.print();
  }

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.62)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div className="tablePanel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1120, width: "100%", height: "calc(100vh - 32px)", maxHeight: 860, margin: 0, padding: 0, overflow: "hidden", borderRadius: 12 }}>
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--c-border)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: "#fff" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Estado de cuenta</h2>
            <div style={{ fontWeight: 750, marginTop: 3 }}>{cliente.nombre}</div>
            <small className="muted">{cliente.identificacion || "Sin identificación"} · {nombreOperacion} · {matrizName}</small>
          </div>
          <button type="button" className="btnSecondary" style={{ marginLeft: "auto" }} onClick={imprimir}>🖨️ Imprimir / PDF</button>
          <button type="button" onClick={onClose} aria-label="Cerrar estado de cuenta" style={{ minWidth: 40, fontSize: 18 }}>×</button>
        </div>

        <div style={{ padding: "16px 20px 20px", overflowY: "auto", minHeight: 0, flex: "1 1 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
            <div style={{ border: "1px solid #dbeafe", background: "#eff6ff", borderRadius: 8, padding: "10px 12px" }}><small className="muted">CARGOS</small><strong style={{ display: "block", fontSize: 20 }}>{money(ec?.total_debe ?? 0)}</strong></div>
            <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 8, padding: "10px 12px" }}><small className="muted">ABONADO</small><strong style={{ display: "block", fontSize: 20, color: "#15803d" }}>{money(ec?.total_haber ?? 0)}</strong></div>
            <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 8, padding: "10px 12px" }}><small className="muted">SALDO PENDIENTE</small><strong style={{ display: "block", fontSize: 22, color: "#b45309" }}>{money(ec?.saldo_final ?? 0)}</strong></div>
          </div>

          {cajaCuenta && onAbonoRegistrado && (ec?.saldo_final ?? cliente.saldo) > 0.005 && (
            <div style={{ border: "1px solid #bfdbfe", background: "#f8fbff", borderRadius: 8, padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <div><strong>Registrar cobro</strong><small className="muted" style={{ display: "block" }}>El dinero ingresará directamente a <b>CAJA</b>.</small></div>
                <span className="chip ok">CAJA · {money(cajaCuenta.saldo)}</span>
              </div>
              <div className="cxcCobroGrid">
                <label style={{ margin: 0 }}><span>Monto del abono</span><input type="number" min="0.01" step="0.01" value={montoAbono} onChange={(e) => setMontoAbono(e.target.value)} placeholder="0.00" /></label>
                <label style={{ margin: 0 }}><span>Fecha</span><input type="date" value={fechaAbono} onChange={(e) => setFechaAbono(e.target.value)} /></label>
                <button type="button" className="primary" disabled={cobrando || !(Number(montoAbono) > 0)} onClick={() => { void registrarAbono(); }}>{cobrando ? "Registrando…" : "Registrar abono"}</button>
                <button type="button" disabled={cobrando} onClick={() => { void registrarAbono(Number(ec?.saldo_final ?? cliente.saldo)); }}>Cobrar saldo completo</button>
              </div>
            </div>
          )}

          {cajaCuenta && onAbonoRegistrado && (ec?.saldo_final ?? 0) <= 0.005 && (
            <div style={{ padding: 12, marginBottom: 14, border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 8, color: "#15803d", fontWeight: 700 }}>Cuenta pagada completamente.</div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
            <strong style={{ marginRight: "auto" }}>Movimientos</strong>
            <label style={{ margin: 0 }}><span>Desde</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label style={{ margin: 0 }}><span>Hasta</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div style={{ overflowX: "auto", border: "1px solid var(--c-border)", borderRadius: 8 }}>
          <table className="cajaTable" style={{ marginTop: 8 }}>
            <thead><tr><th>Fecha</th><th>Detalle</th><th>Máquina</th><th className="num">QQ</th><th className="num">Debe</th><th className="num">Haber</th><th className="num">Saldo</th></tr></thead>
            <tbody>
              <tr><td colSpan={6} className="muted">Saldo anterior</td><td className="num" style={{ fontWeight: 700 }}>{money(ec?.saldo_apertura ?? 0)}</td></tr>
              {(ec?.lineas ?? []).map((l, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{String(l.fecha).slice(0, 10)}</td>
                  <td style={{ minWidth: 320, whiteSpace: "normal", lineHeight: 1.35 }}>{l.detalle}{l.cuenta ? <small className="muted"> · {l.cuenta}</small> : null}{l.clase === "abono" ? <span className="chip ok" style={{ marginLeft: 6 }}>abono</span> : null}</td>
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
    </div>,
    document.body
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

// ＋ INGRESO: entrada manual o de contado a una cuenta (p. ej. flete externo fuera
// de báscula). Los servicios operativos se cobran desde Cuentas por Cobrar, así
// que aquí el ingreso es siempre suelto (servicio_id: null).
function IngresoForm({ cuentas, onSaved, onError }: {
  cuentas: Cuenta[]; onSaved: OnSaved; onError: (m: string) => void;
}) {
  // Concepto = base (predefinido, opcional) + detalle extra. Si no hay base, el
  // detalle ES el concepto escrito a mano ("Escribir concepto manualmente…").
  const [f, setF] = useState({ fecha: hoy(), cuenta_id: "", monto: "", concepto_base: CONCEPTO_INGRESO_PRINCIPAL, concepto_extra: "" });
  const [busy, setBusy] = useState(false);
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
        concepto: conceptoFinal || undefined,
        servicio_id: null   // ingreso suelto: los servicios se cobran en Cuentas por Cobrar
      });
      setF({ ...f, monto: "", concepto_base: CONCEPTO_INGRESO_PRINCIPAL, concepto_extra: "" });
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
          placeholder={f.concepto_base ? "Ej: cliente o ruta del flete" : "Ej: Venta de chatarra"} />
      </label>
      {conceptoFinal && <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>Concepto: <strong>{conceptoFinal}</strong></p>}
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Registrar ingreso"}</button>
    </form>
  );
}

// － EGRESO (sistema de registro de mantenimiento y consumo, sensible a la máquina):
//  1 · Máquina / Vehículo (primero: define la familia → unidad de desgaste y repuestos afines).
//  2 · Fecha + Categoría.
//  3 · Horómetro / Kilometraje (opcional) con DIESEL, GASOLINA o REPARACION_MANT.
//  4 · REPARACION_MANT → «Detalle de Intervención» (tipo, repuesto/trabajo, descripción)
//      en vez del Concepto; se guarda como mantenimiento (hoja de vida + egreso).
//  5 · «Detalles de Pago»: monto, proveedor, contado/crédito, cuenta y rendir cuentas.
function EgresoForm({ cuentas, categorias, activos, onSaved, onError }: {
  cuentas: Cuenta[]; categorias: Categoria[]; activos: Activo[]; onSaved: OnSaved; onError: (m: string) => void;
}) {
  const [f, setF] = useState({
    fecha: hoy(), activo_sel: ACTIVO_GENERAL, categoria_id: "", concepto: "", monto: "", cuenta_id: "", es_anticipo: false,
    // Desgaste de la máquina (opcional): lectura y su unidad ("" = la de la familia).
    lectura: "", unidad: "" as "" | "KM" | "HORAS",
    // Solo REPARACION_MANT: tipo de mantenimiento, repuesto/trabajo y descripción.
    tipo_mant: "CORRECTIVO" as "PREVENTIVO" | "CORRECTIVO", repuesto: "", descripcion: "",
    // Proveedor y modalidad: Contado (sale de la cuenta) / A crédito (CxP de Transporte).
    proveedor: "", modalidad: "CONTADO" as "CONTADO" | "CREDITO", vence: ""
  });
  const [busy, setBusy] = useState(false);
  // Sugerencias de proveedor: catálogo de Proveedores + acreedores ya usados en CxP.
  const [proveedores, setProveedores] = useState<string[]>([]);
  useEffect(() => {
    Promise.all([
      apiGet<Array<{ name: string }>>("/suppliers").catch(() => [] as Array<{ name: string }>),
      apiGet<{ cuentas: Array<{ acreedor: string }> }>("/campo/cxp").catch(() => ({ cuentas: [] as Array<{ acreedor: string }> }))
    ]).then(([sup, cxp]) => {
      const set = new Map<string, string>();
      for (const n of [...sup.map((x) => x.name), ...cxp.cuentas.map((x) => x.acreedor)]) {
        const t = (n ?? "").trim(); if (t) set.set(t.toUpperCase(), t);
      }
      setProveedores([...set.values()].sort((a, b) => a.localeCompare(b)));
    });
  }, []);
  const catNombre = (categorias.find((c) => c.id === f.categoria_id)?.nombre ?? "").trim().toUpperCase();
  const esReparacion = catNombre === REPARACION_MANT;
  const activoSel = f.activo_sel === ACTIVO_GENERAL ? undefined : activos.find((a) => a.id === f.activo_sel);
  const familia = familiaDe(activoSel);
  const info = FAMILIA_INFO[familia];
  const pideLectura = CATEGORIAS_CON_LECTURA.includes(catNombre);
  const mostrarLectura = pideLectura && !!activoSel;
  const unidad: "KM" | "HORAS" = f.unidad || info.unidad;
  const opcionesRep = useMemo(() => opcionesRepuesto(familia), [familia]);
  const aCredito = f.modalidad === "CREDITO" && !f.es_anticipo && !esReparacion;

  // Última lectura conocida de la máquina (referencia y aviso si la nueva es menor).
  const [ultima, setUltima] = useState<{ lectura: number; unidad_lectura: "KM" | "HORAS"; fecha: string } | null>(null);
  useEffect(() => {
    setUltima(null);
    if (!mostrarLectura || !activoSel) return;
    let vivo = true;
    apiGet<{ lectura: number; unidad_lectura: "KM" | "HORAS"; fecha: string } | null>(`/campo/lecturas/ultima?activo_id=${activoSel.id}`)
      .then((r) => { if (vivo) setUltima(r); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [mostrarLectura, activoSel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lecturaN = f.lectura.trim() === "" ? null : Number(f.lectura);
  const lecturaMenor = lecturaN != null && ultima != null && ultima.unidad_lectura === unidad && lecturaN < ultima.lectura;

  async function submit() {
    try {
      setBusy(true);
      if (!f.activo_sel) throw new Error("Elige la máquina/vehículo o Gastos Generales");
      if (!f.categoria_id) throw new Error("La categoría del gasto es obligatoria");
      if (aCredito && f.proveedor.trim().length < 2) throw new Error("Para un egreso a crédito indica el proveedor");
      if (!aCredito && !f.cuenta_id) throw new Error("Elige la cuenta");
      const monto = Number(f.monto);
      if (!(monto > 0)) throw new Error("Ingresa un monto válido");
      // Lectura: solo con las categorías que la piden y una máquina elegida.
      const lectura = mostrarLectura && lecturaN != null ? lecturaN : null;
      if (lectura != null && !(lectura >= 0)) throw new Error("El horómetro / kilometraje debe ser un número positivo");
      if (esReparacion) {
        if (!activoSel) throw new Error("Selecciona la maquina o vehiculo que recibio el mantenimiento");
        if (f.es_anticipo) throw new Error("Registra el anticipo primero y el mantenimiento cuando se rinda el gasto real");
        const repuesto = f.repuesto.trim();
        if (repuesto.length < 2) throw new Error("Elige o escribe el repuesto / trabajo realizado");
        // Un preventivo de aceite o filtros queda como «Cambio de aceite / filtros».
        const tipo: MantenimientoTipo = f.tipo_mant === "PREVENTIVO" && /aceite|filtro/i.test(repuesto) ? "CAMBIO_ACEITE" : f.tipo_mant;
        await apiPost("/campo/mantenimientos", {
          fecha: f.fecha, activo_id: activoSel.id, tipo,
          componente: repuesto, detalle: [repuesto, f.descripcion.trim()].filter(Boolean).join(" - ").slice(0, 1000),
          lectura: lectura ?? undefined, unidad_lectura: lectura != null ? unidad : undefined,
          proveedor: f.proveedor.trim() || undefined,
          costo: monto, cuenta_id: f.cuenta_id,
          observaciones: f.descripcion.trim() || undefined
        });
      } else {
        await apiPost("/campo/movimientos", {
          fecha: f.fecha, cuenta_id: aCredito ? undefined : f.cuenta_id, signo: "salida", monto,
          concepto: f.concepto.trim() || undefined, categoria_id: f.categoria_id,
          activo_id: activoSel?.id,
          es_anticipo: f.es_anticipo || undefined,
          proveedor: f.proveedor.trim() || undefined,
          modalidad_pago: aCredito ? "CREDITO" : "CONTADO",
          vence: aCredito && f.vence ? f.vence : undefined,
          lectura: lectura ?? undefined, unidad_lectura: lectura != null ? unidad : undefined
        });
      }
      setF({ ...f, concepto: "", monto: "", categoria_id: "", es_anticipo: false, lectura: "", unidad: "",
        tipo_mant: "CORRECTIVO", repuesto: "", descripcion: "", proveedor: "", modalidad: "CONTADO", vence: "" });
      await onSaved();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  const req = <span style={{ color: "#ef4444" }}>*</span>;
  const iconoTipo = (a: Activo) => FAMILIA_INFO[familiaDe(a)].icono;
  const num = (n: number) => n.toLocaleString("es-EC", { maximumFractionDigits: 2 });
  return (
    <form className="formPanel egresoCampo" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2>－ Nuevo egreso (gasto)</h2>
      {/* 1 · Máquina / Vehículo (primera fila; default = Gastos Generales) */}
      <label><span>Asignar a Máquina / Vehículo {req}</span>
        <select value={f.activo_sel} onChange={(e) => setF({ ...f, activo_sel: e.target.value, lectura: "", unidad: "" })}>
          <option value={ACTIVO_GENERAL}>🏢 Gastos Generales / Administración</option>
          {activos.map((a) => <option key={a.id} value={a.id}>{iconoTipo(a)} {a.nombre} · {tipoLabel(a.tipo)}{a.placa_codigo ? ` · ${a.placa_codigo}` : ""}</option>)}
        </select>
        {activoSel && <small className="egresoCampo__familia">{info.icono} {info.label}</small>}
      </label>
      {/* 2 · Fecha + Categoría */}
      <div className="egresoCampo__fila">
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>Categoría {req}</span>
          <select value={f.categoria_id} onChange={(e) => setF({ ...f, categoria_id: e.target.value })}>
            <option value="">Seleccione</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>
      {/* 3 · Control de desgaste: horómetro / kilometraje (DIESEL, GASOLINA, REPARACION_MANT) */}
      {pideLectura && (mostrarLectura ? (
        <div className="egresoCampo__lectura">
          <label><span>Horómetro / Kilometraje actual <span className="muted" style={{ fontWeight: 400 }}>(Opcional)</span></span>
            <span className="egresoCampo__lecturaFila">
              <input type="number" min="0" step="0.1" value={f.lectura} onChange={(e) => setF({ ...f, lectura: e.target.value })}
                placeholder={unidad === "HORAS" ? "Ej: 1250 (horas)" : "Ej: 85400 (km)"} />
              <select value={unidad} aria-label="Unidad" onChange={(e) => setF({ ...f, unidad: e.target.value as "KM" | "HORAS" })}>
                <option value="HORAS">Horas</option>
                <option value="KM">Km</option>
              </select>
            </span>
          </label>
          {ultima && <small className="muted">Última registrada: <strong>{num(ultima.lectura)} {ultima.unidad_lectura === "HORAS" ? "h" : "km"}</strong> el {String(ultima.fecha).slice(0, 10).split("-").reverse().join("/")}</small>}
          {lecturaMenor && <small className="egresoCampo__aviso">⚠️ Es menor que la última lectura registrada: revisa el número.</small>}
        </div>
      ) : (
        <p className="muted" style={{ margin: "-4px 0 8px", fontSize: 12 }}>Elige la máquina o vehículo para anotar su horómetro / kilometraje.</p>
      ))}
      {/* 4 · REPARACION_MANT: Detalle de Intervención (reemplaza al Concepto). Otras: Concepto. */}
      {esReparacion ? (
        <fieldset className="egresoCampo__intervencion">
          <legend>🔧 Detalle de Intervención</legend>
          <label><span>Tipo de Mantenimiento</span>
            <select value={f.tipo_mant} onChange={(e) => setF({ ...f, tipo_mant: e.target.value as "PREVENTIVO" | "CORRECTIVO" })}>
              <option value="PREVENTIVO">Preventivo</option>
              <option value="CORRECTIVO">Correctivo</option>
            </select>
          </label>
          <label><span>Repuesto / Trabajo Realizado {req}{activoSel && familia !== "general" && <span className="muted" style={{ fontWeight: 400 }}> · primero los afines a {familia === "cosechadora" ? "cosechadora" : `vehículo ${familia}`}</span>}</span>
            {f.repuesto ? (
              <span className="egresoCampo__elegido">
                <strong>🔩 {f.repuesto}</strong>
                <button type="button" className="mantLink" onClick={() => setF({ ...f, repuesto: "" })}>Cambiar</button>
              </span>
            ) : (
              <BuscadorCombo id="campoRepuesto" placeholder="🔍 Buscar repuesto o trabajo (bandas, rodamientos, aceite…)"
                opciones={opcionesRep} max={12}
                onElegir={(k) => setF({ ...f, repuesto: k })}
                crear={(t) => (opcionesRep.some((o) => o.titulo.toLowerCase() === t.toLowerCase()) ? null : `Usar «${t}»`)}
                onCrear={(t) => setF({ ...f, repuesto: t.replace(/\s+/g, " ").trim() })}
                vacio="Sin coincidencias: escríbelo y elige «Usar…»" />
            )}
          </label>
          <label><span>Descripción adicional <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></span>
            <textarea rows={2} value={f.descripcion} maxLength={600} onChange={(e) => setF({ ...f, descripcion: e.target.value })}
              placeholder="Ej: se cambiaron 2 bandas del ventilador, venían cuarteadas" />
          </label>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Se registra una sola vez aquí: queda en la hoja de vida de la máquina y en <strong>Caja principal → Mantenimiento</strong>.</p>
        </fieldset>
      ) : (
        <label><span>Concepto</span>
          <input type="text" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} placeholder="Ej: Diésel cosechadora" />
        </label>
      )}
      {/* 5 · Detalles de Pago (monto, proveedor, contado/crédito, cuenta y rendir cuentas) */}
      <section className="egresoCampo__pago" aria-label="Detalles de Pago">
        <div className="egresoCampo__pagoTitulo">💳 Detalles de Pago</div>
        <label><span>Monto $ {req}</span><input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" /></label>
        {(() => {
          const creditoPosible = !f.es_anticipo && !esReparacion;
          const opt = (valor: "CONTADO" | "CREDITO", titulo: string, sub: string) => (
            <label style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 8, margin: 0,
              cursor: valor === "CREDITO" && !creditoPosible ? "not-allowed" : "pointer", opacity: valor === "CREDITO" && !creditoPosible ? 0.5 : 1,
              border: `1.5px solid ${f.modalidad === valor ? (valor === "CREDITO" ? "#7c3aed" : "#16a34a") : "#e5e7eb"}`,
              background: f.modalidad === valor ? (valor === "CREDITO" ? "#f5f3ff" : "#f0fdf4") : "#fff" }}>
              <input type="radio" checked={f.modalidad === valor} disabled={valor === "CREDITO" && !creditoPosible}
                onChange={() => setF({ ...f, modalidad: valor })} style={{ width: "auto", marginTop: 2 }} />
              <span><strong style={{ fontSize: 13 }}>{titulo}</strong><small className="muted" style={{ display: "block", fontSize: 11 }}>{sub}</small></span>
            </label>
          );
          return (
            <>
              <label style={{ margin: 0 }}><span>🏪 Proveedor {aCredito ? req : <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span>}</span>
                <input list="campoProveedoresList" value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })}
                  placeholder="Taller, gasolinera, repuestera…" />
                <datalist id="campoProveedoresList">{proveedores.map((n) => <option key={n} value={n} />)}</datalist>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {opt("CONTADO", "💵 Contado", "Sale de la cuenta ahora")}
                {opt("CREDITO", "💳 A crédito", creditoPosible ? "Queda en Cuentas por Pagar" : f.es_anticipo ? "No aplica a un anticipo" : "No aplica a reparación")}
              </div>
              {aCredito && (
                <>
                  <label style={{ margin: 0 }}><span>Vence el <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></span>
                    <input type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} />
                  </label>
                  <small style={{ color: "#6d28d9" }}>💳 No sale de ninguna cuenta: se crea una Cuenta por Pagar al proveedor (📤 Cuentas por Pagar). Al pagarla, el egreso lleva esta categoría y máquina.</small>
                </>
              )}
            </>
          );
        })()}
        {/* Cuenta (no aplica a crédito) */}
        {!aCredito && (
          <label style={{ margin: 0 }}><span>Cuenta (sale de) {req}</span>
            <select value={f.cuenta_id} onChange={(e) => setF({ ...f, cuenta_id: e.target.value })}>
              <option value="">Seleccione</option>
              {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        )}
        {/* Rendir cuentas: dinero entregado por rendir (vale de anticipo) */}
        <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, cursor: "pointer", margin: 0 }}>
          <input type="checkbox" checked={f.es_anticipo} onChange={(e) => setF({ ...f, es_anticipo: e.target.checked, modalidad: e.target.checked ? "CONTADO" : f.modalidad })} style={{ width: "auto" }} />
          <span style={{ margin: 0 }}>Rendir cuentas · dinero entregado por rendir (Anticipo)</span>
        </label>
        {f.es_anticipo && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Se guardará como <strong>vale pendiente</strong>. Podrás liquidarlo en 📋 Vales / Anticipos.</p>}
      </section>
      <button className="primary" disabled={busy}>{busy ? "Guardando…" : f.es_anticipo ? "Registrar anticipo" : aCredito ? "Registrar egreso a crédito" : "Registrar egreso"}</button>
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

  async function anularVale(v: Vale) {
    const motivo = window.prompt(`Anular el vale de ${money(v.entregado)}${v.concepto ? ` (${v.concepto})` : ""}.

El dinero vuelve a ${v.cuenta_nombre} y el vale desaparece de pendientes. Úsalo solo si se entregó mal; si ya gastaron algo, mejor «Liquidar / Rendir».

Motivo (obligatorio):`, "");
    if (motivo === null) return;
    if (motivo.trim().length < 5) { onError("Escribe el motivo (mínimo 5 letras)."); return; }
    try {
      await apiPost(`/campo/movimientos/${v.id}/anular-vale`, { motivo: motivo.trim() });
      await cargar();
      await onLiquidated();
    } catch (e) { onError((e as Error).message); }
  }

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
                    ? <>
                        <button type="button" className="primary" onClick={() => setLiquidando(v)}>🧾 Liquidar / Rendir</button>{" "}
                        <button type="button" title="Si el vale se entregó mal (monto o persona equivocados), devuelve el dinero a la cuenta" onClick={() => anularVale(v)}>↩ Anular</button>
                      </>
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
type LibroRow = {
  id: string; fecha: string; concepto: string | null; cuenta_nombre: string;
  proveedor?: string | null;
  categoria_nombre: string | null; activo_nombre: string | null; naturaleza: string;
  estado: string | null; entrada: number; salida: number; saldo_corrido: number;
  movimiento_origen_id: string | null; motivo_reversion: string | null;
  reversado_at: string | null; reversible: boolean;
};
function LibroView({ cuentas, version, onReversed, onError }: {
  cuentas: Cuenta[]; version: number; onReversed: OnSaved; onError: (m: string) => void;
}) {
  const [filtro, setFiltro] = useState({ cuenta_id: "", from: "", to: "" });
  const [rows, setRows] = useState<LibroRow[]>([]);
  const [reversando, setReversando] = useState<string | null>(null);
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

  async function reversar(row: LibroRow) {
    const motivo = window.prompt(`Motivo de la reversion\n\n${row.concepto || "Movimiento sin concepto"}`)?.trim();
    if (!motivo) return;
    if (motivo.length < 5) { onError("Escribe un motivo de al menos 5 caracteres"); return; }
    if (!window.confirm("Se creara un movimiento contrario. El original no se borrara. ¿Continuar?")) return;
    try {
      setReversando(row.id);
      await apiPost(`/campo/movimientos/${row.id}/reversar`, { motivo });
      await onReversed();
      await cargar();
    } catch (e) { onError((e as Error).message); } finally { setReversando(null); }
  }

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
            <th className="num">Entrada</th><th className="num">Salida</th><th className="num">Saldo</th><th>Accion</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin movimientos.</td></tr>
              : rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{String(r.fecha).slice(0, 10)}</td>
                <td>
                  {r.concepto || "—"}
                  {r.activo_nombre ? <span className="chip" style={{ marginLeft: 6, background: "#065f46", color: "#fff" }}>🚜 {r.activo_nombre}</span> : null}
                  {r.proveedor ? <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>🏪 {r.proveedor} · 💵 Contado</div> : null}
                  {r.naturaleza === "transferencia" ? <span className="chip info" style={{ marginLeft: 6 }}>transfer.</span> : null}
                  {r.naturaleza === "ajuste_vale" ? <span className="chip info" style={{ marginLeft: 6 }}>ajuste vale</span> : null}
                  {r.naturaleza.startsWith("reversion_") ? <span className="chip warn" style={{ marginLeft: 6 }}>reversion</span> : null}
                  {r.reversado_at ? <span className="chip bad" style={{ marginLeft: 6 }}>reversado</span> : null}
                  {r.estado === "PENDIENTE_RENDICION" ? <span className="chip warn" style={{ marginLeft: 6 }}>📋 por rendir</span> : null}
                  {r.estado === "LIQUIDADO" ? <span className="chip ok" style={{ marginLeft: 6 }}>vale liquidado</span> : null}
                  {r.motivo_reversion ? <small className="muted" style={{ display: "block", marginTop: 3 }}>Motivo: {r.motivo_reversion}</small> : null}
                </td>
                <td>{r.categoria_nombre || "—"}</td>
                <td>{r.cuenta_nombre}</td>
                <td className="num" style={{ color: r.entrada > 0 ? "#15803d" : undefined }}>{r.entrada > 0 ? money(r.entrada) : "—"}</td>
                <td className="num" style={{ color: r.salida > 0 ? "#b91c1c" : undefined }}>{r.salida > 0 ? money(r.salida) : "—"}</td>
                <td className="num" style={{ fontWeight: 700, color: r.saldo_corrido < 0 ? "#b91c1c" : undefined }}>{money(r.saldo_corrido)}</td>
                <td>{r.reversible ? <button type="button" className="btnSecondary" disabled={reversando === r.id} onClick={() => reversar(r)}>{reversando === r.id ? "Reversando…" : "↩ Reversar"}</button> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Cada fila muestra el saldo corrido de su propia cuenta. Reversar crea un asiento contrario y conserva el original para auditoria.</p>
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

// ── 📥 Cuentas por Cobrar (Transporte): lee los saldos de campo_servicios ─────
// (misma fuente única que Clientes/Reportes → cero doble contabilidad) y permite
// registrar un abono directo del agricultor que se reparte FIFO entre sus servicios.
function CxCView({ nombreOperacion, matrizName, onNotify, onError }: {
  nombreOperacion: string; matrizName: string; onNotify: (m: string, k?: "ok" | "err") => void; onError: (m: string) => void;
}) {
  const [data, setData] = useState<{ clientes: ClienteCuenta[]; total_pendiente: number } | null>(null);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [verCuenta, setVerCuenta] = useState<ClienteCuenta | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [ec, cts] = await Promise.all([
        apiGet<{ clientes: ClienteCuenta[]; total_pendiente: number }>("/campo/clientes/estado-cuenta?estado=pendiente"),
        apiGet<Cuenta[]>("/campo/cuentas")
      ]);
      setData(ec); setCuentas(cts);
    } catch (e) { onError((e as Error).message); }
  }, [onError]);
  useEffect(() => { cargar(); }, [cargar]);

  const clientes = data?.clientes ?? [];
  const cajaCuenta = cuentas.find((cuenta) => cuenta.nombre.trim().toUpperCase() === "CAJA");
  return (
    <>
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>📥 Cuentas por Cobrar <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· fletes y cosecha pendientes</span></h2>
          <div className="totalBox" style={{ minWidth: 170, margin: 0, marginLeft: "auto", background: "#fef3c7", borderColor: "#fde68a" }}>
            <span>TOTAL POR COBRAR</span>
            <strong style={{ color: "#b45309" }}>{money(data?.total_pendiente ?? 0)}</strong>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable" style={{ marginTop: 8 }}>
            <thead><tr>
              <th>Cliente</th><th className="num">Servicios</th><th className="num">Debe</th>
              <th className="num">Haber</th><th className="num">Saldo</th><th>Acciones</th>
            </tr></thead>
            <tbody>
              {clientes.length === 0 ? (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin cuentas por cobrar pendientes.</td></tr>
              ) : clientes.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.nombre}<small className="muted" style={{ display: "block" }}>{c.tipo}</small></td>
                  <td className="num">{c.servicios}</td>
                  <td className="num">{money(c.debe)}</td>
                  <td className="num" style={{ color: "#15803d" }}>{money(c.haber)}</td>
                  <td className="num" style={{ fontWeight: 700, color: c.saldo > 0.005 ? "#b45309" : "#15803d" }}>{money(c.saldo)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="primary" onClick={() => setVerCuenta(c)}>📄 Ver detalle y cobrar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Saldo = cargos de cosechadora/flete descontados en liquidaciones − abonos registrados por el socio.</p>
      </div>

      {verCuenta && (
        <EstadoCuentaModal cliente={verCuenta} nombreOperacion={nombreOperacion} matrizName={matrizName}
          cajaCuenta={cajaCuenta}
          onAbonoRegistrado={async (mensaje) => { await cargar(); onNotify(mensaje); }}
          onClose={() => setVerCuenta(null)} onError={onError} />
      )}
    </>
  );
}

// ── 📤 Cuentas por Pagar (Transporte): deudas operativas propias (CRUD) ───────
type CxP = { id: string; fecha: string; acreedor: string; concepto: string | null; monto: number; pagado: number; saldo: number; estado: "pendiente" | "pagado" };
function CxPView({ onNotify, onError }: { onNotify: (m: string, k?: "ok" | "err") => void; onError: (m: string) => void; }) {
  const [data, setData] = useState<{ cuentas: CxP[]; total_pendiente: number } | null>(null);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [pagar, setPagar] = useState<CxP | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [cx, cts] = await Promise.all([
        apiGet<{ cuentas: CxP[]; total_pendiente: number }>("/campo/cxp"),
        apiGet<Cuenta[]>("/campo/cuentas")
      ]);
      setData(cx); setCuentas(cts);
    } catch (e) { onError((e as Error).message); }
  }, [onError]);
  useEffect(() => { cargar(); }, [cargar]);

  async function eliminar(c: CxP) {
    if (!window.confirm(`¿Eliminar la cuenta por pagar de ${c.acreedor} (${money(c.monto)})?`)) return;
    try {
      await apiOk(`/campo/cxp/${c.id}`, { method: "DELETE" });
      await cargar(); onNotify("Cuenta por pagar eliminada");
    } catch (e) { onError((e as Error).message); }
  }

  const rows = data?.cuentas ?? [];
  return (
    <>
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>📤 Cuentas por Pagar <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· deudas operativas de Transporte</span></h2>
          <button type="button" className="primary" onClick={() => setNuevo(true)}>＋ Nueva CxP</button>
          <div className="totalBox" style={{ minWidth: 170, margin: 0, marginLeft: "auto", background: "#fee2e2", borderColor: "#fecaca" }}>
            <span>TOTAL POR PAGAR</span>
            <strong style={{ color: "#b91c1c" }}>{money(data?.total_pendiente ?? 0)}</strong>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable" style={{ marginTop: 8 }}>
            <thead><tr>
              <th>Fecha</th><th>Acreedor</th><th>Concepto</th><th className="num">Monto</th>
              <th className="num">Pagado</th><th className="num">Saldo</th><th>Estado</th><th>Acciones</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 14 }}>Sin cuentas por pagar.</td></tr>
              ) : rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.fecha?.slice(0, 10)}</td>
                  <td style={{ fontWeight: 600 }}>{c.acreedor}</td>
                  <td className="muted">{c.concepto || "—"}</td>
                  <td className="num">{money(c.monto)}</td>
                  <td className="num" style={{ color: "#15803d" }}>{money(c.pagado)}</td>
                  <td className="num" style={{ fontWeight: 700, color: c.saldo > 0.005 ? "#b91c1c" : "#15803d" }}>{money(c.saldo)}</td>
                  <td><span className="chip" style={{ background: c.estado === "pagado" ? "#dcfce7" : "#fef3c7", color: c.estado === "pagado" ? "#15803d" : "#b45309" }}>{c.estado}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {c.saldo > 0.005 && <button type="button" className="primary" onClick={() => setPagar(c)}>💵 Pagar</button>}
                      {c.pagado <= 0.005 && <button type="button" className="btnSecondary" style={{ color: "#b91c1c" }} onClick={() => eliminar(c)}>🗑️</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Cada pago sale de la Caja de Transporte. Saldo/estado se derivan de los pagos, en vivo.</p>
      </div>

      {nuevo && (
        <NuevaCxPModal onClose={() => setNuevo(false)}
          onDone={async () => { setNuevo(false); await cargar(); onNotify("Cuenta por pagar creada"); }}
          onError={onError} />
      )}
      {pagar && (
        <PagarCxPModal cxp={pagar} cuentas={cuentas}
          onClose={() => setPagar(null)}
          onDone={async (m) => { setPagar(null); await cargar(); onNotify(m); }}
          onError={onError} />
      )}
    </>
  );
}

function NuevaCxPModal({ onClose, onDone, onError }: {
  onClose: () => void; onDone: () => void | Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ fecha: hoy(), acreedor: "", concepto: "", monto: "" });
  const [busy, setBusy] = useState(false);
  async function submit() {
    try {
      setBusy(true);
      if (f.acreedor.trim().length < 2) throw new Error("Indica el proveedor/acreedor");
      if (!(Number(f.monto) > 0)) throw new Error("Indica el monto total");
      await apiPost("/campo/cxp", { fecha: f.fecha, acreedor: f.acreedor.trim(), concepto: f.concepto.trim() || undefined, monto: Number(f.monto) });
      await onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ maxWidth: 460, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>＋ Nueva Cuenta por Pagar</h2>
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>Proveedor / Acreedor <span style={{ color: "#ef4444" }}>*</span></span>
          <input type="text" autoFocus value={f.acreedor} onChange={(e) => setF({ ...f, acreedor: e.target.value })} placeholder="Ej: Taller Mecánico / Gasolinera / Chofer Juan" />
        </label>
        <label><span>Concepto</span>
          <input type="text" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} placeholder="Ej: Repuestos / Combustible / Mano de obra" />
        </label>
        <label><span>Monto total <span style={{ color: "#ef4444" }}>*</span></span>
          <input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0.00" />
        </label>
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Crear"}</button>
          <button type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

function PagarCxPModal({ cxp, cuentas, onClose, onDone, onError }: {
  cxp: CxP; cuentas: Cuenta[];
  onClose: () => void; onDone: (m: string) => void | Promise<void>; onError: (m: string) => void;
}) {
  const [monto, setMonto] = useState(cxp.saldo > 0 ? cxp.saldo.enReal() : "");
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id ?? "");
  const [fecha, setFecha] = useState(hoy());
  const [busy, setBusy] = useState(false);
  async function submit() {
    try {
      setBusy(true);
      const m = Number(monto);
      if (!(m > 0)) throw new Error("Indica el monto del pago");
      if (!cuentaId) throw new Error("Elige la cuenta de donde sale el efectivo");
      await apiPost(`/campo/cxp/${cxp.id}/abono`, { monto: m, cuenta_id: cuentaId, fecha });
      await onDone(`Pago de ${money(m)} registrado a ${cxp.acreedor}`);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ maxWidth: 440, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>💵 Pagar · {cxp.acreedor}</h2>
        <p className="muted" style={{ marginTop: 0 }}>Saldo pendiente: <strong>{money(cxp.saldo)}</strong>. El pago sale de la Caja de Transporte.</p>
        <label><span>Monto del pago</span>
          <input type="number" step="0.01" min="0" autoFocus value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
        </label>
        <label><span>Cuenta (sale el efectivo)</span>
          <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label><span>Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <div className="buttonRow">
          <button type="submit" className="primary" disabled={busy}>{busy ? "Registrando…" : "Registrar pago"}</button>
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
  // El Valor se auto-calcula (QQ × Precio) mientras no se edite a mano; al editarlo
  // queda como override (flete de valor fijo acordado).
  const [valorTouched, setValorTouched] = useState(false);
  // Importar/liquidar un Parte Diario pendiente.
  const [partes, setPartes] = useState<PartePendiente[]>([]);
  const [parteId, setParteId] = useState("");

  const cargarPartes = useCallback(async () => {
    try { setPartes(await apiGet<PartePendiente[]>("/campo/partes?estado=por_cobrar")); } catch { /* opcional */ }
  }, []);
  useEffect(() => { cargarPartes(); }, [cargarPartes]);

  // Valor auto = QQ × Precio (2 decimales) o "" si falta alguno.
  const calcValor = (qq: string, pu: string): string => {
    const n = Number(qq) * Number(pu);
    return qq.trim() !== "" && pu.trim() !== "" && n > 0 ? (Math.round(n * 100) / 100).enReal() : "";
  };
  const setQq = (qq: string) => setF((p) => ({ ...p, qq, valor: valorTouched ? p.valor : calcValor(qq, p.precio_unitario) }));
  const setPu = (pu: string) => setF((p) => ({ ...p, precio_unitario: pu, valor: valorTouched ? p.valor : calcValor(p.qq, pu) }));
  const setValor = (v: string) => { setValorTouched(true); setF((p) => ({ ...p, valor: v })); };

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
      setValorTouched(false);
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
      // Si hay QQ y Precio y NO se sobreescribió el valor → el backend lo calcula.
      // Si se sobreescribió (o falta QQ/Precio) → se manda el valor a mano.
      const usarCalculo = !valorTouched && qq != null && qq > 0 && pu != null && pu > 0;
      if (!usarCalculo && (valorManual == null || !(valorManual >= 0))) {
        throw new Error("Ingresa el valor, o el QQ y el precio unitario");
      }
      await apiPost("/campo/servicios", {
        fecha: f.fecha, cliente_id: cliente.id, activo_id: f.activo_id, tipo: f.tipo,
        qq: usarCalculo ? qq : undefined, precio_unitario: usarCalculo ? pu : undefined,
        valor: usarCalculo ? undefined : valorManual,
        notas: f.notas.trim() || undefined,
        parte_id: parteId || undefined
      });
      setF({ fecha: f.fecha, activo_id: f.activo_id, tipo: f.tipo, qq: "", precio_unitario: "", valor: "", notas: "" });
      setCliente(null); setParteId(""); setValorTouched(false);
      await Promise.all([onSaved(), cargarPartes()]);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="formPanel svcForm" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {/* ── Sección 1 · Operación ── */}
      <div className="svcSection">
        <div className="svcSectionHd">Operación</div>
        <label>
          <span>Parte Diario pendiente</span>
          <select value={parteId} onChange={(e) => elegirParte(e.target.value)}>
            <option value="">— Registro manual (sin parte) —</option>
            {partes.map((p) => (
              <option key={p.id} value={p.id}>
                {String(p.fecha).slice(0, 10)} · {p.activo_nombre} · {p.cliente}{p.operador ? ` · ${p.operador}` : ""} · {p.qq} QQ
              </option>
            ))}
          </select>
          {parteId
            ? <small className="svcHelp">Al guardar se liquida el parte. <span style={{ cursor: "pointer", color: "#2563eb" }} onClick={quitarParte}>✕ quitar</span></small>
            : <small className="svcHelp">Opcional · autollena y liquida el parte al guardar</small>}
        </label>

        <div className="svcGrid2">
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
      </div>

      {/* ── Sección 2 · Cobro (QQ × Precio = Valor, en una línea) ── */}
      <div className="svcSection">
        <div className="svcSectionHd">Cobro</div>
        <div className="svcGrid3">
          <label><span>QQ</span>
            <input type="number" step="0.01" min="0" value={f.qq} onChange={(e) => setQq(e.target.value)} />
            <small className="svcHelp">Ej: 120</small>
          </label>
          <label><span>Precio unitario</span>
            <input type="number" step="0.0001" min="0" value={f.precio_unitario} onChange={(e) => setPu(e.target.value)} />
            <small className="svcHelp">Ej: 1.50</small>
          </label>
          <label className="svcValor"><span>Valor del servicio $</span>
            <input type="number" step="0.01" min="0" value={f.valor} onChange={(e) => setValor(e.target.value)} />
            <small className="svcHelp">{valorTouched ? "Valor fijo (manual)" : (f.valor ? "= QQ × precio · editable" : "Ingresar a mano")}</small>
          </label>
        </div>
        <label><span>Notas (opcional)</span><input type="text" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></label>
      </div>

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
export function CampoWorkspace({ operationSelector, userName, roleName, apiOnline, onLogout, nombre, matrizName, onNombreChange }: {
  operationSelector: ReactNode;
  userName: string;
  roleName: string;
  apiOnline: boolean;
  onLogout: () => void;
  nombre: string;               // nombre editable de la operación (campo_config)
  matrizName: string;
  onNombreChange: (n: string) => void;
}) {
  // Entrada directa a una sección (p. ej. desde Configuración → «⚙️ Configuración»
  // de la operación): App deja la marca y aquí se consume una sola vez.
  const [seccion, setSeccion] = useState<CampoSeccion>(() => {
    try {
      const pedida = localStorage.getItem("bascula-erp:campo-seccion");
      if (pedida) {
        localStorage.removeItem("bascula-erp:campo-seccion");
        if (CAMPO_SECCIONES.some((x) => x.id === pedida)) return pedida as CampoSeccion;
      }
    } catch { /* almacenamiento no disponible */ }
    return "caja";
  });
  // Celular: el menú lateral es un cajón que se abre con ☰ (en PC no cambia nada).
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  useEffect(() => { setMenuMovilAbierto(false); }, [seccion]);
  const activa = CAMPO_SECCIONES.find((s) => s.id === seccion) ?? CAMPO_SECCIONES[0];
  const iniciales = userName.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
  return (
    <main className="shell">
      {menuMovilAbierto && <div className="mobileNavBackdrop" onClick={() => setMenuMovilAbierto(false)} aria-hidden="true" />}
      <aside className={menuMovilAbierto ? "sidebar is-open" : "sidebar"}>
        <button type="button" className="mobileNavClose" onClick={() => setMenuMovilAbierto(false)} aria-label="Cerrar menú">✕</button>
        <div className="brand">
          <span className="brandMark">🚜</span>
          <div>
            <strong>{nombre}</strong>
            <small>Operación · {matrizName}</small>
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
          <small>{nombre} · {matrizName}</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button type="button" className="mobileMenuBtn" onClick={() => setMenuMovilAbierto(true)} aria-label="Abrir menú">☰</button>
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
          <CampoModule section={seccion} nombre={nombre} matrizName={matrizName} onNombreChange={onNombreChange} onIrSeccion={setSeccion} />
        </div>
      </section>
    </main>
  );
}
