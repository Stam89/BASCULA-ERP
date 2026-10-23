// MÓDULO INDEPENDIENTE: Caja de Campo (cosechadora + transporte/fletes).
// V1 = solo captura. Autocontenido: su propio estado y llamadas a /campo/*.
// No depende de la lógica de piladora/ventas/fomentos. Se engancha en App.tsx
// con una entrada de sidebar y un único render.
import { ventanaDeImpresion } from "../impresion";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiFetch, apiGet, apiOk, apiPost, apiPut, esAdministrador } from "../api";

// PATCH a la maquinaria (campo_activos): el endpoint es PATCH (no PUT).
async function patchMaquina(id: string, body: unknown): Promise<void> {
  const r = await apiFetch(`/campo/activos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "No se pudo actualizar la maquinaria");
}
import { hoyLocal, money } from "../format";
import { useAutoRefresh } from "./autoRefresh";
import PartesModule from "./PartesModule";
import EstadoResultadosCampo from "./EstadoResultadosCampo";
import NominaOperadores, { TarifasOperadorCatalogo } from "./NominaOperadores";
import { BuscadorHistorial } from "../components/BuscadorHistorial";
import { BuscadorCombo, type OpcionCombo } from "../components/BuscadorCombo";
import { confirmar, pedirTexto } from "../components/Dialogo";

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

const hoy = () => hoyLocal();
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
type CuentaConsolidada = {
  cliente_id: string; nombre: string; identificacion: string | null;
  por_cobrar: number; por_pagar: number; compensable: number; saldo_neto: number;
  cargos_cxc: number; cargos_cxp: number;
};
type ComprobanteCompensacion = {
  id: string; fecha: string; monto: number; cxc_antes: number; cxp_antes: number; saldo_neto: number;
  nombre: string; identificacion: string | null;
  cxc: Array<{ id: string; fecha: string; tipo: string; detalle: string | null; maquina: string; aplicado: number }>;
  cxp: Array<{ id: string; fecha: string; acreedor: string; detalle: string | null; aplicado: number }>;
};

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
type Operador = {
  id: string; nombre: string; identificacion: string | null; telefono: string | null;
  cargo: string | null; sueldo_semanal: number; activo: boolean;
};

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

export default function CampoModule({ section = "caja", nombre, matrizName = "Matriz", onNombreChange, onIrSeccion, puedeVerSeccion, esAdmin = false }: {
  section?: CampoSeccion; nombre?: string; matrizName?: string; onNombreChange?: (n: string) => void;
  /** Cambia de sección del menú de Transporte (p. ej. de la caja al Estado de Resultados). */
  onIrSeccion?: (s: CampoSeccion) => void;
  /** Secciones que el usuario puede abrir (para no mostrar accesos que no le sirven). */
  puedeVerSeccion?: (s: CampoSeccion) => boolean;
  /** Administrador: puede editar el saldo inicial de la caja abierta (como en la caja de los socios). */
  esAdmin?: boolean;
}) {
  const [flash, setFlash] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 3500); };

  const [activos, setActivos] = useState<Activo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  // «libro» = solo los movimientos (como la Caja de la piladora); los formularios se abren con los botones grandes.
  const [cajaTab, setCajaTab] = useState<"libro" | "ingreso" | "egreso" | "transferencia" | "cierres">("libro");
  const [sesion, setSesion] = useState<SesionResp | null>(null);
  const [modalCaja, setModalCaja] = useState<"" | "cerrar">("");
  const [menuCaja, setMenuCaja] = useState(false);
  // Apertura (igual que la caja de los socios: efectivo + banco, «Traer saldo anterior») y edición del saldo inicial.
  const [apertura, setApertura] = useState<{ efectivo: string; banco: string; obs: string; busy?: boolean }>({ efectivo: "", banco: "", obs: "" });
  const [editSaldo, setEditSaldo] = useState<{ efectivo: string; banco: string; busy?: boolean } | null>(null);
  // «Depositar / retirar del banco» abre la transferencia ya armada CAJA ⇄ BANCO.
  const [transfPreset, setTransfPreset] = useState<{ origen: string; destino: string } | null>(null);
  const refreshSesion = useCallback(async () => {
    try { setSesion(await apiGet<SesionResp>("/campo/caja/sesion-activa")); } catch { /* opcional */ }
  }, []);
  const [servTab, setServTab] = useState<"servicio" | "abono" | "lista">("servicio");
  const [libroVersion, setLibroVersion] = useState(0); // fuerza recarga del libro tras cada movimiento
  const [cfgVersion, setCfgVersion] = useState(0); // recarga el «Estado de la configuración» tras cada cambio

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

  // Caja de Transporte al día sin recargar: lo registrado en otro equipo aparece solo.
  useAutoRefresh(() => Promise.all([refreshCatalogos(), refreshServicios(), refreshSesion()]).then(() => setLibroVersion((v) => v + 1)));

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
    return <section className="panelGrid">{flashEl}<CxPView nombreOperacion={nombre ?? "Campo"} onNotify={notify} onError={(m) => notify(m, "err")} /></section>;
  }

  if (section === "config") {
    const cambio = async (msg: string) => { await refreshCatalogos(); setCfgVersion((v) => v + 1); notify(msg); };
    return (
      <section className="panelGrid">
        {flashEl}
        <EstadoConfigCampo version={cfgVersion} onIr={onIrSeccion} />
        <ConfigSection nombreActual={nombre ?? "Campo"}
          onSaved={(n) => { onNombreChange?.(n); setCfgVersion((v) => v + 1); notify(`Nombre de la operación actualizado a “${n}”`); }}
          onError={(m) => notify(m, "err")} />
        <FlotaMaquinaria activos={activos}
          onChanged={cambio}
          onError={(m) => notify(m, "err")} />
        <OperadoresCatalogo operadores={operadores}
          onChanged={cambio}
          onError={(m) => notify(m, "err")} />
        <TarifasOperadorCatalogo activos={activos} operadores={operadores}
          onChanged={(msg) => { setCfgVersion((v) => v + 1); notify(msg); }}
          onError={(m) => notify(m, "err")} />
        <TarifasClientesCampo onChanged={(msg) => notify(msg)} onError={(m) => notify(m, "err")} />
        <DocumentosFlotaCampo activos={activos} onChanged={(msg) => notify(msg)} onError={(m) => notify(m, "err")} />
        <CategoriasGastoCampo categorias={categorias} onChanged={cambio} onError={(m) => notify(m, "err")} />
        <SaldosArranqueCampo onChanged={async (msg) => { setCfgVersion((v) => v + 1); notify(msg); }} onError={(m) => notify(m, "err")} />
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

  // section === "caja" · mismo formato que la Caja de la piladora (cjx-*): saldo arriba, dos botones grandes
  // «Salió / Entró dinero», accesos y el libro de movimientos. Mismas funciones de Transporte de siempre.
  const cajaAbierta = !!sesion?.activa;
  const arqueo = sesion?.activa?.arqueo;
  const ver = (x: CampoSeccion) => !puedeVerSeccion || puedeVerSeccion(x);
  const icoCuenta = (n: string) => n === "CAJA" ? "💵" : n === "BANCO" ? "🏦" : n === "CRUCE PILADORA" ? "🔁" : "📁";
  const irA = (t: typeof cajaTab) => { setMenuCaja(false); if (t === "transferencia") setTransfPreset(null); setCajaTab((x) => (x === t && t !== "libro" ? "libro" : t)); };
  const cuentaCaja = cuentas.find((c) => c.nombre === "CAJA");
  const cuentaBanco = cuentas.find((c) => c.nombre === "BANCO");
  const traerSaldoAnterior = () => setApertura((x) => ({ ...x, efectivo: String(sesion?.saldo_sugerido ?? 0), banco: String(cuentaBanco?.saldo ?? 0) }));
  async function abrirCaja() {
    try {
      const efectivo = Number(apertura.efectivo || 0);
      if (!(efectivo >= 0)) throw new Error("Ingresa el saldo inicial en efectivo (0 o más)");
      const banco = apertura.banco.trim() === "" ? undefined : Number(apertura.banco);
      if (banco !== undefined && !(banco >= 0)) throw new Error("El saldo del banco debe ser 0 o más");
      setApertura((x) => ({ ...x, busy: true }));
      await apiPost("/campo/caja/abrir", { saldo_inicial: efectivo, saldo_banco: banco, observaciones: apertura.obs.trim() || undefined });
      setApertura({ efectivo: "", banco: "", obs: "" });
      await Promise.all([refreshSesion(), refreshCatalogos()]);
      setLibroVersion((v) => v + 1);
      notify("Caja abierta");
    } catch (e) { notify((e as Error).message, "err"); setApertura((x) => ({ ...x, busy: false })); }
  }
  async function guardarSaldoInicial() {
    if (!editSaldo) return;
    try {
      const efectivo = Number(editSaldo.efectivo || 0);
      const banco = Number(editSaldo.banco || 0);
      if (!(efectivo >= 0) || !(banco >= 0)) throw new Error("Los saldos deben ser 0 o más");
      setEditSaldo({ ...editSaldo, busy: true });
      await apiPut("/campo/caja/saldo-inicial", { saldo_inicial: efectivo, saldo_banco: banco });
      setEditSaldo(null);
      await onCajaSaved("Saldo inicial actualizado");
    } catch (e) { notify((e as Error).message, "err"); setEditSaldo((x) => x && { ...x, busy: false }); }
  }
  // Movimientos de la sesión abierta (desde el día de apertura) para el Excel y el PDF.
  async function movimientosSesion(): Promise<LibroRow[]> {
    const desde = sesion?.activa ? new Date(sesion.activa.fecha_apertura).toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }) : "";
    return apiGet<LibroRow[]>(`/campo/caja/libro${desde ? `?from=${desde}` : ""}`);
  }
  const titulo = nombre ?? "Transporte y Cosechadora";
  async function descargarExcel() {
    try {
      const rows = await movimientosSesion();
      const XLSX = await import("xlsx");
      const datos = rows.map((r) => ({ Fecha: String(r.fecha).slice(0, 10), Concepto: r.concepto ?? "", "Categoría": r.categoria_nombre ?? "", "Máquina": r.activo_nombre ?? "", Cuenta: r.cuenta_nombre, Entrada: r.entrada || 0, Salida: r.salida || 0, Saldo: r.saldo_corrido }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), "Caja");
      XLSX.writeFile(wb, `caja-transporte-${new Date().toLocaleDateString("en-CA")}.xlsx`);
    } catch (e) { notify(`Error al descargar: ${(e as Error).message}`, "err"); }
  }
  async function imprimirPdf() {
    try {
      const rows = await movimientosSesion();
      const esc = (t: unknown) => String(t ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
      const ent = rows.reduce((t, r) => t + (r.entrada || 0), 0);
      const sal = rows.reduce((t, r) => t + (r.salida || 0), 0);
      const filas = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(String(r.fecha).slice(0, 10))}</td><td>${esc(r.concepto)}${r.activo_nombre ? ` · ${esc(r.activo_nombre)}` : ""}</td><td>${esc(r.categoria_nombre)}</td><td>${esc(r.cuenta_nombre)}</td><td style="color:green">${r.entrada > 0 ? money(r.entrada) : ""}</td><td style="color:#c00">${r.salida > 0 ? money(r.salida) : ""}</td></tr>`).join("");
      const html = `<html><head><title>Caja ${esc(titulo)}</title><style>body{font-family:Arial;font-size:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:4px 8px}th{background:#16a34a;color:#fff}.tot{font-weight:bold}</style></head><body>
      <h2 style="text-align:center">${esc(titulo)} — Caja</h2>
      <p>${sesion?.activa ? `Apertura: ${new Date(sesion.activa.fecha_apertura).toLocaleString("es-EC")} · Saldo inicial efectivo: ${money(arqueo?.saldo_inicial ?? 0)} · ` : ""}${cuentas.map((c) => `${esc(c.nombre)}: ${money(c.saldo)}`).join(" · ")}</p>
      <table><thead><tr><th>#</th><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Cuenta</th><th>Entrada</th><th>Salida</th></tr></thead><tbody>${filas}</tbody>
      <tfoot><tr class="tot"><td colspan="5">TOTALES</td><td style="color:green">${money(ent)}</td><td style="color:#c00">${money(sal)}</td></tr>
      <tr class="tot"><td colspan="5">DISPONIBLE (sin el cruce interno)</td><td colspan="2">${money(totalDisponible)}</td></tr></tfoot></table></body></html>`;
      const w = ventanaDeImpresion("transporte_caja");
      if (!w) return;
      w.document.write(html); w.document.close(); w.print();
    } catch (e) { notify((e as Error).message, "err"); }
  }

  // Todavía cargando el estado de la caja: no mostrar «No hay caja abierta» por un instante.
  if (sesion === null) return <section className="panelGrid"><p className="muted" style={{ gridColumn: "1 / -1" }}>Cargando caja…</p></section>;

  // ── Sin caja abierta: igual que la caja de los socios ──
  if (!cajaAbierta) {
    return (
      <section className="panelGrid">
        <div style={{ gridColumn: "1 / -1", display: "grid", gap: 20, maxWidth: 600, margin: "28px auto", width: "100%" }}>
          {flashEl}
          <div className="emptyState">
            <div className="emptyIcon">💼</div>
            <h2>No hay caja abierta</h2>
            <p>Abre la caja de {titulo} para comenzar a registrar movimientos de dinero</p>
          </div>
          <form className="formPanel" onSubmit={(e) => { e.preventDefault(); abrirCaja(); }} style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Abrir caja nueva</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label><span>Saldo inicial ($)</span>
                <input type="number" step="0.01" min="0" value={apertura.efectivo} onChange={(e) => setApertura({ ...apertura, efectivo: e.target.value })} placeholder="0.00" />
              </label>
              <label><span>Saldo inicial en Banco ($)</span>
                <input type="number" step="0.01" min="0" value={apertura.banco} onChange={(e) => setApertura({ ...apertura, banco: e.target.value })} placeholder={String(cuentaBanco?.saldo ?? 0)} />
              </label>
            </div>
            <small className="muted" style={{ display: "block", marginTop: -4 }}>Banco según el sistema: {money(cuentaBanco?.saldo ?? 0)}. Si lo dejas vacío no se cambia; si escribes otro valor, se corrige la diferencia.</small>
            <label><span>Observaciones (opcional)</span><input type="text" value={apertura.obs} onChange={(e) => setApertura({ ...apertura, obs: e.target.value })} placeholder="Ej: Turno mañana" /></label>
            <button type="button" className="btnSecondary" onClick={traerSaldoAnterior}>
              🔄 Traer saldo anterior (efectivo {money(sesion?.saldo_sugerido ?? 0)} y banco {money(cuentaBanco?.saldo ?? 0)})
            </button>
            <button className="primary" disabled={apertura.busy} style={{ width: "100%", padding: "10px 0", fontSize: 14, fontWeight: 700 }}>{apertura.busy ? "Abriendo…" : "💰 Abrir caja"}</button>
          </form>
          <div style={{ textAlign: "center" }}>
            <button type="button" className="btnSecondary" onClick={() => setCajaTab((x) => (x === "cierres" ? "libro" : "cierres"))}>📋 {cajaTab === "cierres" ? "Ocultar" : "Ver"} cierres de caja anteriores</button>
          </div>
        </div>
        {cajaTab === "cierres" && <CierresCajaView />}
      </section>
    );
  }

  return (
    <section className="panelGrid">
      <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
        {/* Saldo compacto: cuánto hay, en qué cuenta y lo de la sesión. Lo poco usado va en «Más». */}
        <div className="cjx-hero">
          <div style={{ minWidth: 0 }}>
            <p className="cjx-sub">
              <span className="cj-live" /> {titulo} · abierta por {sesion!.activa!.usuario_nombre ?? "—"} el {new Date(sesion!.activa!.fecha_apertura).toLocaleDateString("es-EC", { weekday: "long", day: "2-digit", month: "long" })}
            </p>
            <div className="cjx-saldo">{money(totalDisponible)}</div>
            <p className="cjx-sub">
              {cuentas.map((c) => (
                <span key={c.id} style={{ whiteSpace: "nowrap" }}>{icoCuenta(c.nombre)} {c.nombre === "CRUCE PILADORA" ? "Cruce (no se suma)" : c.nombre === "CAJA" ? "Gaveta" : c.nombre} <b className={c.saldo < 0 ? "cj-neg" : undefined}>{money(c.saldo)}</b> · </span>
              )).flatMap((el) => [el, " "])}
              entró <b className="cj-pos">+{money(arqueo?.ingresos ?? 0)}</b> · salió <b className="cj-neg">−{money(arqueo?.egresos ?? 0)}</b>
              <span className="cjx-ini"> · inicial {money(arqueo?.saldo_inicial ?? 0)}</span>
            </p>
          </div>
          <div className="cj-dd">
            <button type="button" className={`cj-btn ${menuCaja ? "is-open" : ""}`} aria-haspopup="menu" aria-expanded={menuCaja} onClick={() => setMenuCaja((m) => !m)}>
              Más <span className="cj-caret">▾</span>
            </button>
            {menuCaja && (
              <div className="cj-menu cj-menu--right" role="menu">
                {esAdmin && (
                  <button type="button" role="menuitem" className="cj-menu-item" onClick={() => {
                    setMenuCaja(false);
                    setEditSaldo({ efectivo: String(arqueo?.saldo_inicial ?? 0), banco: String(cuentaBanco?.saldo ?? 0) });
                  }}>
                    <span className="cj-menu-ico">✏️</span><span className="cj-menu-label">Editar saldo inicial</span>
                  </button>
                )}
                {cuentaCaja && cuentaBanco && (
                  <button type="button" role="menuitem" className="cj-menu-item" onClick={() => {
                    setMenuCaja(false); setTransfPreset({ origen: cuentaCaja.id, destino: cuentaBanco.id }); setCajaTab("transferencia");
                  }}>
                    <span className="cj-menu-ico">🏦</span><span className="cj-menu-label">Depositar / retirar del banco</span>
                  </button>
                )}
                <button type="button" role="menuitem" className="cj-menu-item" onClick={() => { setMenuCaja(false); descargarExcel(); }}>
                  <span className="cj-menu-ico">📥</span><span className="cj-menu-label">Descargar Excel</span>
                </button>
                <button type="button" role="menuitem" className="cj-menu-item" onClick={() => { setMenuCaja(false); imprimirPdf(); }}>
                  <span className="cj-menu-ico">🖨</span><span className="cj-menu-label">Imprimir PDF</span>
                </button>
                <div className="cj-menu-sep" />
                <button type="button" role="menuitem" className={`cj-menu-item ${cajaTab === "cierres" ? "is-current" : ""}`} onClick={() => irA("cierres")}>
                  <span className="cj-menu-ico">📋</span><span><span className="cj-menu-label">Cierres de caja</span><span className="cj-menu-hint">Historial de aperturas y arqueos</span></span>
                </button>
                {onIrSeccion && ver("reportes") && (
                  <button type="button" role="menuitem" className="cj-menu-item" onClick={() => { setMenuCaja(false); onIrSeccion("reportes"); }}>
                    <span className="cj-menu-ico">📊</span><span><span className="cj-menu-label">Reportes</span><span className="cj-menu-hint">Saldos, por cobrar y por máquina</span></span>
                  </button>
                )}
                <div className="cj-menu-sep" />
                <button type="button" role="menuitem" className="cj-menu-item cj-menu-item--danger" onClick={() => { setMenuCaja(false); setModalCaja("cerrar"); }}>
                  <span className="cj-menu-ico">✕</span><span className="cj-menu-label">Cerrar caja</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {editSaldo && (
          <div className="cj-card cj-edit-saldo">
            <div className="cj-card-title">✏️ Editar saldo inicial</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <label><span>Efectivo $</span><input type="number" step="0.01" min="0" value={editSaldo.efectivo} onChange={(e) => setEditSaldo({ ...editSaldo, efectivo: e.target.value })} /></label>
              <label><span>Banco $</span><input type="number" step="0.01" min="0" value={editSaldo.banco} onChange={(e) => setEditSaldo({ ...editSaldo, banco: e.target.value })} /></label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="primary" disabled={editSaldo.busy} onClick={guardarSaldoInicial}>{editSaldo.busy ? "Guardando…" : "Guardar"}</button>
              <button type="button" onClick={() => setEditSaldo(null)}>Cancelar</button>
            </div>
          </div>
        )}

        {/* Lo de todos los días: dos botones grandes. */}
        <div className="cjx-big">
          <button type="button" className={`cjx-big__btn is-out ${cajaTab === "egreso" ? "is-on" : ""}`} onClick={() => irA("egreso")}>
            <span aria-hidden="true">↓</span> Salió dinero
          </button>
          <button type="button" className={`cjx-big__btn is-in ${cajaTab === "ingreso" ? "is-on" : ""}`} onClick={() => irA("ingreso")}>
            <span aria-hidden="true">↑</span> Entró dinero
          </button>
        </div>

        <AlertasCampo onIr={onIrSeccion} version={libroVersion} />

        {/* Accesos de Transporte (lo que antes estaba en la barra y en «Opciones»). */}
        <div className="cjx-accesos">
          {onIrSeccion && (["servicios", "mantenimiento", "partes"] as const).some(ver) && (
            <div className="cjx-grupo">
              <span className="cjx-grupo__t">Equipos</span>
              {ver("servicios") && <button type="button" onClick={() => onIrSeccion("servicios")}>🚜 Servicios (cosecha y flete)</button>}
              {ver("mantenimiento") && <button type="button" onClick={() => onIrSeccion("mantenimiento")}>🔧 Mantenimiento</button>}
              {ver("partes") && <button type="button" onClick={() => onIrSeccion("partes")}>📝 Partes diarios</button>}
            </div>
          )}
          <div className="cjx-grupo">
            <span className="cjx-grupo__t">Otros registros</span>
            <button type="button" className={cajaTab === "transferencia" ? "is-on" : ""} onClick={() => irA("transferencia")}>⇄ Pasar entre cuentas</button>
            {onIrSeccion && ver("vales") && <button type="button" onClick={() => onIrSeccion("vales")}>🧾 Vales</button>}
            {onIrSeccion && ver("resultados") && <button type="button" onClick={() => onIrSeccion("resultados")}>📈 Estado de resultados</button>}
            {cajaTab !== "libro" && <button type="button" onClick={() => irA("libro")}>📋 Movimientos</button>}
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
        <TransferenciaForm key={transfPreset ? `${transfPreset.origen}-${transfPreset.destino}` : "libre"} preset={transfPreset} cuentas={cuentas.filter((c) => c.nombre !== "CRUCE PILADORA")}
          onSaved={() => onCajaSaved("Transferencia registrada")} onError={(m) => notify(m, "err")} />
      )}
      {cajaTab === "cierres" && <CierresCajaView />}

      {cajaTab !== "cierres" && <LibroView cuentas={cuentas} version={libroVersion}
        onReversed={() => onCajaSaved("Movimiento reversado y registrado en el libro")}
        onError={(m) => notify(m, "err")} />}

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
          <label><span>Máquina / Vehículo *</span><select value={f.activo_id} onChange={(e) => setF({ ...f, activo_id: e.target.value })}><option value="">Seleccione</option>{activos.map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.placa_codigo ? ` · ${a.placa_codigo}` : ""}</option>)}</select></label>
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
          <div><h2 style={{ margin: 0 }}>Último trabajo por equipo</h2><small className="muted">Qué se cambió, cuándo y cuál es el siguiente control.</small></div>
          <label style={{ margin: "0 0 0 auto", minWidth: 220 }}><span>Filtrar equipo</span><select value={filtroActivo} onChange={(e) => setFiltroActivo(e.target.value)}><option value="">Toda la flota</option>{activos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
        </div>
        <div style={{ overflowX: "auto" }}><table className="cajaTable" style={{ marginTop: 8 }}><thead><tr><th>Equipo</th><th>Último trabajo</th><th>Fecha</th><th>Lectura</th><th>Proximo</th></tr></thead><tbody>
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
  const qqFmt = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

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
function EstadoCuentaModal({ cliente, nombreOperacion, matrizName, cajaCuenta, cuentas = [], onAbonoRegistrado, onClose, onError }: {
  cliente: ClienteCuenta;
  nombreOperacion: string;
  matrizName: string;
  cajaCuenta?: Cuenta;
  /** Cuentas de Transporte: la transferencia o el cheque entran al BANCO (u otra que no sea CAJA). */
  cuentas?: Cuenta[];
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
  // Medio del cobro: efectivo → CAJA; transferencia / cheque → BANCO (o la cuenta elegida), con su número.
  const [medio, setMedio] = useState<"EFECTIVO" | "TRANSFERENCIA" | "CHEQUE">("EFECTIVO");
  const cuentasBanco = cuentas.filter((c) => !["CAJA", "CRUCE PILADORA"].includes(c.nombre.trim().toUpperCase()));
  const [bancoId, setBancoId] = useState("");
  const [referencia, setReferencia] = useState("");
  const bancoSel = cuentasBanco.find((c) => c.id === bancoId) ?? cuentasBanco.find((c) => c.nombre.trim().toUpperCase() === "BANCO") ?? cuentasBanco[0];
  const cuentaDestino = medio === "EFECTIVO" ? cajaCuenta : bancoSel;
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
      if (!cuentaDestino) throw new Error(medio === "EFECTIVO" ? "No existe la cuenta CAJA en Configuración." : "No hay una cuenta de BANCO en Configuración → Cuentas.");
      const saldo = Number(ec?.saldo_final ?? cliente.saldo);
      const monto = montoSolicitado ?? Number(montoAbono);
      if (!(monto > 0)) throw new Error("Indica el valor del abono.");
      if (monto > saldo + 0.005) throw new Error(`El abono no puede superar el saldo de ${money(saldo)}.`);
      const r = await apiPost<{ aplicado: number; servicios_afectados: number }>("/campo/cxc/abono", {
        cliente_id: cliente.id,
        monto,
        cuenta_id: cuentaDestino.id,
        fecha: fechaAbono,
        concepto: `Cobro CxC de ${cliente.nombre}`,
        medio_pago: medio,
        referencia: medio !== "EFECTIVO" && referencia.trim() ? referencia.trim() : undefined
      });
      setMontoAbono("");
      setReferencia("");
      await cargar();
      const como = medio === "EFECTIVO" ? "en efectivo a CAJA" : `por ${medio === "CHEQUE" ? "cheque" : "transferencia"} a ${cuentaDestino.nombre}`;
      await onAbonoRegistrado?.(`Ingresaron ${money(r.aplicado)} ${como} y se aplicaron a ${r.servicios_afectados} cargo(s).`);
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
    const w = ventanaDeImpresion("transporte_estado_cuenta");
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
                <div><strong>Registrar cobro</strong><small className="muted" style={{ display: "block" }}>
                  {medio === "EFECTIVO" ? <>El dinero ingresa a <b>CAJA</b>.</> : <>Entra a <b>{bancoSel?.nombre ?? "BANCO"}</b> (no a la caja).</>}
                </small></div>
                {cuentaDestino && <span className="chip ok">{cuentaDestino.nombre} · {money(cuentaDestino.saldo)}</span>}
              </div>
              <div className="segmented" style={{ marginBottom: 10 }} role="radiogroup" aria-label="Medio de pago">
                {([["EFECTIVO", "💵 Efectivo"], ["TRANSFERENCIA", "🏦 Transferencia"], ["CHEQUE", "🧾 Cheque"]] as const).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={medio === v} className={medio === v ? "active" : ""} onClick={() => setMedio(v)}>{l}</button>
                ))}
              </div>
              {medio !== "EFECTIVO" && (
                <div className="cxcCobroGrid" style={{ marginBottom: 8 }}>
                  {cuentasBanco.length > 1 && (
                    <label style={{ margin: 0 }}><span>Entra a</span>
                      <select value={bancoSel?.id ?? ""} onChange={(e) => setBancoId(e.target.value)}>
                        {cuentasBanco.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {money(c.saldo)}</option>)}
                      </select>
                    </label>
                  )}
                  <label style={{ margin: 0 }}><span>{medio === "CHEQUE" ? "N.º de cheque" : "N.º de transferencia"} <small className="muted">(opcional)</small></span>
                    <input type="text" maxLength={60} value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder={medio === "CHEQUE" ? "Ej: 000123 · Pichincha" : "Ej: 4587120"} />
                  </label>
                </div>
              )}
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
  const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
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
    const motivo = (await pedirTexto(`Anular el vale de ${money(v.entregado)}${v.concepto ? ` (${v.concepto})` : ""}.

El dinero vuelve a ${v.cuenta_nombre} y el vale desaparece de pendientes. Úsalo solo si se entregó mal; si ya gastaron algo, mejor «Liquidar / Rendir».

Motivo (obligatorio):`, ""));
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
                        {esAdministrador() && <button type="button" title="Si el vale se entregó mal (monto o persona equivocados), devuelve el dinero a la cuenta" onClick={() => anularVale(v)}>↩ Anular</button>}
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
function TransferenciaForm({ cuentas, onSaved, onError, preset }: {
  cuentas: Cuenta[]; onSaved: OnSaved; onError: (m: string) => void;
  /** Cuentas ya elegidas (p. ej. «Depositar / retirar del banco»: CAJA → BANCO). */
  preset?: { origen: string; destino: string } | null;
}) {
  const [f, setF] = useState({ fecha: hoy(), origen: preset?.origen ?? "", destino: preset?.destino ?? "", monto: "", concepto: "" });
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
    const motivo = (await pedirTexto(`Motivo de la reversion\n\n${row.concepto || "Movimiento sin concepto"}`))?.trim();
    if (!motivo) return;
    if (motivo.length < 5) { onError("Escribe un motivo de al menos 5 caracteres"); return; }
    if (!(await confirmar("Se creara un movimiento contrario. El original no se borrara. ¿Continuar?"))) return;
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

function ComprobanteCompensacionModal({ comprobante, nombreOperacion, onClose }: {
  comprobante: ComprobanteCompensacion; nombreOperacion: string; onClose: () => void;
}) {
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const imprimir = () => {
    const cxc = comprobante.cxc.map((x) => `<tr><td>${esc(String(x.fecha).slice(0, 10))}</td><td>${esc(x.detalle || (x.tipo === "cosecha" ? "Servicio de cosechadora" : "Servicio de flete"))}</td><td>${esc(x.maquina)}</td><td class="num">${x.aplicado.enReal()}</td></tr>`).join("");
    const cxp = comprobante.cxp.map((x) => `<tr><td>${esc(String(x.fecha).slice(0, 10))}</td><td>${esc(x.detalle || "Cuenta por pagar")}</td><td>${esc(x.acreedor)}</td><td class="num">${x.aplicado.enReal()}</td></tr>`).join("");
    const w = ventanaDeImpresion("transporte_compensacion");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Compensación · ${esc(comprobante.nombre)}</title><style>
      @page{size:A4;margin:14mm}body{font:12px Arial;color:#111}h1{font-size:18px;margin:0}.muted{color:#555}
      table{width:100%;border-collapse:collapse;margin:8px 0 16px}th,td{border:1px solid #ccc;padding:6px}th{background:#f3f4f6;text-align:left}.num{text-align:right}
      .res{border:1px solid #aaa;padding:10px;margin:12px 0}.total{font-size:17px;font-weight:700}</style></head><body>
      <h1>${esc(nombreOperacion)} · Comprobante de compensación</h1><div class="muted">N.º ${esc(comprobante.id.slice(0, 8).toUpperCase())} · ${esc(String(comprobante.fecha).slice(0, 10))}</div>
      <p><strong>${esc(comprobante.nombre)}</strong>${comprobante.identificacion ? ` · ${esc(comprobante.identificacion)}` : ""}</p>
      <div class="res"><div>Le debían a Transporte: <b>$ ${comprobante.cxc_antes.enReal()}</b></div><div>Transporte le debía: <b>$ ${comprobante.cxp_antes.enReal()}</b></div><div class="total">Compensado sin mover efectivo: $ ${comprobante.monto.enReal()}</div><div>Saldo neto restante: <b>$ ${Math.abs(comprobante.saldo_neto).enReal()}</b> ${comprobante.saldo_neto > 0 ? "a favor de Transporte" : comprobante.saldo_neto < 0 ? "a favor de la persona" : "· cuenta saldada"}</div></div>
      <h3>Deudas por cobrar aplicadas</h3><table><thead><tr><th>Fecha</th><th>Detalle</th><th>Máquina</th><th class="num">Aplicado</th></tr></thead><tbody>${cxc}</tbody></table>
      <h3>Deudas por pagar aplicadas</h3><table><thead><tr><th>Fecha</th><th>Detalle</th><th>Acreedor</th><th class="num">Aplicado</th></tr></thead><tbody>${cxp}</tbody></table>
      <p class="muted">Este comprobante cruza obligaciones de la misma persona. Conserva por separado los documentos originales y no representa entrada ni salida de efectivo.</p></body></html>`);
    w.document.close(); w.focus(); w.print();
  };
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.62)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}>
      <div className="tablePanel" onClick={(e) => e.stopPropagation()} style={{ width: "min(820px, 100%)", maxHeight: "calc(100vh - 32px)", overflow: "auto", margin: 0 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div><h2 style={{ margin: 0 }}>Cuenta compensada</h2><strong>{comprobante.nombre}</strong></div>
          <button type="button" className="primary" style={{ marginLeft: "auto" }} onClick={imprimir}>🖨️ Imprimir comprobante</button>
          <button type="button" onClick={onClose}>Cerrar</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 14 }}>
          <div className="totalBox"><span>POR COBRAR</span><strong>{money(comprobante.cxc_antes)}</strong></div>
          <div className="totalBox"><span>POR PAGAR</span><strong>{money(comprobante.cxp_antes)}</strong></div>
          <div className="totalBox" style={{ background: "#ecfdf5", borderColor: "#bbf7d0" }}><span>COMPENSADO</span><strong style={{ color: "#15803d" }}>{money(comprobante.monto)}</strong></div>
        </div>
        <h3>Detalle de lo que debía pagar la persona</h3>
        <ul>{comprobante.cxc.map((x) => <li key={x.id}>{String(x.fecha).slice(0, 10)} · {x.detalle || x.tipo} · {x.maquina}: <b>{money(x.aplicado)}</b></li>)}</ul>
        <h3>Detalle de lo que Transporte debía pagarle</h3>
        <ul>{comprobante.cxp.map((x) => <li key={x.id}>{String(x.fecha).slice(0, 10)} · {x.detalle || "Cuenta por pagar"}: <b>{money(x.aplicado)}</b></li>)}</ul>
        <p style={{ fontWeight: 700 }}>Saldo neto restante: {money(Math.abs(comprobante.saldo_neto))} {comprobante.saldo_neto > 0 ? "a favor de Transporte" : comprobante.saldo_neto < 0 ? "a favor de la persona" : "· cuenta saldada"}</p>
      </div>
    </div>, document.body
  );
}

function CuentasConsolidadasPanel({ nombreOperacion, onChanged, onNotify, onError }: {
  nombreOperacion: string; onChanged: () => void | Promise<void>;
  onNotify: (m: string, k?: "ok" | "err") => void; onError: (m: string) => void;
}) {
  const [rows, setRows] = useState<CuentaConsolidada[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [recibo, setRecibo] = useState<ComprobanteCompensacion | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  const cargar = useCallback(async () => {
    try { setRows((await apiGet<{ cuentas: CuentaConsolidada[] }>("/campo/cuentas-consolidadas")).cuentas); }
    catch (e) { onErrorRef.current((e as Error).message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const cruzables = rows.filter((r) => r.compensable > 0.005);
  if (!cruzables.length) return null;
  const compensar = async (r: CuentaConsolidada) => {
    if (!(await confirmar(`Se compensarán ${money(r.compensable)} entre lo que ${r.nombre} debe y lo que Transporte le debe. No se moverá efectivo. ¿Continuar?`))) return;
    try {
      setBusy(r.cliente_id);
      const c = await apiPost<ComprobanteCompensacion>(`/campo/cuentas-consolidadas/${r.cliente_id}/compensar`, { fecha: hoy() });
      setRecibo(c); await cargar(); await onChanged(); onNotify(`Cuenta de ${r.nombre} compensada por ${money(c.monto)}.`);
    } catch (e) { onError((e as Error).message); } finally { setBusy(null); }
  };
  return <>
    <div className="tablePanel" style={{ gridColumn: "1 / -1", borderColor: "#93c5fd", background: "#f8fbff" }}>
      <h2 style={{ margin: 0 }}>⚖️ Cuentas de la misma persona</h2>
      <p className="muted" style={{ margin: "4px 0 10px" }}>El sistema encontró personas que aparecen en CxC y CxP. Se muestra una sola cuenta neta; la compensación conserva el detalle y no mueve dinero de Caja.</p>
      <div style={{ overflowX: "auto" }}><table className="cajaTable"><thead><tr><th>Persona</th><th className="num">Le deben a Transporte</th><th className="num">Transporte le debe</th><th className="num">Saldo único</th><th>Acción</th></tr></thead><tbody>
        {cruzables.map((r) => <tr key={r.cliente_id}><td><strong>{r.nombre}</strong><small className="muted" style={{ display: "block" }}>{r.cargos_cxc} cargo(s) CxC · {r.cargos_cxp} deuda(s) CxP</small></td>
          <td className="num">{money(r.por_cobrar)}</td><td className="num">{money(r.por_pagar)}</td>
          <td className="num" style={{ fontWeight: 800, color: r.saldo_neto >= 0 ? "#b45309" : "#b91c1c" }}>{money(Math.abs(r.saldo_neto))}<small style={{ display: "block" }}>{r.saldo_neto > 0 ? "a cobrar" : r.saldo_neto < 0 ? "a pagar" : "saldada"}</small></td>
          <td><button type="button" className="primary" disabled={busy === r.cliente_id} onClick={() => { void compensar(r); }}>{busy === r.cliente_id ? "Compensando…" : `Compensar ${money(r.compensable)}`}</button></td></tr>)}
      </tbody></table></div>
    </div>
    {recibo && <ComprobanteCompensacionModal comprobante={recibo} nombreOperacion={nombreOperacion} onClose={() => setRecibo(null)} />}
  </>;
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
  useAutoRefresh(cargar); // lo cobrado desde el celular aparece solo

  const clientes = data?.clientes ?? [];
  const cajaCuenta = cuentas.find((cuenta) => cuenta.nombre.trim().toUpperCase() === "CAJA");
  return (
    <>
      <CuentasConsolidadasPanel nombreOperacion={nombreOperacion} onChanged={cargar} onNotify={onNotify} onError={onError} />
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
          cajaCuenta={cajaCuenta} cuentas={cuentas}
          onAbonoRegistrado={async (mensaje) => { await cargar(); onNotify(mensaje); }}
          onClose={() => setVerCuenta(null)} onError={onError} />
      )}
    </>
  );
}

// ── 📤 Cuentas por Pagar (Transporte): deudas operativas propias (CRUD) ───────
type CxP = { id: string; fecha: string; acreedor: string; cliente_id: string | null; cliente_nombre: string | null; concepto: string | null; monto: number; pagado: number; saldo: number; estado: "pendiente" | "pagado" };
type CxPGrupo = { clave: string; acreedor: string; cliente_id: string | null; cuentas: CxP[]; monto: number; pagado: number; saldo: number; };
type PagoCxPGrupo = { fecha: string; acreedor: string; cuenta: string; monto: number; saldo_antes: number; saldo_despues: number; aplicaciones: Array<{ id: string; fecha: string; concepto: string | null; saldo_antes: number; aplicado: number }> };
function CxPView({ nombreOperacion, onNotify, onError }: { nombreOperacion: string; onNotify: (m: string, k?: "ok" | "err") => void; onError: (m: string) => void; }) {
  const [data, setData] = useState<{ cuentas: CxP[]; total_pendiente: number } | null>(null);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [pagar, setPagar] = useState<CxPGrupo | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [reciboPago, setReciboPago] = useState<PagoCxPGrupo | null>(null);

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
    if (!(await confirmar(`¿Eliminar la cuenta por pagar de ${c.acreedor} (${money(c.monto)})?`))) return;
    try {
      await apiOk(`/campo/cxp/${c.id}`, { method: "DELETE" });
      await cargar(); onNotify("Cuenta por pagar eliminada");
    } catch (e) { onError((e as Error).message); }
  }

  const rows = data?.cuentas ?? [];
  const grupos = useMemo(() => {
    const map = new Map<string, CxPGrupo>();
    for (const c of rows) {
      const nombre = (c.cliente_nombre || c.acreedor).trim();
      const clave = `nombre:${nombre.toLocaleUpperCase("es-EC")}`;
      const actual = map.get(clave) ?? { clave, acreedor: nombre, cliente_id: c.cliente_id, cuentas: [], monto: 0, pagado: 0, saldo: 0 };
      if (!actual.cliente_id && c.cliente_id) actual.cliente_id = c.cliente_id;
      actual.cuentas.push(c); actual.monto += Number(c.monto); actual.pagado += Number(c.pagado); actual.saldo += Number(c.saldo);
      map.set(clave, actual);
    }
    return [...map.values()].map((g) => ({ ...g, monto: Math.round(g.monto * 100) / 100, pagado: Math.round(g.pagado * 100) / 100, saldo: Math.round(g.saldo * 100) / 100 }))
      .sort((a, b) => b.saldo - a.saldo || a.acreedor.localeCompare(b.acreedor));
  }, [rows]);
  return (
    <>
      <CuentasConsolidadasPanel nombreOperacion={nombreOperacion} onChanged={cargar} onNotify={onNotify} onError={onError} />
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
              ) : grupos.map((g) => (
                <Fragment key={g.clave}>
                  <tr>
                    <td>{g.cuentas.length === 1 ? g.cuentas[0].fecha?.slice(0, 10) : `${g.cuentas.length} documentos`}</td>
                    <td style={{ fontWeight: 700 }}>{g.acreedor}{g.cliente_id ? <small className="muted" style={{ display: "block" }}>🔗 Persona identificada</small> : null}</td>
                    <td className="muted">{g.cuentas.length === 1 ? (g.cuentas[0].concepto || "—") : `${g.cuentas.length} deudas agrupadas · Ver detalle`}</td>
                    <td className="num">{money(g.monto)}</td>
                    <td className="num" style={{ color: "#15803d" }}>{money(g.pagado)}</td>
                    <td className="num" style={{ fontWeight: 700, color: g.saldo > 0.005 ? "#b91c1c" : "#15803d" }}>{money(g.saldo)}</td>
                    <td><span className="chip" style={{ background: g.saldo <= 0.005 ? "#dcfce7" : "#fef3c7", color: g.saldo <= 0.005 ? "#15803d" : "#b45309" }}>{g.saldo <= 0.005 ? "pagado" : "pendiente"}</span></td>
                    <td style={{ whiteSpace: "nowrap" }}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="btnSecondary" onClick={() => setExpandido(expandido === g.clave ? null : g.clave)}>{expandido === g.clave ? "Ocultar" : "Ver detalle"}</button>
                      {g.saldo > 0.005 && <button type="button" className="primary" onClick={() => setPagar(g)}>💵 Pagar cuenta</button>}
                    </div></td>
                  </tr>
                  {expandido === g.clave && <tr><td colSpan={8} style={{ padding: 8, background: "var(--c-surface-2)" }}>
                    <table className="cajaTable" style={{ margin: 0 }}><thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Original</th><th className="num">Pagado</th><th className="num">Pendiente</th><th></th></tr></thead><tbody>
                      {g.cuentas.map((c) => <tr key={c.id}><td>{c.fecha?.slice(0, 10)}</td><td>{c.concepto || "—"}</td><td className="num">{money(c.monto)}</td><td className="num">{money(c.pagado)}</td><td className="num"><b>{money(c.saldo)}</b></td><td>{c.pagado <= 0.005 && esAdministrador() && <button type="button" className="btnSecondary" style={{ color: "#b91c1c" }} onClick={() => eliminar(c)}>🗑️</button>}</td></tr>)}
                    </tbody></table>
                  </td></tr>}
                </Fragment>
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
        <PagarCxPModal grupo={pagar} cuentas={cuentas}
          onClose={() => setPagar(null)}
          onDone={async (m, recibo) => { setPagar(null); setReciboPago(recibo); await cargar(); onNotify(m); }}
          onError={onError} />
      )}
      {reciboPago && <ComprobantePagoCxPModal recibo={reciboPago} nombreOperacion={nombreOperacion} onClose={() => setReciboPago(null)} />}
    </>
  );
}

function NuevaCxPModal({ onClose, onDone, onError }: {
  onClose: () => void; onDone: () => void | Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ fecha: hoy(), acreedor: "", cliente_id: "", concepto: "", monto: "" });
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiGet<Cliente[]>("/campo/clientes").then(setClientes).catch(() => setClientes([])); }, []);
  async function submit() {
    try {
      setBusy(true);
      if (f.acreedor.trim().length < 2) throw new Error("Indica el proveedor/acreedor");
      if (!(Number(f.monto) > 0)) throw new Error("Indica el monto total");
      await apiPost("/campo/cxp", { fecha: f.fecha, acreedor: f.acreedor.trim(), cliente_id: f.cliente_id || undefined, concepto: f.concepto.trim() || undefined, monto: Number(f.monto) });
      await onDone();
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ maxWidth: 460, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>＋ Nueva Cuenta por Pagar</h2>
        <label><span>Fecha</span><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label><span>¿Es una persona que también puede deberle a Transporte?</span>
          <select value={f.cliente_id} onChange={(e) => {
            const cliente = clientes.find((c) => c.id === e.target.value);
            setF({ ...f, cliente_id: e.target.value, acreedor: cliente?.nombre ?? f.acreedor });
          }}>
            <option value="">No / proveedor independiente</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <small className="muted">Al elegirla, CxC y CxP se mostrarán como una sola cuenta neta.</small>
        </label>
        <label><span>Proveedor / Acreedor <span style={{ color: "#ef4444" }}>*</span></span>
          <input type="text" autoFocus value={f.acreedor} readOnly={Boolean(f.cliente_id)} onChange={(e) => setF({ ...f, acreedor: e.target.value })} placeholder="Ej: Taller Mecánico / Gasolinera / Chofer Juan" />
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

function PagarCxPModal({ grupo, cuentas, onClose, onDone, onError }: {
  grupo: CxPGrupo; cuentas: Cuenta[];
  onClose: () => void; onDone: (m: string, recibo: PagoCxPGrupo) => void | Promise<void>; onError: (m: string) => void;
}) {
  const [monto, setMonto] = useState(grupo.saldo > 0 ? grupo.saldo.enReal() : "");
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id ?? "");
  const [fecha, setFecha] = useState(hoy());
  const [busy, setBusy] = useState(false);
  async function submit() {
    try {
      setBusy(true);
      const m = Number(monto);
      if (!(m > 0)) throw new Error("Indica el monto del pago");
      if (!cuentaId) throw new Error("Elige la cuenta de donde sale el efectivo");
      const recibo = await apiPost<PagoCxPGrupo>("/campo/cxp/pagar-grupo", {
        cliente_id: grupo.cliente_id || undefined, acreedor: grupo.cliente_id ? undefined : grupo.acreedor,
        monto: m, cuenta_id: cuentaId, fecha
      });
      await onDone(`Pago de ${money(m)} registrado a ${grupo.acreedor}`, recibo);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <form className="formPanel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }} style={{ maxWidth: 440, width: "100%", margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>💵 Pagar · {grupo.acreedor}</h2>
        <p className="muted" style={{ marginTop: 0 }}>Cuenta agrupada: <strong>{grupo.cuentas.length} documento(s)</strong> · Saldo total: <strong>{money(grupo.saldo)}</strong>.</p>
        <div style={{ maxHeight: 180, overflow: "auto", border: "1px solid var(--c-border)", borderRadius: 8, marginBottom: 10 }}>
          <table className="cajaTable" style={{ margin: 0 }}><thead><tr><th>Fecha</th><th>Detalle</th><th className="num">Saldo</th></tr></thead><tbody>
            {grupo.cuentas.filter((c) => c.saldo > 0.005).map((c) => <tr key={c.id}><td>{c.fecha.slice(0, 10)}</td><td>{c.concepto || "Cuenta por pagar"}</td><td className="num">{money(c.saldo)}</td></tr>)}
          </tbody></table>
        </div>
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

function ComprobantePagoCxPModal({ recibo, nombreOperacion, onClose }: { recibo: PagoCxPGrupo; nombreOperacion: string; onClose: () => void }) {
  const imprimir = () => {
    const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    const filas = recibo.aplicaciones.map((x) => `<tr><td>${esc(String(x.fecha).slice(0, 10))}</td><td>${esc(x.concepto || "Cuenta por pagar")}</td><td class="num">${x.saldo_antes.enReal()}</td><td class="num">${x.aplicado.enReal()}</td></tr>`).join("");
    const w = ventanaDeImpresion("transporte_pago_cxp"); if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pago CxP · ${esc(recibo.acreedor)}</title><style>@page{size:A4;margin:14mm}body{font:12px Arial;color:#111}h1{font-size:18px;margin:0}.muted{color:#555}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #ccc;padding:6px}th{background:#f3f4f6;text-align:left}.num{text-align:right}.total{font-size:18px;font-weight:700}</style></head><body>
      <h1>${esc(nombreOperacion)} · Comprobante de pago</h1><div class="muted">${esc(recibo.fecha)} · Cuenta: ${esc(recibo.cuenta)}</div><p><strong>${esc(recibo.acreedor)}</strong></p>
      <p class="total">Pagado: $ ${recibo.monto.enReal()}</p><p>Saldo anterior: $ ${recibo.saldo_antes.enReal()} · Saldo pendiente: $ ${recibo.saldo_despues.enReal()}</p>
      <table><thead><tr><th>Fecha deuda</th><th>Detalle</th><th class="num">Saldo anterior</th><th class="num">Aplicado</th></tr></thead><tbody>${filas}</tbody></table>
      <p class="muted">El pago fue distribuido por antigüedad entre los documentos detallados.</p></body></html>`);
    w.document.close(); w.focus(); w.print();
  };
  return createPortal(<div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.62)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}>
    <div className="tablePanel" onClick={(e) => e.stopPropagation()} style={{ width: "min(720px,100%)", maxHeight: "calc(100vh - 32px)", overflow: "auto", margin: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><div><h2 style={{ margin: 0 }}>Pago registrado</h2><strong>{recibo.acreedor}</strong></div><button type="button" className="primary" style={{ marginLeft: "auto" }} onClick={imprimir}>🖨️ Imprimir recibo</button><button type="button" onClick={onClose}>Cerrar</button></div>
      <p>Se pagaron <strong>{money(recibo.monto)}</strong> desde {recibo.cuenta}. Saldo pendiente: <strong>{money(recibo.saldo_despues)}</strong>.</p>
      <table className="cajaTable"><thead><tr><th>Fecha</th><th>Detalle de la deuda</th><th className="num">Aplicado</th></tr></thead><tbody>{recibo.aplicaciones.map((x) => <tr key={x.id}><td>{String(x.fecha).slice(0, 10)}</td><td>{x.concepto || "Cuenta por pagar"}</td><td className="num"><b>{money(x.aplicado)}</b></td></tr>)}</tbody></table>
    </div>
  </div>, document.body);
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

// ════════════════════════════════════════════════════════════════════════════
// ⚙️ CONFIGURACIÓN COMPLETA DE TRANSPORTE (2026-10-12): estado de la configuración, categorías de gasto y SALDOS DE
// ARRANQUE (quién le debía a Transporte, a quién le debía Transporte y el dinero que tenía en el banco).
// ════════════════════════════════════════════════════════════════════════════
type EstadoConfig = {
  nombre: string | null; flota: number; operadores: number; tarifas_operador: number; categorias: number; clientes: number;
  sesiones_caja: number; caja_abierta: number; saldos_cobrar: number; saldos_pagar: number; saldo_banco: number;
};
/** Último día del mes anterior (los cortes son a fin de mes). */
function ultimoDiaMesAnterior(): string {
  const d = new Date(); const u = new Date(d.getFullYear(), d.getMonth(), 0);
  return `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}`;
}

function EstadoConfigCampo({ version, onIr }: { version: number; onIr?: (s: CampoSeccion) => void }) {
  const [e, setE] = useState<EstadoConfig | null>(null);
  useEffect(() => { apiGet<EstadoConfig>("/campo/config/estado").then(setE).catch(() => setE(null)); }, [version]);
  if (!e) return null;
  const saldos = e.saldos_cobrar + e.saldos_pagar + e.saldo_banco;
  const items: Array<{ ok: boolean; opcional?: boolean; titulo: string; detalle: string; ir?: () => void; irTxt?: string }> = [
    { ok: Boolean(e.nombre && e.nombre !== "Campo"), titulo: "Nombre de la operación", detalle: e.nombre ?? "Sin nombre" },
    { ok: e.flota > 0, titulo: "Flota y maquinaria", detalle: e.flota > 0 ? `${e.flota} máquina(s) / vehículo(s)` : "Registra las cosechadoras y los carros (abajo)" },
    { ok: e.operadores > 0, titulo: "Operadores", detalle: e.operadores > 0 ? `${e.operadores} operador(es)` : "Registra a los choferes y operadores (abajo)" },
    { ok: e.tarifas_operador > 0, titulo: "Tarifas de los operadores", detalle: e.tarifas_operador > 0 ? `${e.tarifas_operador} tarifa(s)` : "Sin tarifas no se calcula la nómina de operadores" },
    { ok: e.categorias > 0, titulo: "Categorías de gasto", detalle: `${e.categorias} categoría(s)` },
    { ok: e.clientes > 0, titulo: "Clientes", detalle: e.clientes > 0 ? `${e.clientes} cliente(s)` : "Se crean solos al registrar un parte o un servicio", ir: onIr ? () => onIr("clientes") : undefined, irTxt: "Ver clientes" },
    { ok: e.sesiones_caja > 0, titulo: "Caja", detalle: e.caja_abierta > 0 ? "Caja abierta" : e.sesiones_caja > 0 ? "Cerrada (se abre cada día)" : "Aún no se ha abierto nunca: ábrela con el efectivo que tiene Transporte", ir: onIr ? () => onIr("caja") : undefined, irTxt: "Ir a Caja" },
    { ok: saldos > 0, opcional: true, titulo: "Saldos de arranque", detalle: saldos > 0 ? `${e.saldos_cobrar} por cobrar · ${e.saldos_pagar} por pagar · banco ${e.saldo_banco > 0 ? "✓" : "—"}` : "Si Transporte tenía deudas o dinero en el banco antes de usar el sistema, cárgalos abajo" }
  ];
  const listos = items.filter((x) => x.ok).length;
  return (
    <div className="tablePanel campoCfgEstado" style={{ gridColumn: "1 / -1" }}>
      <div className="campoCfgEstado__head">
        <h2 style={{ margin: 0 }}>✅ Estado de la configuración</h2>
        <span className={`chip ${listos === items.length ? "ok" : "warn"}`}>{listos} de {items.length} listos</span>
      </div>
      <div className="campoCfgEstado__lista">
        {items.map((x) => (
          <div key={x.titulo} className={`campoCfgEstado__item ${x.ok ? "is-ok" : x.opcional ? "is-opc" : "is-falta"}`}>
            <span className="campoCfgEstado__ico" aria-hidden="true">{x.ok ? "✓" : x.opcional ? "•" : "!"}</span>
            <span className="campoCfgEstado__txt"><strong>{x.titulo}{x.opcional && !x.ok ? " (si aplica)" : ""}</strong><small>{x.detalle}</small></span>
            {!x.ok && x.ir && <button type="button" className="btnSecondary" onClick={x.ir}>{x.irTxt}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoriasGastoCampo({ categorias, onChanged, onError }: {
  categorias: Categoria[]; onChanged: (msg: string) => Promise<void>; onError: (m: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [busy, setBusy] = useState(false);
  async function agregar() {
    const n = nombre.trim().toUpperCase();
    if (n.length < 2) { onError("Escribe el nombre de la categoría"); return; }
    if (categorias.some((c) => c.nombre.toUpperCase() === n)) { onError(`La categoría ${n} ya existe`); return; }
    try { setBusy(true); await apiPost("/campo/categorias-gasto", { nombre: n }); setNombre(""); await onChanged(`Categoría ${n} agregada`); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="formPanel" style={{ gridColumn: "1 / -1" }}>
      <h2>🏷️ Categorías de gasto</h2>
      <p className="muted" style={{ marginTop: -4 }}>Con estas se clasifican los egresos de la caja de Transporte (diésel, reparaciones…) en los reportes.</p>
      <div className="campoCats">
        {categorias.map((c) => <span key={c.id} className="chip">{c.nombre}</span>)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <input type="text" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: LLANTAS" style={{ flex: "1 1 180px" }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void agregar(); } }} />
        <button type="button" className="primary" disabled={busy} onClick={agregar}>➕ Agregar categoría</button>
      </div>
    </div>
  );
}

type SaldoCobrar = { id: string; fecha: string; tipo: "cosecha" | "flete"; valor: number; notas: string | null; cliente: string; cliente_tipo: string; cobrado: number; saldo: number };
type SaldoPagar = { id: string; fecha: string; acreedor: string; concepto: string | null; monto: number; pagado: number; saldo: number };
type SaldoBanco = { id: string; fecha: string; monto: number };

function SaldosArranqueCampo({ onChanged, onError }: { onChanged: (msg: string) => Promise<void>; onError: (m: string) => void }) {
  const [data, setData] = useState<{ cobrar: SaldoCobrar[]; pagar: SaldoPagar[]; banco: SaldoBanco[] } | null>(null);
  const [vista, setVista] = useState<"cobrar" | "pagar" | "banco">("cobrar");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [fc, setFc] = useState({ tipo: "cosecha" as "cosecha" | "flete", monto: "", fecha: ultimoDiaMesAnterior(), nota: "" });
  const [fp, setFp] = useState({ acreedor: "", monto: "", fecha: ultimoDiaMesAnterior(), nota: "" });
  const [fb, setFb] = useState({ monto: "", fecha: ultimoDiaMesAnterior() });
  const [busy, setBusy] = useState(false);
  const cargar = useCallback(async () => {
    try { setData(await apiGet<{ cobrar: SaldoCobrar[]; pagar: SaldoPagar[]; banco: SaldoBanco[] }>("/campo/saldos-iniciales")); }
    catch (e) { onError((e as Error).message); }
  }, [onError]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function correr(fn: () => Promise<string>) {
    try { setBusy(true); const msg = await fn(); await cargar(); await onChanged(msg); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  const guardarCobrar = () => correr(async () => {
    if (!cliente) throw new Error("Elige o crea el cliente que le debe a Transporte");
    if (!(Number(fc.monto) > 0)) throw new Error("Escribe cuánto debe");
    const r = await apiPost<{ cliente: string; espejo_socio: string | null }>("/campo/saldos-iniciales/cobrar", { cliente_id: cliente.id, tipo: fc.tipo, monto: Number(fc.monto), fecha: fc.fecha, nota: fc.nota.trim() || undefined });
    setCliente(null); setFc({ ...fc, monto: "", nota: "" });
    return `Saldo de ${r.cliente} registrado${r.espejo_socio ? ` · a ${r.espejo_socio} le aparece en su Por Pagar` : ""}`;
  });
  const guardarPagar = () => correr(async () => {
    if (fp.acreedor.trim().length < 2) throw new Error("Escribe a quién le debe Transporte");
    if (!(Number(fp.monto) > 0)) throw new Error("Escribe cuánto le debe");
    await apiPost("/campo/saldos-iniciales/pagar", { acreedor: fp.acreedor.trim(), monto: Number(fp.monto), fecha: fp.fecha, nota: fp.nota.trim() || undefined });
    setFp({ ...fp, acreedor: "", monto: "", nota: "" });
    return "Deuda de Transporte registrada (la pagas en Cuentas por Pagar)";
  });
  const guardarBanco = () => correr(async () => {
    if (!(Number(fb.monto) > 0)) throw new Error("Escribe cuánto había en el banco");
    await apiPost("/campo/saldos-iniciales/banco", { monto: Number(fb.monto), fecha: fb.fecha });
    setFb({ ...fb, monto: "" });
    return "Saldo inicial del banco registrado";
  });
  const quitar = async (url: string, msg: string) => {
    if (!(await confirmar(`¿Quitar este saldo de arranque? (${msg})`))) return;
    void correr(async () => { await apiOk(url, { method: "DELETE" }); return "Saldo de arranque quitado"; });
  };

  const totCobrar = (data?.cobrar ?? []).reduce((s, x) => s + x.saldo, 0);
  const totPagar = (data?.pagar ?? []).reduce((s, x) => s + x.saldo, 0);
  return (
    <div className="formPanel campoSaldos" style={{ gridColumn: "1 / -1" }}>
      <h2>📥 Saldos de arranque <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· lo que venía de antes del sistema</span></h2>
      <p className="muted" style={{ marginTop: -4 }}>Carga aquí lo que le debían a Transporte, lo que Transporte debía y el dinero que tenía en el banco al empezar. No cuenta como ingreso ni gasto del mes. El efectivo de la caja se pone al <b>abrir la caja</b>.</p>
      <div className="segmented campoSaldos__tabs">
        <button type="button" className={vista === "cobrar" ? "active" : ""} onClick={() => setVista("cobrar")}>📥 Le deben {totCobrar > 0 ? `· ${money(totCobrar)}` : ""}</button>
        <button type="button" className={vista === "pagar" ? "active" : ""} onClick={() => setVista("pagar")}>📤 Debe {totPagar > 0 ? `· ${money(totPagar)}` : ""}</button>
        <button type="button" className={vista === "banco" ? "active" : ""} onClick={() => setVista("banco")}>🏦 Banco</button>
      </div>

      {vista === "cobrar" && (
        <>
          <div className="campoSaldos__form">
            <ClientePicker value={cliente} onChange={setCliente} onError={onError} />
            <label><span>¿De qué es la deuda?</span>
              <select value={fc.tipo} onChange={(e) => setFc({ ...fc, tipo: e.target.value as "cosecha" | "flete" })}>
                <option value="cosecha">Cosecha</option><option value="flete">Flete / transporte</option>
              </select></label>
            <label><span>Cuánto debe</span><input type="number" inputMode="decimal" min="0" step="0.01" value={fc.monto} onChange={(e) => setFc({ ...fc, monto: e.target.value })} placeholder="0.00" /></label>
            <label><span>Al día (corte)</span><input type="date" value={fc.fecha} onChange={(e) => setFc({ ...fc, fecha: e.target.value })} /></label>
            <label className="campoSaldos__ancho"><span>Nota <small>(opcional)</small></span><input type="text" maxLength={300} value={fc.nota} onChange={(e) => setFc({ ...fc, nota: e.target.value })} placeholder="Ej: cosecha de agosto" /></label>
            <button type="button" className="primary campoSaldos__ancho" disabled={busy} onClick={guardarCobrar}>➕ Agregar lo que le deben</button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Si el que debe es un socio (cliente «piladora»), también le aparece en su Por Pagar. Los abonos se registran en <b>Cuentas por Cobrar</b>.</p>
          <TablaSaldos vacio="Nadie cargado todavía." filas={(data?.cobrar ?? []).map((x) => ({
            id: x.id, fecha: x.fecha, nombre: x.cliente, detalle: [x.tipo === "cosecha" ? "Cosecha" : "Flete", (x.notas ?? "").replace(/^Saldo inicial \(deuda de antes del sistema\)( · )?/, "")].filter(Boolean).join(" · "),
            monto: x.valor, movido: x.cobrado, saldo: x.saldo,
            quitar: x.cobrado <= 0.005 ? async () => (await quitar(`/campo/saldos-iniciales/cobrar/${x.id}`, `${x.cliente} · ${money(x.valor)}`)) : undefined
          }))} movidoTxt="Cobrado" />
        </>
      )}

      {vista === "pagar" && (
        <>
          <div className="campoSaldos__form">
            <label><span>¿A quién le debe Transporte?</span><input type="text" value={fp.acreedor} onChange={(e) => setFp({ ...fp, acreedor: e.target.value })} placeholder="Ej: Taller / Gasolinera / Chofer" /></label>
            <label><span>Cuánto le debe</span><input type="number" inputMode="decimal" min="0" step="0.01" value={fp.monto} onChange={(e) => setFp({ ...fp, monto: e.target.value })} placeholder="0.00" /></label>
            <label><span>Al día (corte)</span><input type="date" value={fp.fecha} onChange={(e) => setFp({ ...fp, fecha: e.target.value })} /></label>
            <label><span>Nota <small>(opcional)</small></span><input type="text" maxLength={300} value={fp.nota} onChange={(e) => setFp({ ...fp, nota: e.target.value })} placeholder="Ej: repuestos de la cosechadora" /></label>
            <button type="button" className="primary campoSaldos__ancho" disabled={busy} onClick={guardarPagar}>➕ Agregar lo que debe</button>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>Se paga desde <b>Cuentas por Pagar</b> (sale de la caja o del banco de Transporte).</p>
          <TablaSaldos vacio="Nada cargado todavía." filas={(data?.pagar ?? []).map((x) => ({
            id: x.id, fecha: x.fecha, nombre: x.acreedor, detalle: (x.concepto ?? "").replace(/^Saldo inicial \(deuda de antes del sistema\)( · )?/, ""),
            monto: x.monto, movido: x.pagado, saldo: x.saldo,
            quitar: x.pagado <= 0.005 ? async () => (await quitar(`/campo/cxp/${x.id}`, `${x.acreedor} · ${money(x.monto)}`)) : undefined
          }))} movidoTxt="Pagado" />
        </>
      )}

      {vista === "banco" && (
        (data?.banco ?? []).length > 0 ? (
          <div className="campoSaldos__banco">
            {data!.banco.map((b) => (
              <div key={b.id}>
                <span>Al arrancar había en el banco <b>{money(b.monto)}</b> <small className="muted">(al {String(b.fecha).slice(0, 10)})</small></span>
                {esAdministrador() && <button type="button" className="btnSecondary" disabled={busy} onClick={async () => (await quitar(`/campo/saldos-iniciales/banco/${b.id}`, money(b.monto)))}>🗑 Quitar</button>}
              </div>
            ))}
          </div>
        ) : (
          <div className="campoSaldos__form">
            <label><span>Dinero en el banco al arrancar</span><input type="number" inputMode="decimal" min="0" step="0.01" value={fb.monto} onChange={(e) => setFb({ ...fb, monto: e.target.value })} placeholder="0.00" /></label>
            <label><span>Al día (corte)</span><input type="date" value={fb.fecha} onChange={(e) => setFb({ ...fb, fecha: e.target.value })} /></label>
            <button type="button" className="primary campoSaldos__ancho" disabled={busy} onClick={guardarBanco}>💾 Guardar saldo del banco</button>
          </div>
        )
      )}
    </div>
  );
}

function TablaSaldos({ filas, vacio, movidoTxt }: {
  filas: Array<{ id: string; fecha: string; nombre: string; detalle: string; monto: number; movido: number; saldo: number; quitar?: () => void }>;
  vacio: string; movidoTxt: string;
}) {
  if (filas.length === 0) return <p className="muted" style={{ margin: "6px 0 0" }}>{vacio}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="cajaTable" style={{ marginTop: 6 }}>
        <thead><tr><th>Quién</th><th className="num">Monto</th><th className="num">{movidoTxt}</th><th className="num">Saldo</th><th /></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td><strong>{f.nombre}</strong><small className="muted" style={{ display: "block" }}>{String(f.fecha).slice(0, 10)}{f.detalle ? ` · ${f.detalle}` : ""}</small></td>
              <td className="num">{money(f.monto)}</td>
              <td className="num" style={{ color: "#15803d" }}>{money(f.movido)}</td>
              <td className="num" style={{ fontWeight: 700 }}>{money(f.saldo)}</td>
              <td>{f.quitar && esAdministrador() && <button type="button" className="btnGhost" title="Quitar (se cargó por error)" onClick={f.quitar}>🗑</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
const operadorVacio = { nombre: "", identificacion: "", telefono: "", cargo: "", sueldo_semanal: "" };
function OperadoresCatalogo({ operadores, onChanged, onError }: {
  operadores: Operador[]; onChanged: (msg: string) => Promise<void>; onError: (m: string) => void;
}) {
  const [f, setF] = useState(operadorVacio);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function editar(o: Operador) {
    setEditId(o.id);
    setF({
      nombre: o.nombre, identificacion: o.identificacion ?? "", telefono: o.telefono ?? "",
      cargo: o.cargo ?? "", sueldo_semanal: o.sueldo_semanal > 0 ? String(o.sueldo_semanal) : ""
    });
  }
  function cancelar() { setEditId(null); setF(operadorVacio); }

  async function guardar() {
    try {
      setBusy(true);
      if (f.nombre.trim().length < 2) throw new Error("Escribe el nombre del operador");
      const sueldoSemanal = f.sueldo_semanal.trim() === "" ? 0 : Number(f.sueldo_semanal);
      if (!Number.isFinite(sueldoSemanal) || sueldoSemanal < 0) throw new Error("El sueldo semanal no es válido");
      const payload = {
        nombre: f.nombre.trim(), identificacion: f.identificacion.trim() || null,
        telefono: f.telefono.trim() || null, cargo: f.cargo.trim() || null,
        sueldo_semanal: sueldoSemanal
      };
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
      <p className="muted" style={{ marginTop: -4 }}>
        Personal de Transporte y Cosechadora. Si tiene sueldo semanal, la nómina lo propone una sola vez de lunes a domingo;
        con sueldo en $0 conserva el cálculo por QQ, viaje o día.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <label><span>Nombre</span><input type="text" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej: Juan Pérez" /></label>
        <label><span>Cargo / Función</span><input type="text" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} placeholder="Ej: Chofer" /></label>
        <label><span>Sueldo semanal ($)</span><input type="number" min="0" step="0.01" value={f.sueldo_semanal} onChange={(e) => setF({ ...f, sueldo_semanal: e.target.value })} placeholder="0.00 = por producción" /></label>
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
            <thead><tr><th>Nombre</th><th>Cargo</th><th>Sueldo semanal</th><th>Cédula / ID</th><th>Teléfono</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {operadores.map((o) => (
                <tr key={o.id} style={{ opacity: o.activo ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 600 }}>{o.nombre}</td>
                  <td>{o.cargo || "—"}</td>
                  <td style={{ fontWeight: 700 }}>{o.sueldo_semanal > 0 ? money(o.sueldo_semanal) : <span className="muted">Por producción</span>}</td>
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
export function CampoWorkspace({ operationSelector, userName, roleName, apiOnline, onLogout, nombre, matrizName, onNombreChange, puedeVerSeccion }: {
  operationSelector: ReactNode;
  userName: string;
  roleName: string;
  apiOnline: boolean;
  onLogout: () => void;
  nombre: string;               // nombre editable de la operación (campo_config)
  matrizName: string;
  onNombreChange: (n: string) => void;
  /** Permisos por sección (Configuración › permisos › Transporte / Cosechadora ↳). Sin la función, se ven todas. */
  puedeVerSeccion?: (s: CampoSeccion) => boolean;
}) {
  const secciones = CAMPO_SECCIONES.filter((s) => !puedeVerSeccion || puedeVerSeccion(s.id));
  const permitida = (s: CampoSeccion) => !puedeVerSeccion || puedeVerSeccion(s);
  // Entrada directa a una sección (p. ej. desde Configuración → «⚙️ Configuración»
  // de la operación): App deja la marca y aquí se consume una sola vez.
  const [seccion, setSeccion] = useState<CampoSeccion>(() => {
    try {
      const pedida = localStorage.getItem("bascula-erp:campo-seccion");
      if (pedida) {
        localStorage.removeItem("bascula-erp:campo-seccion");
        if (CAMPO_SECCIONES.some((x) => x.id === pedida) && permitida(pedida as CampoSeccion)) return pedida as CampoSeccion;
      }
    } catch { /* almacenamiento no disponible */ }
    return secciones[0]?.id ?? "caja";
  });
  // Ir a otra sección (menú, alertas, botones de la caja) solo si el usuario la puede ver.
  const irA = (s: CampoSeccion) => { if (permitida(s)) setSeccion(s); };
  // Celular: el menú lateral es un cajón que se abre con ☰ (en PC no cambia nada).
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  useEffect(() => { setMenuMovilAbierto(false); }, [seccion]);
  const activa = CAMPO_SECCIONES.find((s) => s.id === seccion) ?? secciones[0] ?? CAMPO_SECCIONES[0];
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
            {secciones.map((s) => (
              <button key={s.id} className={seccion === s.id ? "active" : ""} onClick={() => irA(s.id)}>
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
          {secciones.length === 0 || !permitida(seccion)
            ? <p className="muted">No tienes ninguna sección de {nombre} asignada. Pide acceso a un administrador.</p>
            : <CampoModule section={seccion} nombre={nombre} matrizName={matrizName} onNombreChange={onNombreChange} onIrSeccion={irA} puedeVerSeccion={permitida} esAdmin={(roleName ?? "").toUpperCase() === "ADMINISTRADOR"} />}
        </div>
      </section>
    </main>
  );
}

// ── 💲 Tarifas a clientes: precio por QQ de cosecha y de flete (general y por cliente) ──
// «Generar cobro» de un parte trae este precio ya escrito (el del cliente o el general).
type TarifaCliente = { id: string; nombre: string; tipo: string; tarifa_cosecha_qq: number | null; tarifa_flete_qq: number | null; tarifa_flete_viaje: number | null };
type TarifaGeneral = { cosecha: number | null; flete: number | null; viaje: number | null };
function TarifasClientesCampo({ onChanged, onError }: { onChanged: (msg: string) => void; onError: (m: string) => void }) {
  const [data, setData] = useState<{ general: TarifaGeneral; clientes: TarifaCliente[] } | null>(null);
  const [gen, setGen] = useState({ cosecha: "", flete: "", viaje: "" });
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [nueva, setNueva] = useState({ cosecha: "", flete: "", viaje: "" });
  const [busy, setBusy] = useState(false);
  const cargar = useCallback(async () => {
    try {
      const d = await apiGet<{ general: TarifaGeneral; clientes: TarifaCliente[] }>("/campo/tarifas-cliente");
      setData(d);
      const t = (n: number | null) => (n != null ? String(n) : "");
      setGen({ cosecha: t(d.general.cosecha), flete: t(d.general.flete), viaje: t(d.general.viaje) });
    } catch (e) { onError((e as Error).message); }
  }, [onError]);
  useEffect(() => { void cargar(); }, [cargar]);
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const valida = (n: number | null) => n == null || (Number.isFinite(n) && n > 0);

  async function correr(fn: () => Promise<string>): Promise<boolean> {
    try { setBusy(true); const msg = await fn(); await cargar(); onChanged(msg); return true; }
    catch (e) { onError((e as Error).message); return false; } finally { setBusy(false); }
  }
  const guardarGeneral = () => correr(async () => {
    const c = num(gen.cosecha), f = num(gen.flete), v = num(gen.viaje);
    if (!valida(c) || !valida(f) || !valida(v)) throw new Error("Las tarifas deben ser mayores a 0 (o vacías)");
    await apiPut("/campo/tarifas-cliente/general", { cosecha: c, flete: f, viaje: v });
    return "Tarifa general guardada";
  });
  const guardarCliente = (id: string, nombre: string, c: number | null, f: number | null, v: number | null) => correr(async () => {
    if (!valida(c) || !valida(f) || !valida(v)) throw new Error("Las tarifas deben ser mayores a 0 (o vacías)");
    await apiPut(`/campo/tarifas-cliente/${id}`, { cosecha: c, flete: f, viaje: v });
    return c == null && f == null && v == null ? `${nombre}: usa la tarifa general` : `Tarifa de ${nombre} guardada`;
  });
  const agregar = async () => {
    if (!cliente) { onError("Elige el cliente"); return; }
    const c = num(nueva.cosecha), f = num(nueva.flete), v = num(nueva.viaje);
    if (c == null && f == null && v == null) { onError("Escribe al menos una tarifa (cosecha, flete o viaje)"); return; }
    if (await guardarCliente(cliente.id, cliente.nombre, c, f, v)) { setCliente(null); setNueva({ cosecha: "", flete: "", viaje: "" }); }
  };
  const inp: CSSProperties = { width: 100, textAlign: "right" };
  return (
    <div className="formPanel" style={{ gridColumn: "1 / -1" }}>
      <h2>💲 Tarifas a clientes</h2>
      <p className="muted" style={{ marginTop: -4 }}>
        Precio por <b>QQ</b> que se le cobra al cliente. Al <b>Generar cobro</b> de un parte el precio sale solo: el del cliente
        y, si no tiene, el general. Siempre se puede cambiar en ese momento. <b>Flete por viaje</b>: lo que se cobra por el
        viaje completo cuando el carro no llevó los QQ que debía (en el cobro eliges «Por viaje»).
      </p>
      <div className="campoSaldos__form">
        <label><span>General · cosecha $/QQ</span><input type="number" inputMode="decimal" min="0" step="0.0001" value={gen.cosecha} placeholder="sin tarifa" onChange={(e) => setGen({ ...gen, cosecha: e.target.value })} /></label>
        <label><span>General · flete $/QQ</span><input type="number" inputMode="decimal" min="0" step="0.0001" value={gen.flete} placeholder="sin tarifa" onChange={(e) => setGen({ ...gen, flete: e.target.value })} /></label>
        <label><span>General · flete $/viaje</span><input type="number" inputMode="decimal" min="0" step="0.01" value={gen.viaje} placeholder="sin tarifa" onChange={(e) => setGen({ ...gen, viaje: e.target.value })} /></label>
        <button type="button" className="primary" disabled={busy} onClick={() => void guardarGeneral()}>Guardar tarifa general</button>
      </div>
      <h3 style={{ margin: "14px 0 6px", fontSize: 14 }}>Tarifa propia de cada cliente</h3>
      {data && data.clientes.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table className="cajaTable" style={{ width: "100%", minWidth: 520 }}>
            <thead><tr><th>Cliente</th><th className="num">Cosecha $/QQ</th><th className="num">Flete $/QQ</th><th className="num">Flete $/viaje</th><th /></tr></thead>
            <tbody>
              {data.clientes.map((c) => (
                <tr key={`${c.id}-${c.tarifa_cosecha_qq}-${c.tarifa_flete_qq}-${c.tarifa_flete_viaje}`}>
                  <td>{c.nombre}{c.tipo === "piladora" && <small className="muted"> · socio</small>}</td>
                  {(["tarifa_cosecha_qq", "tarifa_flete_qq", "tarifa_flete_viaje"] as const).map((k) => (
                    <td key={k} className="num">
                      <input type="number" inputMode="decimal" min="0" step="0.0001" style={inp} defaultValue={c[k] ?? ""} placeholder="general"
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        onBlur={(e) => {
                          const v = num(e.target.value);
                          if (v === c[k]) return;
                          void guardarCliente(c.id, c.nombre, k === "tarifa_cosecha_qq" ? v : c.tarifa_cosecha_qq, k === "tarifa_flete_qq" ? v : c.tarifa_flete_qq,
                            k === "tarifa_flete_viaje" ? v : c.tarifa_flete_viaje);
                        }} />
                    </td>
                  ))}
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="btnGhost" disabled={busy} onClick={() => void guardarCliente(c.id, c.nombre, null, null, null)}>Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted" style={{ margin: "0 0 6px" }}>Ningún cliente tiene tarifa propia: todos usan la general.</p>}
      <div className="campoSaldos__form" style={{ marginTop: 8 }}>
        <ClientePicker value={cliente} onChange={setCliente} onError={onError} />
        <label><span>Cosecha $/QQ</span><input type="number" inputMode="decimal" min="0" step="0.0001" value={nueva.cosecha} placeholder="(general)" onChange={(e) => setNueva({ ...nueva, cosecha: e.target.value })} /></label>
        <label><span>Flete $/QQ</span><input type="number" inputMode="decimal" min="0" step="0.0001" value={nueva.flete} placeholder="(general)" onChange={(e) => setNueva({ ...nueva, flete: e.target.value })} /></label>
        <label><span>Flete $/viaje</span><input type="number" inputMode="decimal" min="0" step="0.01" value={nueva.viaje} placeholder="(general)" onChange={(e) => setNueva({ ...nueva, viaje: e.target.value })} /></label>
        <button type="button" className="btnSecondary" disabled={busy} onClick={() => void agregar()}>➕ Agregar tarifa del cliente</button>
      </div>
    </div>
  );
}

// ── 📄 Documentos de la flota: matrícula, SOAT, revisión técnica… con su vencimiento ──
type DocumentoFlota = {
  id: string; activo_id: string; activo_nombre: string; placa_codigo: string | null; activo_vigente: boolean;
  tipo: "matricula" | "soat" | "revision" | "seguro" | "permiso" | "otro"; descripcion: string | null; numero: string | null;
  vence: string; notas: string | null; dias: number;
};
const TIPOS_DOC: Array<{ id: DocumentoFlota["tipo"]; label: string }> = [
  { id: "matricula", label: "Matrícula" }, { id: "soat", label: "SOAT" }, { id: "revision", label: "Revisión técnica" },
  { id: "seguro", label: "Seguro" }, { id: "permiso", label: "Permiso" }, { id: "otro", label: "Otro" }
];
const nombreDoc = (d: Pick<DocumentoFlota, "tipo" | "descripcion">) => (d.tipo === "otro" && d.descripcion ? d.descripcion : TIPOS_DOC.find((t) => t.id === d.tipo)?.label ?? d.tipo);
const fechaDoc = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

function DocumentosFlotaCampo({ activos, onChanged, onError }: { activos: Activo[]; onChanged: (msg: string) => void; onError: (m: string) => void }) {
  const [docs, setDocs] = useState<DocumentoFlota[] | null>(null);
  const [f, setF] = useState({ activo_id: "", tipo: "matricula" as DocumentoFlota["tipo"], descripcion: "", numero: "", vence: "" });
  const [renovando, setRenovando] = useState<{ id: string; vence: string; numero: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const cargar = useCallback(async () => {
    try { setDocs(await apiGet<DocumentoFlota[]>("/campo/documentos")); } catch (e) { onError((e as Error).message); }
  }, [onError]);
  useEffect(() => { void cargar(); }, [cargar]);
  async function correr(fn: () => Promise<string>) {
    try { setBusy(true); const msg = await fn(); await cargar(); onChanged(msg); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }
  const agregar = () => correr(async () => {
    if (!f.activo_id) throw new Error("Elige el vehículo o la máquina");
    if (!f.vence) throw new Error("Pon la fecha en que vence");
    if (f.tipo === "otro" && f.descripcion.trim().length < 2) throw new Error("Escribe qué documento es");
    await apiPost("/campo/documentos", { activo_id: f.activo_id, tipo: f.tipo, vence: f.vence, numero: f.numero.trim() || null, descripcion: f.tipo === "otro" ? f.descripcion.trim() : null });
    setF({ ...f, numero: "", descripcion: "", vence: "" });
    return "Documento agregado";
  });
  const renovar = (d: DocumentoFlota) => correr(async () => {
    if (!renovando?.vence) throw new Error("Pon la nueva fecha de vencimiento");
    await apiOk(`/campo/documentos/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vence: renovando.vence, numero: renovando.numero.trim() || null }) });
    const hasta = renovando.vence;
    setRenovando(null);
    return `${nombreDoc(d)} de ${d.activo_nombre} renovado hasta el ${fechaDoc(hasta)}`;
  });
  const quitar = async (d: DocumentoFlota) => {
    if (!(await confirmar(`¿Quitar ${nombreDoc(d)} de ${d.activo_nombre}?`))) return;
    void correr(async () => { await apiOk(`/campo/documentos/${d.id}`, { method: "DELETE" }); return "Documento quitado"; });
  };
  const estado = (d: DocumentoFlota) => d.dias < 0
    ? { cls: "bad", txt: `Vencido hace ${-d.dias} día(s)` }
    : d.dias <= 30 ? { cls: "warn", txt: d.dias === 0 ? "Vence hoy" : `Vence en ${d.dias} día(s)` } : { cls: "ok", txt: "Al día" };
  const vencidos = (docs ?? []).filter((d) => d.dias < 0 && d.activo_vigente).length;
  const pronto = (docs ?? []).filter((d) => d.dias >= 0 && d.dias <= 30 && d.activo_vigente).length;
  return (
    <div className="formPanel" style={{ gridColumn: "1 / -1" }}>
      <h2>📄 Documentos de la flota {vencidos > 0 && <span className="chip bad">{vencidos} vencido(s)</span>} {pronto > 0 && <span className="chip warn">{pronto} por vencer</span>}</h2>
      <p className="muted" style={{ marginTop: -4 }}>Matrícula, SOAT, revisión técnica, seguro y permisos de cada vehículo. Desde 30 días antes de vencer avisan en <b>Hoy</b> y en las alertas de Transporte. Al renovarlo, pon la nueva fecha.</p>
      <div className="campoSaldos__form">
        <label><span>Vehículo / máquina</span>
          <select value={f.activo_id} onChange={(e) => setF({ ...f, activo_id: e.target.value })}>
            <option value="">Seleccione…</option>
            {activos.filter((a) => a.activo).map((a) => <option key={a.id} value={a.id}>{a.nombre}{a.placa_codigo ? ` · ${a.placa_codigo}` : ""}</option>)}
          </select></label>
        <label><span>Documento</span>
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as DocumentoFlota["tipo"] })}>
            {TIPOS_DOC.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select></label>
        {f.tipo === "otro" && <label><span>¿Cuál?</span><input type="text" maxLength={120} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} placeholder="Ej: Permiso municipal" /></label>}
        <label><span>Número <small>(opcional)</small></span><input type="text" maxLength={60} value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} /></label>
        <label><span>Vence</span><input type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} /></label>
        <button type="button" className="primary" disabled={busy} onClick={() => void agregar()}>➕ Agregar documento</button>
      </div>
      {docs && docs.length > 0 ? (
        <div className="campoDocs">
          {docs.map((d) => {
            const e = estado(d);
            return (
              <div key={d.id} className={`campoDocs__item ${d.activo_vigente ? "" : "is-baja"}`}>
                <div className="campoDocs__txt">
                  <strong>{d.activo_nombre} · {nombreDoc(d)}</strong>
                  <small>{d.numero ? `N.º ${d.numero} · ` : ""}vence {fechaDoc(d.vence)}{d.activo_vigente ? "" : " · máquina dada de baja"}</small>
                </div>
                <span className={`chip ${e.cls}`}>{e.txt}</span>
                {renovando?.id === d.id ? (
                  <div className="campoDocs__renovar">
                    <input type="date" value={renovando.vence} onChange={(ev) => setRenovando({ ...renovando, vence: ev.target.value })} aria-label="Nueva fecha de vencimiento" />
                    <input type="text" maxLength={60} value={renovando.numero} placeholder="N.º (opcional)" onChange={(ev) => setRenovando({ ...renovando, numero: ev.target.value })} />
                    <button type="button" className="primary" disabled={busy} onClick={() => void renovar(d)}>Guardar</button>
                    <button type="button" className="btnGhost" onClick={() => setRenovando(null)}>Cancelar</button>
                  </div>
                ) : (
                  <div className="campoDocs__acc">
                    <button type="button" className="btnSecondary" onClick={() => setRenovando({ id: d.id, vence: "", numero: d.numero ?? "" })}>🔄 Renovar</button>
                    <button type="button" className="btnGhost" disabled={busy} onClick={async () => (await quitar(d))}>Quitar</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : <p className="muted">{docs ? "Sin documentos registrados." : "Cargando…"}</p>}
    </div>
  );
}
