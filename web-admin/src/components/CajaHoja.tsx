import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { money } from "../format";
import { CLASE_DE_CATEGORIA, NOMBRE_CORTO, categoriaPorNombreCorto, detectarMaquina, nombreCortoPorConcepto } from "./cajaHojaMaquina";
import { categoriaPorPalabras, diceAgricultor, diceCobro, diceFondo, dicePago, leerCuadrilla, leerPersona, leerResponsable, leerVenta, type ActividadHoja, type ModoHoja, type ProductoHoja, buscarRegla, dicePalabras, tieneSuFlujo, type ReglaCaja } from "./cajaHojaLeer";
import { calcularVentaDetalle, DESCUENTO_QQ_DEFECTO, formatoCantidad } from "../ventaDetalle";

// 📋 CAJA TIPO HOJA DE CÁLCULO (pedido del dueño 2026-10-30): los movimientos de la sesión en filas continuas, como su
// Excel de caja (FECHA · CONCEPTO · CATEGORÍA · CÓDIGO · ENTRADAS · SALIDAS · SALDO), con el saldo acumulado fila por
// fila y una fila de captura al final: Enter o Tab pasa de celda en celda y Enter en el monto guarda.
// Todo se registra desde aquí (pedido del dueño 2026-11-04): gastos, trabajo en una máquina, ventas, abonos a agricultores,
// cuadrilla, fondos a rendir, cobros y pagos de cuentas. La fila entiende lo escrito (cajaHojaLeer.ts); lo poco que falte se
// pide debajo de la misma fila. Lo que de verdad necesita una lista (sacos, activo fijo, bodega) abre un panel sobre la hoja.
// Guardar no detiene a la cajera: la fila se limpia al instante y lo escrito se envía en orden (ver «cola»).

export type HojaMov = {
  id: string; movement: "INCOME" | "EXPENSE"; category: string; amount: string | number; description: string | null;
  reference_type: string | null; created_at: string; reversal_of?: string | null; reversed_at?: string | null;
  reversed_reason?: string | null; subcategoria?: string | null; proveedor_nombre?: string | null; medio?: string | null;
  es_fondo?: boolean; fondo_estado?: string | null; responsable?: string | null; codigo?: string | null;
  maq_activo?: string | null; area?: string | null;
  /** Orden real en que se guardó (la fecha puede ser de un día anterior). */
  registro?: string | number | null;
};
export type HojaCredito = {
  id: string; amount: string | number; balance: string | number; status: string; created_at: string;
  description?: string | null; categoria?: string | null; proveedor_nombre?: string | null;
  /** Lo registró Transporte: no es de esta caja y se anula allá. */
  transporte?: boolean;
};
export type HojaCategoria = { codigo: string; nombre: string; tipo: "INGRESO" | "EGRESO" };
/** 🧭 «¿De quién?» (pedido del dueño 2026-10-30): de esta caja, de Transporte (una máquina o general), un anticipo a
 *  un operador de Transporte, o un gasto de un socio. Cada uno sigue su flujo (cruces, vale, deuda), no un egreso suelto. */
export type HojaDestino = {
  valor: string;
  tipo: "propio" | "transporte" | "anticipo" | "socio" | "planta" | "agricultor" | "cuadrilla" | "venta" | "fondo" | "cobro" | "pago";
  id?: string; detalle?: string; claves?: string[]; area?: string; section?: string;
  /** Agricultor, cobro o pago: el nombre de la persona, para reconocerla en lo escrito. */
  nombre?: string;
  /** Cobro o pago: sus cuentas pendientes y cuánto suman. */
  cuentas?: string[]; saldo?: number;
};
export type HojaNueva = {
  movement: "INCOME" | "EXPENSE"; category: string; amount: number; description: string; codigo: string; medio: "EFECTIVO" | "BANCO";
  destino?: HojaDestino;
  /** 💳 No salió de la gaveta: lo pagó el banco / la tarjeta de débito de esta empresa. */
  banco?: boolean;
  /** 🤝 Lo pagó un socio con su dinero: no sale de la gaveta y se le debe. */
  pagadoPor?: { id: string; nombre: string };
  /** 📝 A crédito: a quién se le queda debiendo. */
  credito?: { acreedor: string };
  /** Día del movimiento si no es hoy (AAAA-MM-DD). */
  fecha?: string;
  /** ⏳ Fondo a rendir: quién recibe. */
  responsable?: string;
  /** 👷 Trabajo de cuadrilla que se paga en el momento. */
  cuadrilla?: { actividadId: string; actividad: string; cantidad: number; quien: string };
  /** 🛒 Venta al detalle. */
  venta?: { producto: ProductoHoja; modo: ModoHoja; cantidad: number; qq: number; libras: number; cliente: string; fiado: boolean };
};

/** Rubro flexible (migración 20261129): donaciones, refrigerios, aportes menores… con descripción libre. */
export const RUBRO_VARIOS = { EGRESO: "GASTOS_VARIOS", INGRESO: "INGRESOS_VARIOS" } as const;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const sinTilde = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const unir = (s: string, c: string) => [s.trim(), c.trim()].filter(Boolean).join(" · ");
const diaEc = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const fechaCorta = (iso: string) => new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
// Caja simplificada (pedido del dueño 2026-11-03): columnas Fecha · Concepto · Entradas · Salidas · Saldo. La categoría
// y «¿De quién?» van como etiquetas bajo el concepto (se llenan solas por lo escrito y se cambian con un clic); el
// código queda 001 por dentro. Los movimientos de otros módulos se ven siempre, en gris, para que el saldo cuadre fila a fila.
const CELDAS = ["sujeto", "concepto", "categoria", "quien", "entrada", "salida", "actividad", "cantidad", "tarifa", "cuadrilla", "responsable", "acreedor", "cliente", "opCant", "opPrecio"] as const;
const CODIGO = "001";
// Para reconocer la máquina en el concepto: «Diésel cose 10,1» → COS101 (como «COS.10.1»).
export const claveMaq = (x: string) => sinTilde(x).toUpperCase().replace(/\bCOSE\b/g, "COS").replace(/[^A-Z0-9]/g, "");
type Celda = typeof CELDAS[number];
// Lo que siempre es salida o entrada por lo que es, sin mirar la categoría.
const SIEMPRE_SALIDA = new Set<HojaDestino["tipo"]>(["anticipo", "agricultor", "cuadrilla", "fondo", "pago"]);
const SIEMPRE_ENTRADA = new Set<HojaDestino["tipo"]>(["venta", "cobro"]);
// No piden categoría: su flujo ya sabe qué es.
const CATEGORIA_FIJA: Partial<Record<HojaDestino["tipo"], string>> = {
  agricultor: "Arroz en cáscara", cuadrilla: "Cuadrilla", venta: "Venta al detalle", cobro: "Cobro de cuenta", pago: "Pago de cuenta", anticipo: "Anticipo"
};
const numero = (x: string) => Number(x.replace(",", "."));
const etiquetaActividad = (a: ActividadHoja) => `${a.name} · $${a.unit_rate}`;
// ⚡ Tipo de operación (pedido del dueño 2026-11-24): «automático» lo lee de lo escrito, como siempre; los otros fijan qué es.
type Op = "" | "venta" | "arroz" | "compra" | "gasto";
const OPS: Array<{ clave: Op; texto: string; tecla: string }> = [
  { clave: "", texto: "0 · Automático", tecla: "0" }, { clave: "venta", texto: "1 · Venta", tecla: "1" }, { clave: "arroz", texto: "2 · Pago arroz", tecla: "2" },
  { clave: "compra", texto: "3 · Compra", tecla: "3" }, { clave: "gasto", texto: "4 · Gasto", tecla: "4" }
];
const DETALLE_CANTIDAD = / · [\d.,]+( qq)? × \$[\d.,]+$/i;
type Orden = "registro" | "fecha";
const leerOrden = (): Orden => { try { return localStorage.getItem("bascula-erp:caja-orden") === "fecha" ? "fecha" : "registro"; } catch { return "registro"; } };
const diaLargo = (iso: string) => new Date(iso).toLocaleDateString("es-EC", { weekday: "long", day: "2-digit", month: "long", timeZone: "America/Guayaquil" });
const PAGO_GAVETA = "";
type Campos = {
  sujeto: string; concepto: string; catTxt: string; quienTxt: string; quienManual: boolean; catManual: boolean; entrada: string; salida: string; montoManual: boolean; pago: string;
  responsable: string; acreedor: string; actTxt: string; cantTxt: string; tarifaTxt: string; cuadTxt: string; clienteTxt: string; fiado: boolean; op: Op; opCant: string; opPrecio: string;
};
type FilaEnCola = { id: number; fila: HojaNueva; campos: Campos; estado: "espera" | "enviando" | "listo" | "error"; error?: string };

export function CajaHoja({
  movimientos, creditos, verOtros, origenExterno, saldoInicial, categorias, sugerencias, mixto, puedeAnular,
  esCompleja, onGuardar, onFormularioCompleto, onAnular, onAnularCredito, onRepetir, onLiquidarFondo,
  destinos = [], puedeBanco = false, abiertaEl = null,
  productos = [], actividades = [], clientes = [], descuentoQq = DESCUENTO_QQ_DEFECTO, socios = [], memoria = [], reglas = [], onRefrescar, onError
}: {
  /** Reglas de Configuración: «si dice esto, es esta categoría». */
  reglas?: ReglaCaja[];
  /** La última categoría que se le puso a cada concepto en esta caja (meses anteriores incluidos). */
  memoria?: Array<{ concepto: string; category: string }>;
  /** Productos que se venden al detalle (con su tarifa por libra). */
  productos?: ProductoHoja[];
  /** Trabajos de la cuadrilla con su tarifa. */
  actividades?: ActividadHoja[];
  /** Nombres para el cliente de una venta. */
  clientes?: string[];
  descuentoQq?: number;
  /** Quién puede haber pagado un gasto con su dinero. */
  socios?: Array<{ id: string; name: string }>;
  /** Vuelve a leer la caja cuando terminó de guardarse lo escrito. */
  onRefrescar: () => Promise<unknown>;
  /** Aviso si algo no se guardó. */
  onError: (mensaje: string) => void;
  /** Cuándo se abrió la caja: no se registra nada antes de ese día. */
  abiertaEl?: string | null;
  /** Opciones de «¿De quién?» (la primera es esta caja). Vacío = no se muestra la columna. */
  destinos?: HojaDestino[];
  /** Permite marcar «💳 No es efectivo» (banco / tarjeta de esta empresa). */
  puedeBanco?: boolean;
  movimientos: HojaMov[];
  creditos: HojaCredito[];
  verOtros: boolean;
  origenExterno: (m: HojaMov) => string | null;
  saldoInicial: number;
  /** Categorías activas que esta caja puede usar a mano. */
  categorias: HojaCategoria[];
  /** Nombres frecuentes para el autocompletado del concepto (agricultores, socios, gastos). */
  sugerencias: string[];
  mixto: boolean;
  puedeAnular: boolean;
  esCompleja: (codigo: string, movement: "INCOME" | "EXPENSE") => boolean;
  onGuardar: (f: HojaNueva) => Promise<void>;
  onFormularioCompleto: (movement: "INCOME" | "EXPENSE", category: string, description: string, amount: number | null) => void;
  onAnular: (m: HojaMov) => void;
  onAnularCredito: (c: HojaCredito) => void;
  onRepetir: (m: HojaMov) => void;
  onLiquidarFondo: (m: HojaMov) => void;
}) {
  // Como las columnas CLIENTE y CONCEPTO del Excel: quién o qué máquina, y qué se hizo. Se leen juntos.
  const [sujeto, setSujeto] = useState("");
  const [concepto, setConcepto] = useState("");
  const texto = unir(sujeto, concepto);
  const [catTxt, setCatTxt] = useState("");
  const [entrada, setEntrada] = useState("");
  const [salida, setSalida] = useState("");
  const [medio, setMedio] = useState<"EFECTIVO" | "BANCO">("EFECTIVO");
  const [quienTxt, setQuienTxt] = useState("");
  const [quienManual, setQuienManual] = useState(false);
  // Se queda entre un movimiento y otro: para pasar varios del mismo día anterior. Esc vuelve a hoy.
  const hoy = diaEc(new Date());
  const [fecha, setFecha] = useState(hoy);
  // ¿Cómo se pagó? "" = de la gaveta · BANCO · CREDITO · SOCIO:<id>
  const [pago, setPago] = useState(PAGO_GAVETA);
  const [menuPago, setMenuPago] = useState<HTMLElement | null>(null);
  const conQuien = destinos.length > 0;
  const [error, setError] = useState("");
  // Lo que se pide debajo de la fila según lo que sea.
  const [catManual, setCatManual] = useState(false);
  const [montoManual, setMontoManual] = useState(false);
  const [responsable, setResponsable] = useState("");
  const [respManual, setRespManual] = useState(false);
  const [acreedor, setAcreedor] = useState("");
  const [actTxt, setActTxt] = useState("");
  const [cantTxt, setCantTxt] = useState("");
  const [tarifaTxt, setTarifaTxt] = useState("");
  const [cuadTxt, setCuadTxt] = useState("CUADRILLA");
  const [cuadManual, setCuadManual] = useState({ act: false, cant: false, tarifa: false });
  const [clienteTxt, setClienteTxt] = useState("CONSUMIDOR FINAL");
  const [fiado, setFiado] = useState(false);
  // 🚀 Cola: Enter limpia la fila al instante y lo escrito se guarda en orden. Antes la fila quedaba bloqueada hasta releer
  // la caja (1 a 3 segundos) y lo que se escribía en ese rato se perdía o caía en otra casilla.
  const [op, setOp] = useState<Op>("");
  const [opCant, setOpCant] = useState("");
  const [opPrecio, setOpPrecio] = useState("");
  const opVisto = useRef(false);
  const [orden, setOrdenState] = useState<Orden>(leerOrden);
  const setOrden = (o: Orden) => { setOrdenState(o); try { localStorage.setItem("bascula-erp:caja-orden", o); } catch { /* solo se recuerda por equipo */ } };
  const [busca, setBusca] = useState("");
  const [ver, setVer] = useState<"todo" | "INCOME" | "EXPENSE">("todo");
  const [cola, setCola] = useState<FilaEnCola[]>([]);
  const colaRef = useRef<FilaEnCola[]>([]);
  const corriendo = useRef(false);
  const idCola = useRef(0);
  const guardarRef = useRef(onGuardar); guardarRef.current = onGuardar;
  const refrescarRef = useRef(onRefrescar); refrescarRef.current = onRefrescar;
  const avisarRef = useRef(onError); avisarRef.current = onError;
  // Trabajo sin máquina: se pregunta cuál, y queda el formulario para lo que va a bodega.
  const [pideMaquina, setPideMaquina] = useState<{ codigo: string; monto: number | null } | null>(null);
  const refs = useRef<Partial<Record<Celda, HTMLInputElement | null>>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const nombreCat = useMemo(() => new Map(categorias.map((c) => [c.codigo, c.nombre])), [categorias]);
  const maquinasPlanta = useMemo(() => destinos.flatMap((d) => (d.tipo === "planta" && d.area && d.section ? [{ ...d, area: d.area, section: d.section }] : [])), [destinos]);
  const hayPlanta = maquinasPlanta.length > 0;
  // Reparación, repuesto o material: se guardan aquí mismo si dicen para qué máquina.
  const esTrabajo = (codigo: string) => hayPlanta && !!CLASE_DE_CATEGORIA[codigo];
  // Transporte y socios siguen su flujo; la máquina de la planta solo en un trabajo. Lo demás abre el formulario si lo pide.
  const saltaFormulario = (d: HojaDestino | null, codigo: string) =>
    !!d && d.tipo !== "propio" && (d.tipo !== "planta" || esTrabajo(codigo));
  // Categoría escrita → la del catálogo (nombre exacto; si no, la única que empieza o contiene lo escrito).
  const resolverCat = (txt: string): HojaCategoria | null => {
    const t = sinTilde(txt.replace(/^[+−-]\s*/, ""));
    if (!t) return null;
    const exacta = categorias.find((c) => sinTilde(c.nombre) === t || sinTilde(c.codigo) === t);
    if (exacta) return exacta;
    const corta = categoriaPorNombreCorto(t);
    if (corta && hayPlanta) { const c = categorias.find((x) => x.codigo === corta); if (c) return c; }
    const empieza = categorias.filter((c) => sinTilde(c.nombre).startsWith(t));
    if (empieza.length === 1) return empieza[0];
    const contiene = categorias.filter((c) => sinTilde(c.nombre).includes(t));
    return contiene.length === 1 ? contiene[0] : null;
  };
  // «¿De quién?» escrito → la opción (exacta; si no, la única que empieza o contiene lo escrito). Vacío = esta caja.
  const resolverQuien = (txt: string): HojaDestino | null => {
    if (!conQuien) return null;
    const t = sinTilde(txt);
    if (!t) return destinos[0];
    const exacta = destinos.find((d) => sinTilde(d.valor) === t);
    if (exacta) return exacta;
    const empieza = destinos.filter((d) => sinTilde(d.valor).startsWith(t));
    if (empieza.length === 1) return empieza[0];
    const contiene = destinos.filter((d) => sinTilde(d.valor).includes(t));
    return contiene.length === 1 ? contiene[0] : null;
  };
  const personasDe = (t: HojaDestino["tipo"]) => destinos.filter((d) => d.tipo === t && d.nombre).map((d) => ({ ...d, nombre: d.nombre! }));
  const agricultores = useMemo(() => personasDe("agricultor"), [destinos]); // eslint-disable-line react-hooks/exhaustive-deps
  const porCobrar = useMemo(() => personasDe("cobro"), [destinos]); // eslint-disable-line react-hooks/exhaustive-deps
  const porPagar = useMemo(() => personasDe("pago"), [destinos]); // eslint-disable-line react-hooks/exhaustive-deps
  // Lo que dice el concepto: «20 lb de 0,11» → venta; «Diésel cose 10» → Transporte · COS.10; «Anticipo LEONEL» → vale de
  // LEONEL; «Abono Gabino» → su cuenta; «Anticipo Jacobo» sin más → fondo a rendir.
  const detectarQuien = (txt: string): HojaDestino | null => {
    if (!conQuien || !txt.trim()) return null;
    const ventas = destinos.filter((d) => d.tipo === "venta");
    if (ventas.length && leerVenta(txt, productos)) {
      const k = claveMaq(txt);
      return ventas.find((d) => d.nombre && k.includes(claveMaq(d.nombre))) ?? ventas[0];
    }
    if (actividades.length && leerCuadrilla(txt, actividades)) {
      const c = destinos.find((d) => d.tipo === "cuadrilla");
      if (c) return c;
    }
    const k = claveMaq(txt);
    if (/ANTICIPO/.test(k)) {
      const op = destinos.find((d) => d.tipo === "anticipo" && (d.claves ?? []).some((c) => c && k.includes(c)));
      if (op) return op;
    }
    const maquinas = destinos.filter((d) => d.tipo === "transporte" && d.id)
      .map((d) => ({ d, c: [...(d.claves ?? [])].filter((x) => x.length >= 4).filter((x) => k.includes(x)).sort((a, b) => b.length - a.length)[0] ?? "" }))
      .filter((x) => x.c).sort((a, b) => b.c.length - a.c.length);
    const maquina = maquinas[0]?.d ?? detectarMaquina(txt, maquinasPlanta);
    if (maquina) return maquina;
    const agricultor = leerPersona(txt, agricultores);
    if (agricultor && (diceAgricultor(txt) || sinTilde(txt) === sinTilde(agricultor.nombre))) return agricultor;
    const cobro = diceCobro(txt) ? leerPersona(txt, porCobrar) : null;
    if (cobro) return cobro;
    const paga = dicePago(txt) ? leerPersona(txt, porPagar) : null;
    if (paga) return paga;
    return diceFondo(txt) ? destinos.find((d) => d.tipo === "fondo") ?? null : null;
  };
  const detectarVenta = (txt: string) => { const d = detectarQuien(txt); return d?.tipo === "venta" ? d : null; };
  // Pago de arroz: el agricultor escrito en el primer recuadro (o en la línea).
  const agricultorEscrito = () => {
    const t = sinTilde(sujeto);
    if (!t && !concepto.trim()) return null;
    const exacto = agricultores.find((a) => sinTilde(a.nombre) === t);
    if (exacto) return exacto;
    const empieza = t.length >= 3 ? agricultores.filter((a) => sinTilde(a.nombre).startsWith(t)) : [];
    return empieza.length === 1 ? empieza[0] : leerPersona(texto, agricultores);
  };
  const quien = resolverQuien(quienTxt);
  const tipoQuien = quien?.tipo;
  const esVenta = tipoQuien === "venta";
  const esCuadrilla = tipoQuien === "cuadrilla";
  const esFondo = tipoQuien === "fondo";
  const catFija = tipoQuien ? CATEGORIA_FIJA[tipoQuien] : undefined;
  const cat = catFija ? null : resolverCat(catTxt);
  const tipo: "INCOME" | "EXPENSE" | null = tipoQuien && SIEMPRE_SALIDA.has(tipoQuien) ? "EXPENSE" : tipoQuien && SIEMPRE_ENTRADA.has(tipoQuien) ? "INCOME"
    : cat ? (cat.tipo === "INGRESO" ? "INCOME" : "EXPENSE") : null;
  // Mientras escribe el concepto, «¿Para qué?» aparece solo (si la cajera no lo eligió a mano).
  useEffect(() => {
    if (!conQuien || quienManual) return;
    if (op === "venta") setQuienTxt((detectarVenta(texto) ?? destinos.find((d) => d.tipo === "venta"))?.valor ?? "");
    else if (op === "arroz") setQuienTxt(agricultorEscrito()?.valor ?? "");
    else setQuienTxt(detectarQuien(texto)?.valor ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, quienManual, destinos, op]);

  // ⚡ Cantidad × precio llena el monto (pago de arroz por QQ, compra por unidades). Se puede escribir el monto directo.
  const conCantidad = op === "arroz" || op === "compra";
  const totalOp = r2(numero(opCant) * numero(opPrecio));
  useEffect(() => {
    if (conCantidad && !montoManual) setSalida(totalOp > 0 ? totalOp.toFixed(2) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conCantidad, montoManual, totalOp]);
  const elegirOp = (o: Op) => {
    setOp(o); setError(""); setQuienManual(false); setQuienTxt(""); setCatManual(false); opVisto.current = false;
    if (o !== "arroz" && o !== "compra") { if (opCant || opPrecio) { setOpCant(""); setOpPrecio(""); } if (!montoManual) setSalida(""); }
    enfocar("sujeto");
  };

  // 🛒 Lo que dice la venta y cuánto da con la tarifa del producto.
  const ventaLeida = esVenta ? leerVenta(texto, productos) : null;
  const calculo = ventaLeida && ventaLeida.cantidad != null
    ? calcularVentaDetalle({ cantidad: ventaLeida.cantidad, precioLibra: ventaLeida.producto.precioLibra, modo: ventaLeida.modo, descuentoQq })
    : null;
  useEffect(() => {
    if (esVenta && !montoManual) setEntrada(calculo && calculo.total > 0 ? calculo.total.toFixed(2) : ventaLeida?.modo === "DOLARES" && ventaLeida.cantidad ? String(ventaLeida.cantidad) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esVenta, montoManual, calculo?.total, ventaLeida?.modo, ventaLeida?.cantidad]);

  // 👷 Trabajo de cuadrilla: lo escrito llena trabajo, cantidad y tarifa; el monto sale solo.
  const actividad = useMemo(() => {
    const t = sinTilde(actTxt.split("·")[0]);
    if (!t) return null;
    const exacta = actividades.find((a) => sinTilde(a.name) === t);
    if (exacta) return exacta;
    const empieza = actividades.filter((a) => sinTilde(a.name).startsWith(t));
    return empieza.length === 1 ? empieza[0] : null;
  }, [actTxt, actividades]);
  useEffect(() => {
    if (!esCuadrilla) return;
    const l = leerCuadrilla(texto, actividades);
    if (!cuadManual.act) setActTxt(l?.actividad ? etiquetaActividad(l.actividad) : "");
    if (!cuadManual.cant) setCantTxt(l?.cantidad != null ? String(l.cantidad) : "");
    if (!cuadManual.tarifa) setTarifaTxt(l?.tarifa != null ? String(l.tarifa) : l?.actividad ? String(l.actividad.unit_rate) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esCuadrilla, texto, actividades]);
  const totalCuadrilla = r2(numero(cantTxt) * numero(tarifaTxt));
  useEffect(() => {
    if (esCuadrilla && !montoManual) setSalida(totalCuadrilla > 0 ? totalCuadrilla.toFixed(2) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esCuadrilla, montoManual, totalCuadrilla]);

  // ⏳ Fondo a rendir: quién recibe sale de lo escrito.
  useEffect(() => {
    if (esFondo && !respManual) setResponsable(leerResponsable(texto));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esFondo, texto]);

  // 💳 ¿Cómo se pagó? Lo que vale según lo que sea.
  const opcionesPago = useMemo(() => {
    if (tipo === "INCOME" || (tipoQuien && !["propio", "planta", "transporte", "agricultor", "fondo"].includes(tipoQuien))) return [];
    if (tipoQuien === "fondo") return [];
    const banco = puedeBanco && !mixto ? [{ clave: "BANCO", icono: "🏦", titulo: "Banco o tarjeta de esta empresa", detalle: "transferencia, cheque o débito: no sale de la gaveta" }] : [];
    if (tipoQuien === "planta" || tipoQuien === "agricultor") return banco;
    return [
      ...banco,
      ...socios.map((x) => ({ clave: `SOCIO:${x.id}`, icono: "🤝", titulo: `Lo pagó ${x.name}`, detalle: "con su dinero: no sale de la gaveta y se le debe" })),
      { clave: "CREDITO", icono: "📝", titulo: "A crédito", detalle: "queda debiendo: no sale de la gaveta" }
    ];
  }, [tipo, tipoQuien, puedeBanco, mixto, socios]);
  useEffect(() => { if (pago && !opcionesPago.some((o) => o.clave === pago)) setPago(PAGO_GAVETA); }, [pago, opcionesPago]);
  const pagoElegido = opcionesPago.find((o) => o.clave === pago);
  const conCredito = pago === "CREDITO";

  // Memoria: el mismo concepto escrito antes sugiere su categoría.
  const catPorConcepto = useMemo(() => {
    const m = new Map<string, string>(memoria.map((x) => [sinTilde(x.concepto.replace(DETALLE_CANTIDAD, "")), x.category]));
    for (const x of [...movimientos].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
      if (x.description && !x.reference_type && !x.reversal_of) m.set(sinTilde(x.description.replace(DETALLE_CANTIDAD, "")), x.category);
    }
    return m;
  }, [movimientos, memoria]);

  // Categoría sola: la del mismo concepto de antes o la que dicen las palabras («agua» → Alimentación). Se cambia con un clic.
  const codigosCat = useMemo(() => new Set(categorias.map((c) => c.codigo)), [categorias]);
  // Lo que más se le ha puesto a cada persona o máquina del primer recuadro.
  const catPorSujeto = useMemo(() => {
    const cuenta = new Map<string, Map<string, number>>();
    for (const [txt, c] of catPorConcepto) {
      const corte = txt.lastIndexOf(" · ");
      if (corte < 0) continue;
      const s = txt.slice(0, corte);
      const m = cuenta.get(s) ?? new Map<string, number>();
      m.set(c, (m.get(c) ?? 0) + 1); cuenta.set(s, m);
    }
    return new Map([...cuenta].map(([s, m]) => [s, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
  }, [catPorConcepto]);
  // Orden: la regla con quién y qué → lo mismo escrito antes → regla de quién → regla de la palabra → las palabras de lo
  // que se hizo → lo que siempre se le pone a esa persona → las palabras del primer recuadro.
  const categoriaDe = (s: string, c: string): string | null => {
    const txt = unir(s, c);
    const valida = (x?: string | null) => (x && codigosCat.has(x) ? x : null);
    return valida(buscarRegla(txt, reglas, "ambas")) ?? catPorConcepto.get(sinTilde(txt)) ?? catPorConcepto.get(sinTilde(c))
      ?? (tieneSuFlujo(txt) ? null : valida(buscarRegla(txt, reglas, "quien")) ?? valida(buscarRegla(txt, reglas, "palabra"))
        ?? categoriaPorPalabras(c, codigosCat) ?? catPorSujeto.get(sinTilde(s)) ?? categoriaPorPalabras(s, codigosCat));
  };
  useEffect(() => {
    if (catManual) return;
    if (catFija) { if (catTxt) setCatTxt(""); return; }
    const conMaquina = tipoQuien === "planta" || (tipoQuien === "transporte" && !!quien?.id);
    const dicho = conMaquina ? nombreCortoPorConcepto(texto) : null;
    const codigo = categoriaDe(sujeto, concepto);
    setCatTxt(dicho ?? (codigo ? nombreCat.get(codigo) ?? "" : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, tipoQuien, quien?.id, catManual, catFija, codigosCat, reglas]);

  // Saldo acumulado con TODOS los movimientos, en el orden elegido: como se fueron REGISTRANDO (por defecto) o por su fecha.
  // El saldo de cada fila es el que quedó justo después de ella; luego se muestran de la más nueva a la más vieja.
  const filas = useMemo(() => {
    const reg = (m: HojaMov) => Number(m.registro ?? 0);
    const porFecha = (a: HojaMov, b: HojaMov) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : reg(a) - reg(b));
    const conRegistro = movimientos.every((m) => reg(m) > 0);
    const enOrden = [...movimientos].sort(orden === "registro" && conRegistro ? (a, b) => reg(a) - reg(b) : porFecha);
    let saldo = saldoInicial;
    const conSaldo = enOrden.map((m, n) => {
      saldo = r2(saldo + (m.movement === "INCOME" ? 1 : -1) * Number(m.amount));
      return { k: "mov" as const, t: m.created_at, pos: n, m, saldo };
    });
    // Los egresos a crédito van después del último movimiento de su hora, sin mover el saldo (son Cuentas por Pagar).
    type Fila = typeof conSaldo[number] | { k: "cred"; t: string; pos: number; c: HojaCredito; saldo: number };
    const todas: Fila[] = conSaldo.filter((f) => verOtros || !origenExterno(f.m));
    for (const c of creditos) {
      const previo = [...conSaldo].reverse().find((f) => f.t <= c.created_at);
      todas.push({ k: "cred", t: c.created_at, pos: (previo?.pos ?? -1) + 0.5, c, saldo: previo ? previo.saldo : saldoInicial });
    }
    return todas.sort((a, b) => b.pos - a.pos || (a.t < b.t ? 1 : -1));
  }, [movimientos, creditos, verOtros, origenExterno, saldoInicial, orden]);

  // 🔎 Buscar y filtrar no cambia los saldos: cada fila conserva el suyo.
  const filasVistas = useMemo(() => {
    const t = sinTilde(busca);
    const soloMonto = /^[\d.,]+$/.test(t) ? numero(t) : NaN;
    return filas.filter((f) => {
      const mov = f.k === "mov" ? f.m.movement : "EXPENSE";
      if (ver !== "todo" && mov !== ver) return false;
      if (!t) return true;
      const monto = Number(f.k === "mov" ? f.m.amount : f.c.amount);
      if (Number.isFinite(soloMonto) && Math.abs(monto - soloMonto) < 0.005) return true;
      const campos = f.k === "mov" ? [f.m.description, nombreCat.get(f.m.category), f.m.subcategoria, f.m.proveedor_nombre, f.m.responsable, f.m.maq_activo] : [f.c.description, f.c.proveedor_nombre];
      return sinTilde([...campos, fechaCorta(f.t)].filter(Boolean).join(" ")).includes(t);
    });
  }, [filas, busca, ver, nombreCat]);
  const totVistos = useMemo(() => ({
    entra: r2(filasVistas.reduce((x, f) => x + (f.k === "mov" && f.m.movement === "INCOME" ? Number(f.m.amount) : 0), 0)),
    sale: r2(filasVistas.reduce((x, f) => x + (f.k === "mov" && f.m.movement === "EXPENSE" ? Number(f.m.amount) : 0), 0))
  }), [filasVistas]);
  // Un renglón por cada grupo seguido del mismo día, con lo que entró y salió en él.
  const bloques = useMemo(() => {
    const lista: Array<{ dia: string; t: string; entra: number; sale: number; filas: typeof filasVistas }> = [];
    for (const f of filasVistas) {
      const dia = diaEc(new Date(f.t));
      let b = lista[lista.length - 1];
      if (!b || b.dia !== dia) { b = { dia, t: f.t, entra: 0, sale: 0, filas: [] }; lista.push(b); }
      b.filas.push(f);
      if (f.k === "mov") { if (f.m.movement === "INCOME") b.entra = r2(b.entra + Number(f.m.amount)); else b.sale = r2(b.sale + Number(f.m.amount)); }
    }
    return lista;
  }, [filasVistas]);
  // ✨ Lo recién guardado se marca un momento, para encontrarlo aunque lleve fecha de otro día.
  const conocidos = useRef<Set<string> | null>(null);
  const [nuevos, setNuevos] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = movimientos.map((m) => m.id);
    const previos = conocidos.current;
    conocidos.current = new Set(ids);
    if (!previos || !ids.some((x) => previos.has(x))) return;
    const recien = ids.filter((x) => !previos.has(x));
    if (!recien.length || recien.length > 12) return;
    setNuevos(new Set(recien));
    const reloj = setTimeout(() => setNuevos(new Set()), 6000);
    return () => clearTimeout(reloj);
  }, [movimientos]);

  const totEntradas = r2(movimientos.filter((m) => m.movement === "INCOME").reduce((s, m) => s + Number(m.amount), 0));
  const totSalidas = r2(movimientos.filter((m) => m.movement === "EXPENSE").reduce((s, m) => s + Number(m.amount), 0));
  const saldoFinal = r2(saldoInicial + totEntradas - totSalidas);
  // Lo que aún se está guardando ya cuenta para el saldo que se ve en la fila.
  const noMueveGaveta = (f: HojaNueva) => !!(f.banco || f.pagadoPor || f.credito || f.venta?.fiado);
  const efectoCola = r2(cola.filter((c) => c.estado !== "error" && !noMueveGaveta(c.fila)).reduce((s, c) => s + (c.fila.movement === "INCOME" ? c.fila.amount : -c.fila.amount), 0));

  // Lo último está arriba: al guardar, la hoja vuelve al inicio.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [filas.length, cola.length]);

  // Foco al instante (quien escribe rápido no pierde letras); si la celda aún está deshabilitada, en cuanto se habilite.
  const enfocar = (celda: Celda) => {
    // En un pago de arroz o una compra, antes del monto se pasa por cantidad y precio (una vez por fila).
    const c: Celda = celda === "salida" && conCantidad && !opVisto.current && !montoManual ? "opCant" : celda;
    if (c === "opCant") opVisto.current = true;
    const ir = () => { const el = refs.current[c]; if (!el || el.disabled) return false; el.focus(); el.select(); return true; };
    if (!ir()) setTimeout(ir, 0);
  };
  const limpiar = () => {
    setSujeto(""); setConcepto(""); setCatTxt(""); setEntrada(""); setSalida(""); setError("");
    setQuienTxt(""); setQuienManual(false); setCatManual(false); setMontoManual(false); setPago(PAGO_GAVETA); setPideMaquina(null);
    setResponsable(""); setRespManual(false); setAcreedor(""); setActTxt(""); setCantTxt(""); setTarifaTxt(""); setCuadTxt("CUADRILLA");
    setCuadManual({ act: false, cant: false, tarifa: false }); setClienteTxt("CONSUMIDOR FINAL"); setFiado(false);
    setOpCant(""); setOpPrecio(""); opVisto.current = false;
    enfocar("sujeto");
  };

  const limpiarTodo = () => { setFecha(hoy); setOp(""); limpiar(); };

  // ── Cola de guardado ─────────────────────────────────────────────────────
  const cambiarCola = (f: (c: FilaEnCola[]) => FilaEnCola[]) => { colaRef.current = f(colaRef.current); setCola(colaRef.current); };
  const marcar = (id: number, estado: FilaEnCola["estado"], err?: string) => cambiarCola((c) => c.map((x) => (x.id === id ? { ...x, estado, error: err } : x)));
  const procesarCola = async () => {
    if (corriendo.current) return;
    corriendo.current = true;
    try {
      for (;;) {
        const sig = colaRef.current.find((x) => x.estado === "espera");
        if (!sig) break;
        marcar(sig.id, "enviando");
        try {
          await guardarRef.current(sig.fila);
          marcar(sig.id, "listo");
        } catch (e) {
          const m = e instanceof Error ? e.message : "No se pudo guardar";
          marcar(sig.id, "error", m);
          avisarRef.current(`No se guardó «${sig.fila.description}»: ${m}`);
        }
      }
      // Una sola lectura de la caja al terminar, no una por fila.
      if (colaRef.current.some((x) => x.estado === "listo")) {
        await refrescarRef.current().catch(() => undefined);
        cambiarCola((c) => c.filter((x) => x.estado !== "listo"));
      }
    } finally {
      corriendo.current = false;
      if (colaRef.current.some((x) => x.estado === "espera")) void procesarCola();
    }
  };
  const encolar = (fila: HojaNueva) => {
    const campos: Campos = { sujeto, concepto, catTxt, quienTxt, quienManual, catManual, entrada, salida, montoManual, pago, responsable, acreedor, actTxt, cantTxt, tarifaTxt, cuadTxt, clienteTxt, fiado, op, opCant, opPrecio };
    idCola.current += 1;
    const id = idCola.current;
    cambiarCola((c) => [...c, { id, fila, campos, estado: "espera" }]);
    limpiar();
    void procesarCola();
  };
  const reintentar = (c: FilaEnCola) => { marcar(c.id, "espera"); void procesarCola(); };
  const corregir = (c: FilaEnCola) => {
    if (texto || entrada || salida) { setError("Termina o limpia la fila antes de corregir la que no se guardó."); return; }
    const v = c.campos;
    setSujeto(v.sujeto); setConcepto(v.concepto); setCatTxt(v.catTxt); setQuienTxt(v.quienTxt); setQuienManual(v.quienManual || true); setCatManual(v.catManual); setEntrada(v.entrada); setSalida(v.salida);
    setMontoManual(true); setPago(v.pago); setResponsable(v.responsable); setRespManual(true); setAcreedor(v.acreedor); setActTxt(v.actTxt); setCantTxt(v.cantTxt); setTarifaTxt(v.tarifaTxt);
    setCuadTxt(v.cuadTxt); setCuadManual({ act: true, cant: true, tarifa: true }); setClienteTxt(v.clienteTxt); setFiado(v.fiado);
    setOp(v.op); setOpCant(v.opCant); setOpPrecio(v.opPrecio); opVisto.current = true;
    cambiarCola((l) => l.filter((x) => x.id !== c.id));
    enfocar("sujeto");
  };

  const guardar = (forzada?: HojaCategoria | null) => {
    setError(""); setPideMaquina(null);
    let destino = conQuien ? resolverQuien(quienTxt) : null;
    if (op === "arroz" && destino?.tipo !== "agricultor") {
      setError(`¿A qué agricultor? Elígelo de la lista del primer recuadro. Si es nuevo, créalo en «🌾 Arroz en cáscara».`); enfocar("sujeto"); return;
    }
    if (op === "venta" && destino?.tipo !== "venta") { setError("Elegiste Venta: en «¿Para qué?» tiene que ir una venta."); enfocar("quien"); return; }
    if (conQuien && !destino) { setError(`No hay «${quienTxt.trim()}» en ¿Para qué?. Elígelo de la lista.`); enfocar("quien"); return; }
    // Quien escribe rápido llega al monto antes de que la categoría aparezca en la celda: se calcula aquí también.
    const catSola = catManual ? "" : nombreCat.get(categoriaDe(sujeto, concepto) ?? "") ?? "";
    let elegida = forzada ?? (destino && CATEGORIA_FIJA[destino.tipo] ? null : resolverCat(catTxt || catSola));
    // Una venta que se eligió por categoría sigue el flujo de venta.
    if (elegida?.codigo === "VENTA_DETALLE") {
      const v = destinos.find((d) => d.tipo === "venta");
      if (v) { destino = v; elegida = null; }
    }
    const t = destino?.tipo;
    if (t === "fondo" && !elegida) elegida = categorias.find((c) => c.codigo === RUBRO_VARIOS.EGRESO) ?? categorias.find((c) => c.tipo === "EGRESO") ?? null;
    const tipoFila: "INCOME" | "EXPENSE" | null = t && SIEMPRE_SALIDA.has(t) ? "EXPENSE" : t && SIEMPRE_ENTRADA.has(t) ? "INCOME"
      : elegida ? (elegida.tipo === "INGRESO" ? "INCOME" : "EXPENSE") : null;
    if (!tipoFila) { setError(catTxt.trim() ? `No hay una categoría «${catTxt.trim()}». Elígela de la lista.` : "Escribe la categoría."); enfocar("categoria"); return; }
    if ((op === "compra" || op === "gasto") && tipoFila === "INCOME") { setError(`Elegiste ${op === "compra" ? "Compra" : "Gasto"} y eso es una entrada: cambia la categoría o pon el tipo en Automático.`); enfocar("categoria"); return; }
    // Una entrada o un gasto corriente que nombra una máquina sigue siendo de esta caja.
    if (tipoFila === "INCOME" && destino?.tipo === "planta") destino = destinos[0];
    let deOtro = !!destino && destino.tipo !== "propio";
    if (tipoFila === "INCOME" && deOtro && !SIEMPRE_ENTRADA.has(destino!.tipo)) { setError("Solo una salida puede ser de Transporte, de un operador o de un socio."); enfocar("quien"); return; }
    const monto = r2(numero(tipoFila === "INCOME" ? entrada : salida));
    const celdaMonto: Celda = tipoFila === "INCOME" ? "entrada" : "salida";
    const nombreMonto = tipoFila === "INCOME" ? "Entradas" : "Salidas";
    // Lo que pide más datos (o tiene su propio flujo) abre su panel; de Transporte/socio no.
    if (elegida && tipoFila === "EXPENSE" && esTrabajo(elegida.codigo) && !deOtro) {
      // En el Excel un repuesto no siempre decía máquina. Si dice el área («Montacarga»), va a sus OTROS sin preguntar;
      // si no dice nada, se pregunta y a la segunda queda en PILADORA · OTROS.
      const otrosDe = (area: string) => maquinasPlanta.find((m) => sinTilde(m.area) === sinTilde(area) && sinTilde(m.section) === "otros");
      const delArea = [...new Set(maquinasPlanta.map((m) => m.area))].filter((a) => dicePalabras(texto, a)).map(otrosDe).find(Boolean);
      const otros = delArea ?? otrosDe("piladora");
      if (otros && monto > 0 && (delArea || pideMaquina?.codigo === elegida.codigo)) { destino = otros; deOtro = true; }
      else {
        setPideMaquina({ codigo: elegida.codigo, monto: monto > 0 ? monto : null });
        setError(`¿En qué máquina? Elígela en «¿Para qué?»${otros ? `, o sigue con Enter y queda en ${otros.area} · ${otros.section}` : ""}.`); enfocar("quien"); return;
      }
    }
    if (elegida && !saltaFormulario(destino, elegida.codigo) && esCompleja(elegida.codigo, tipoFila)) { onFormularioCompleto(tipoFila, elegida.codigo, texto, monto > 0 ? monto : null); limpiar(); return; }
    if (t !== "cuadrilla" && !(monto > 0)) { setError(`Escribe el monto en ${nombreMonto}.`); enfocar(celdaMonto); return; }
    if (texto.length < 2) { setError("Escribe qué se hizo."); enfocar("concepto"); return; }
    const conDetalle = conCantidad && totalOp > 0 && Math.abs(totalOp - monto) < 0.005;
    const descripcion = `${op === "arroz" && !concepto.trim() ? unir(sujeto, "Pago de arroz en cáscara") : texto}${conDetalle ? ` · ${numero(opCant)}${op === "arroz" ? " QQ" : ""} × $${numero(opPrecio)}` : ""}`;
    const base: HojaNueva = { movement: tipoFila, category: elegida?.codigo ?? "", amount: monto, description: descripcion, codigo: CODIGO, medio,
      destino: destino ?? undefined, fecha: fecha !== hoy ? fecha : undefined };
    if (t === "venta") {
      const v = leerVenta(texto, productos);
      if (!v) { setError("Escribe qué se vendió, por ejemplo: 20 lb de 0,11 · 1 qq de polvillo · $10 de corriente."); enfocar("concepto"); return; }
      // El primer recuadro, si se llenó, es el cliente de la venta.
      const cliente = (/^consumidor\s*final$/i.test(clienteTxt.trim()) ? sujeto.trim() : clienteTxt.trim()) || "CONSUMIDOR FINAL";
      if (fiado && /consumidor\s*final/i.test(cliente)) { setError("Para fiar escribe el nombre de quien queda debiendo."); enfocar("cliente"); return; }
      const c = calcularVentaDetalle({ cantidad: v.cantidad ?? monto, precioLibra: v.producto.precioLibra || 1, modo: v.modo, descuentoQq });
      const libras = v.modo === "LIBRA" ? (v.cantidad ?? 0) : v.modo === "QQ" ? (v.cantidad ?? 0) * 100 : c?.libras ?? 0;
      if (!(libras > 0)) { setError("No se pudo calcular cuánto se entrega: escribe las libras o los QQ."); enfocar("concepto"); return; }
      encolar({ ...base, venta: { producto: v.producto, modo: v.modo, cantidad: v.cantidad ?? monto, qq: libras / 100, libras, cliente, fiado } });
      return;
    }
    if (t === "cuadrilla") {
      if (!actividad) { setError("¿Qué trabajo fue? Elígelo debajo de la fila."); enfocar("actividad"); return; }
      const cantidad = numero(cantTxt);
      if (!(cantidad > 0)) { setError("Escribe la cantidad (QQ o sacos)."); enfocar("cantidad"); return; }
      if (!(monto > 0)) { setError("Escribe la tarifa o el monto en Salidas."); enfocar("tarifa"); return; }
      encolar({ ...base, cuadrilla: { actividadId: actividad.id, actividad: actividad.name, cantidad, quien: cuadTxt.trim() || "CUADRILLA" } });
      return;
    }
    if (t === "fondo") {
      if (responsable.trim().length < 2) { setError("¿Quién recibe el dinero? Escríbelo debajo de la fila."); enfocar("responsable"); return; }
      encolar({ ...base, responsable: responsable.trim().toUpperCase() });
      return;
    }
    if (conCredito && acreedor.trim().length < 2) { setError("¿A quién se le queda debiendo? Escríbelo debajo de la fila."); enfocar("acreedor"); return; }
    const socioPago = pago.startsWith("SOCIO:") ? socios.find((x) => `SOCIO:${x.id}` === pago) : undefined;
    encolar({ ...base, banco: pago === "BANCO" || undefined, pagadoPor: socioPago ? { id: socioPago.id, nombre: socioPago.name } : undefined,
      credito: conCredito ? { acreedor: acreedor.trim().toUpperCase() } : undefined });
  };

  // Enter = siguiente celda (Tab ya lo hace el navegador); Enter en el monto guarda; Esc limpia la fila.
  // Concepto y Categoría llegan con el valor ya elegido de su lista (`valor`), sin esperar al estado.
  const celdaMontoDe = (d: HojaDestino | null, c: HojaCategoria | null): Celda => (d && SIEMPRE_ENTRADA.has(d.tipo)) || (!d?.tipo || !SIEMPRE_SALIDA.has(d.tipo)) && c?.tipo === "INGRESO" ? "entrada" : "salida";
  const siguiente = (c: Celda, valor?: string, s = sujeto) => {
    if (c === "sujeto") {
      const t = (valor ?? sujeto).trim();
      if (valor !== undefined) setSujeto(valor);
      if (op === "arroz" && t) { enfocar("salida"); return; }
      if (concepto.trim()) { siguiente("concepto", undefined, t); return; }
      if (!t) { enfocar("concepto"); return; }
      // Quien escribe toda la línea en el primer recuadro («comida», «20 lb de 0,11») sigue como antes: pasa a «qué se hizo».
      const d = detectarQuien(t);
      const esMaquina = d?.tipo === "planta" || (d?.tipo === "transporte" && !!d.id);
      const conocido = esMaquina || maquinasPlanta.some((m) => sinTilde(m.area) === sinTilde(t)) || reglas.some((r) => r.quien && dicePalabras(t, r.quien)) || catPorSujeto.has(sinTilde(t));
      if (!conocido && (d || categoriaPorPalabras(t, codigosCat) || catPorConcepto.has(sinTilde(t)))) {
        setSujeto(""); setConcepto(t); siguiente("concepto", t, ""); return;
      }
      enfocar("concepto");
    } else if (c === "concepto") {
      const cTxt = valor ?? concepto;
      if (valor !== undefined && valor !== concepto) setConcepto(valor);
      const txt = unir(s, cTxt);
      if (op === "venta") { enfocar("entrada"); return; }
      if (op === "arroz") { enfocar("salida"); return; }
      const detectado = !quienManual ? detectarQuien(txt) : quien;
      if (detectado && !quienManual) setQuienTxt(detectado.valor);
      const tq = detectado?.tipo;
      if (tq === "cuadrilla") { const l = leerCuadrilla(txt, actividades); enfocar(!l?.actividad ? "actividad" : l.cantidad == null ? "cantidad" : "salida"); return; }
      if (tq === "fondo") { enfocar(leerResponsable(txt) ? "salida" : "responsable"); return; }
      if (tq && CATEGORIA_FIJA[tq]) { enfocar(SIEMPRE_ENTRADA.has(tq) ? "entrada" : "salida"); return; }
      // Con la categoría ya conocida se salta directo al monto.
      const conMaquina = tq === "planta" || (tq === "transporte" && !!detectado?.id);
      const dicho = conMaquina ? nombreCortoPorConcepto(txt) : null;
      const previa = categoriaDe(s, cTxt);
      const conocida = resolverCat((catManual ? catTxt : "") || dicho || (previa ? nombreCat.get(previa) ?? "" : "") || catTxt);
      if (conocida) {
        if (!catManual) setCatTxt(dicho ?? conocida.nombre);
        if (!saltaFormulario(detectado, conocida.codigo) && !esTrabajo(conocida.codigo) && esCompleja(conocida.codigo, conocida.tipo === "INGRESO" ? "INCOME" : "EXPENSE")) enfocar("categoria");
        else enfocar(conocida.tipo === "INGRESO" ? "entrada" : "salida");
      } else enfocar("categoria");
    } else if (c === "categoria") {
      const elegida = resolverCat(valor ?? catTxt);
      if (elegida && !categoriaPorNombreCorto(valor ?? catTxt)) setCatTxt(elegida.nombre);
      if (elegida && !esTrabajo(elegida.codigo) && !saltaFormulario(quien, elegida.codigo) && esCompleja(elegida.codigo, elegida.tipo === "INGRESO" ? "INCOME" : "EXPENSE")) { guardar(elegida); return; }
      enfocar(elegida ? (elegida.tipo === "INGRESO" ? "entrada" : "salida") : "categoria");
    } else if (c === "quien") {
      const elegido = resolverQuien(valor ?? quienTxt);
      if (elegido) setQuienTxt(elegido.valor);
      // Se le preguntó la máquina y siguió con Enter sin elegir: queda en PILADORA · OTROS.
      if (pideMaquina && (!elegido || elegido.tipo === "propio")) { guardar(); return; }
      if (elegido?.tipo === "cuadrilla") { enfocar(actTxt ? "cantidad" : "actividad"); return; }
      if (elegido?.tipo === "fondo") { enfocar(responsable ? "salida" : "responsable"); return; }
      enfocar(elegido ? celdaMontoDe(elegido, cat) : "quien");
    } else if (c === "actividad") {
      const texto = valor ?? actTxt;
      const a = actividades.find((x) => etiquetaActividad(x) === texto);
      if (a && !cuadManual.tarifa && !leerCuadrilla(texto, actividades)?.tarifa) setTarifaTxt(String(a.unit_rate));
      enfocar(cantTxt ? "salida" : "cantidad");
    } else if (c === "cantidad") enfocar(tarifaTxt ? "salida" : "tarifa");
    else if (c === "tarifa" || c === "cuadrilla" || c === "responsable" || c === "acreedor") enfocar("salida");
    else if (c === "cliente") enfocar("entrada");
    else if (c === "opCant") enfocar("opPrecio");
    else if (c === "opPrecio") enfocar("salida");
  };
  const tecla = (_c: Celda) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); limpiarTodo(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    guardar();
  };
  const pasa = (c: Celda) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); limpiarTodo(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    siguiente(c);
  };

  const opcionesCat = useMemo(() => [
    ...(hayPlanta ? NOMBRE_CORTO.filter((n) => categorias.some((c) => c.codigo === n.codigo)).map((n) => ({ valor: n.valor, detalle: n.detalle, tono: "is-out" })) : []),
    ...categorias.filter((c) => (op !== "compra" && op !== "gasto") || c.tipo !== "INGRESO")
      .map((c) => ({ valor: c.nombre, detalle: c.tipo === "INGRESO" ? "+ entrada" : "− salida", tono: c.tipo === "INGRESO" ? "is-in" : "is-out" }))
  ], [categorias, hayPlanta, op]);
  const opcionesConcepto = useMemo(() => sugerencias.map((x) => ({ valor: x })), [sugerencias]);
  // Primer recuadro: máquinas, lo de las reglas, y las personas ya usadas.
  const opcionesSujeto = useMemo(() => {
    const vistos = new Set<string>(); const lista: Opcion[] = [];
    if (op === "arroz") return agricultores.map((a) => ({ valor: a.nombre, detalle: a.detalle }));
    const poner = (valor: string, detalle?: string) => { const k = sinTilde(valor); if (k && !vistos.has(k)) { vistos.add(k); lista.push({ valor, detalle }); } };
    for (const m of maquinasPlanta) { poner(m.area, "área"); if (sinTilde(m.section) !== "otros") poner(`${m.section} ${m.area}`, "máquina"); }
    for (const r of reglas) if (r.quien) poner(r.quien, r.categoria_nombre ?? undefined);
    for (const k of catPorSujeto.keys()) poner(k.toUpperCase());
    return lista;
  }, [maquinasPlanta, reglas, catPorSujeto, op, agricultores]);
  const opcionesQuien = useMemo(() => destinos.map((d) => ({ valor: d.valor, detalle: d.detalle, tono: d.tipo === "propio" ? "" : d.tipo === "socio" || SIEMPRE_ENTRADA.has(d.tipo) ? "is-in" : "is-out" })), [destinos]);
  const opcionesActividad = useMemo(() => actividades.map((a) => ({ valor: etiquetaActividad(a) })), [actividades]);
  const opcionesCliente = useMemo(() => clientes.map((c) => ({ valor: c })), [clientes]);

  // Columna «¿De quién?» de lo ya registrado: Transporte (gasto que pagó esta caja), un socio, o el banco.
  const quienDeMovimiento = (m: HojaMov) => {
    const d = (m.description ?? "");
    if (m.reference_type === "campo_cxp") return /Anticipo a /.test(d) ? `👷 ${(d.match(/Anticipo a ([^:(·]+)/)?.[1] ?? "operador").trim()}` : "🚜 Transporte";
    if (m.category === "GASTO_POR_SOCIO") return `🤝 ${(d.match(/^Gasto de ([^:]+):/)?.[1] ?? "socio").trim()}`;
    if (m.reference_type === "pagado_con_banco") return "💳 Banco";
    const maquina = d.match(/^Mantenimiento [^/]+\/([^:]+):/)?.[1] ?? d.match(/\[uso: [^\]]*›\s*([^\]]+)\]/)?.[1];
    if (maquina) return `🔧 ${maquina.trim()}`;
    return "";
  };
  const etiquetaCat = (codigo: string | null | undefined) => (codigo ? nombreCat.get(codigo) ?? codigo.replace(/_/g, " ").toLowerCase() : "—");

  return (
    <div className="cjh">
      <div className="cjh-herr">
        <input type="search" className="cjh-busca" value={busca} placeholder="🔎 Buscar por nombre, concepto, fecha o monto" aria-label="Buscar movimientos" onChange={(e) => setBusca(e.target.value)} />
        <span className="cjh-seg" role="group" aria-label="Qué ver">
          {([["todo", "Todo"], ["INCOME", "Entradas"], ["EXPENSE", "Salidas"]] as const).map(([k, t]) => (
            <button key={k} type="button" aria-pressed={ver === k} onClick={() => setVer(k)}>{t}</button>
          ))}
        </span>
        <span className="cjh-seg" role="group" aria-label="Orden de la hoja" title="Lo más nuevo va arriba. «Como se registró» sigue el orden en que se guardó; «Por fecha», el día de cada movimiento. El saldo se calcula según el orden elegido.">
          {([["registro", "Como se registró"], ["fecha", "Por fecha"]] as const).map(([k, t]) => (
            <button key={k} type="button" aria-pressed={orden === k} onClick={() => setOrden(k)}>{t}</button>
          ))}
        </span>
      </div>
      <div className="cjh-scroll" ref={scrollRef}>
        <table className="cjh-tabla">
          <thead className="cjh-cabeza">
            <tr className="cjh-cab">
              <th>Fecha</th>
              <th>Concepto</th>
              <th className="num">Entradas $</th>
              <th className="num">Salidas $</th>
              <th className="num">Saldo $</th>
              <th />
            </tr>
            {/* Fila de captura: como escribir la siguiente línea del Excel. */}
            <tr className="cjh-nueva">
              <td className="cjh-fecha">
                <input type="date" value={fecha} max={hoy} min={abiertaEl ? diaEc(new Date(abiertaEl)) : undefined}
                  className={fecha !== hoy ? "is-otra" : ""} aria-label="Fecha del movimiento" title="Cambia la fecha si el movimiento es de un día anterior"
                  onChange={(e) => setFecha(e.target.value || hoy)} />
                <select className="cjh-op" value={op} aria-label="Tipo de operación" title="Qué vas a registrar. Con el cuadro elegido, escribe 1, 2, 3 o 4"
                  onChange={(e) => elegirOp(e.target.value as Op)}>
                  {OPS.filter((o) => (o.clave !== "venta" || destinos.some((d) => d.tipo === "venta")) && (o.clave !== "arroz" || agricultores.length > 0)).map((o) => <option key={o.clave} value={o.clave}>{o.texto}</option>)}
                </select>
              </td>
              <td>
                <div className="cjh-dos">
                  <CeldaSugerida inputRef={(el) => { refs.current.sujeto = el; }} value={sujeto} opciones={opcionesSujeto} minimo={1} elegirPrimera={false}
                    placeholder={op === "arroz" ? "¿Qué agricultor?" : op === "venta" ? "Cliente (si no, Enter)" : op === "compra" ? "¿A quién se compra?" : "¿Quién o qué? Ej: Danny · Secadora 3"} disabled={false} ariaLabel="Cliente, persona o máquina"
                    onChange={setSujeto} onEnter={(v) => siguiente("sujeto", v)} onEscape={limpiarTodo} />
                  <CeldaSugerida inputRef={(el) => { refs.current.concepto = el; }} value={concepto} opciones={opcionesConcepto} minimo={2} elegirPrimera={false}
                    placeholder={op === "arroz" ? "Detalle (opcional)" : op === "venta" ? "¿Qué se vendió? Ej: 20 lb de 0,11" : op === "compra" ? "¿Qué se compró?" : "¿Qué se hizo? Ej: reparación · cambio de bandas · comida"} disabled={false} ariaLabel="Concepto o descripción"
                    onChange={setConcepto} onEnter={(v) => siguiente("concepto", v)} onEscape={limpiarTodo} />
                </div>
                <div className="cjh-nueva__tags">
                  <label>
                    <span>Categoría</span>
                    <CeldaSugerida inputRef={(el) => { refs.current.categoria = el; }} value={catFija ?? catTxt} opciones={opcionesCat} minimo={0} elegirPrimera
                      placeholder={esFondo ? "Gastos varios" : "Elige…"} disabled={!!catFija} ariaLabel="Categoría"
                      className={catTxt && !cat && !catFija ? "is-mal" : tipo === "INCOME" ? "is-in" : tipo === "EXPENSE" ? "is-out" : ""}
                      onChange={(v) => { setCatTxt(v); setCatManual(true); setError(""); }} onEnter={(v) => siguiente("categoria", v)} onEscape={limpiarTodo}
                      onBlur={() => { if (cat && !categoriaPorNombreCorto(catTxt)) setCatTxt(cat.nombre); }} />
                  </label>
                  {conQuien && (
                    <label>
                      <span>¿Para qué?</span>
                      <CeldaSugerida inputRef={(el) => { refs.current.quien = el; }} value={quienTxt} opciones={opcionesQuien} minimo={0} elegirPrimera
                        placeholder={destinos[0]?.valor ?? "Esta caja"} disabled={false} ariaLabel="¿De quién es?"
                        className={quienTxt && !quien ? "is-mal" : quien && quien.tipo !== "propio" ? "is-out" : ""}
                        onChange={(v) => { setQuienTxt(v); setQuienManual(true); setError(""); }} onEnter={(v) => siguiente("quien", v)} onEscape={limpiarTodo}
                        onBlur={() => { if (quien && quienTxt) setQuienTxt(quien.valor); }} />
                    </label>
                  )}
                </div>
              </td>
              <td>
                <input ref={(el) => { refs.current.entrada = el; }} value={entrada} inputMode="decimal" className="num"
                  placeholder={tipo === "EXPENSE" ? "" : "0.00"} disabled={tipo === "EXPENSE"}
                  onChange={(e) => { setEntrada(e.target.value.replace(/[^\d.,]/g, "")); setMontoManual(true); }} onKeyDown={tecla("entrada")} aria-label="Entradas" />
              </td>
              <td>
                <input ref={(el) => { refs.current.salida = el; }} value={salida} inputMode="decimal" className="num"
                  placeholder={tipo === "INCOME" ? "" : "0.00"} disabled={tipo === "INCOME"}
                  onChange={(e) => { setSalida(e.target.value.replace(/[^\d.,]/g, "")); setMontoManual(true); }} onKeyDown={tecla("salida")} aria-label="Salidas" />
              </td>
              <td className="num cjh-saldo">
                {(() => {
                  const n = numero(tipo === "INCOME" ? entrada : salida);
                  const fuera = !!pago || (esVenta && fiado);
                  return tipo && n > 0 ? money(r2(saldoFinal + efectoCola + (fuera ? 0 : tipo === "INCOME" ? n : -n))) : "";
                })()}
              </td>
              <td className="cjh-acc">
                {opcionesPago.length > 0 && (
                  <button type="button" className={`cjh-banco ${pago ? "is-on" : ""}`} aria-haspopup="menu" aria-expanded={!!menuPago}
                    title="¿Cómo se pagó? Cámbialo si no salió de la gaveta (banco, lo pagó un socio, a crédito)"
                    onClick={(e) => setMenuPago(menuPago ? null : e.currentTarget)}>{pagoElegido?.icono ?? "💳"}</button>
                )}
                {mixto && (
                  <select value={medio} onChange={(e) => setMedio(e.target.value as "EFECTIVO" | "BANCO")} aria-label="Efectivo o banco">
                    <option value="EFECTIVO">💵 Efectivo</option>
                    <option value="BANCO">🏦 Banco</option>
                  </select>
                )}
                <button type="button" className="cjh-guardar" onClick={() => { guardar(); }}>Guardar ↵</button>
              </td>
            </tr>
            {/* Lo poco que falta según lo que sea: debajo de la misma fila, sin cambiar de pantalla. */}
            {(conCantidad || esVenta || esCuadrilla || esFondo || conCredito || tipoQuien === "agricultor" || tipoQuien === "cobro" || tipoQuien === "pago") && (
              <tr className="cjh-extra">
                <td colSpan={6}>
                  <div className="cjh-extra__fila">
                    {conCantidad && (<>
                      <label><span>{op === "arroz" ? "🌾 Quintales" : "📦 Cantidad"}</span>
                        <input ref={(el) => { refs.current.opCant = el; }} value={opCant} inputMode="decimal" aria-label={op === "arroz" ? "Quintales" : "Cantidad"} onKeyDown={pasa("opCant")}
                          onChange={(e) => { setOpCant(e.target.value.replace(/[^\d.,]/g, "")); setMontoManual(false); }} />
                      </label>
                      <label><span>× Precio $</span>
                        <input ref={(el) => { refs.current.opPrecio = el; }} value={opPrecio} inputMode="decimal" aria-label="Precio" onKeyDown={pasa("opPrecio")}
                          onChange={(e) => { setOpPrecio(e.target.value.replace(/[^\d.,]/g, "")); setMontoManual(false); }} />
                      </label>
                      <span className="cjh-extra__total">{totalOp > 0 ? <>Total <b>{money(totalOp)}</b></> : "o escribe el monto directo en Salidas"}</span>
                    </>)}
                    {esVenta && (<>
                      <span className="cjh-extra__nota">🛒 {ventaLeida
                        ? <>{ventaLeida.producto.label}{calculo ? ` · ${formatoCantidad(calculo.libras, 3)} lb = ${formatoCantidad(calculo.qq, 3)} QQ` : ""}</>
                        : "Escribe qué se vendió en el concepto: 20 lb de 0,11"}</span>
                      <label><span>Cliente</span>
                        <CeldaSugerida inputRef={(el) => { refs.current.cliente = el; }} value={clienteTxt} opciones={opcionesCliente} minimo={2} elegirPrimera={false}
                          placeholder="Consumidor final" disabled={false} ariaLabel="Cliente"
                          onChange={setClienteTxt} onEnter={(v) => { setClienteTxt(v); siguiente("cliente"); }} onEscape={limpiarTodo} />
                      </label>
                      <button type="button" className={`cjh-opcion ${fiado ? "" : "is-on"}`} onClick={() => setFiado(false)}>💵 Pagó todo</button>
                      <button type="button" className={`cjh-opcion ${fiado ? "is-on" : ""}`} onClick={() => setFiado(true)}>📝 Fiado</button>
                    </>)}
                    {esCuadrilla && (<>
                      <label className="is-ancho"><span>👷 Trabajo</span>
                        <CeldaSugerida inputRef={(el) => { refs.current.actividad = el; }} value={actTxt} opciones={opcionesActividad} minimo={0} elegirPrimera
                          placeholder="Elige el trabajo…" disabled={false} ariaLabel="Trabajo de la cuadrilla" className={actTxt && !actividad ? "is-mal" : ""}
                          onChange={(v) => { setActTxt(v); setCuadManual((m) => ({ ...m, act: true })); }}
                          onEnter={(v) => { setActTxt(v); setCuadManual((m) => ({ ...m, act: true })); siguiente("actividad", v); }} onEscape={limpiarTodo} />
                      </label>
                      <label><span>Cantidad</span>
                        <input ref={(el) => { refs.current.cantidad = el; }} value={cantTxt} inputMode="decimal" aria-label="Cantidad" onKeyDown={pasa("cantidad")}
                          onChange={(e) => { setCantTxt(e.target.value.replace(/[^\d.,]/g, "")); setCuadManual((m) => ({ ...m, cant: true })); }} />
                      </label>
                      <label><span>× Tarifa $</span>
                        <input ref={(el) => { refs.current.tarifa = el; }} value={tarifaTxt} inputMode="decimal" aria-label="Tarifa" onKeyDown={pasa("tarifa")}
                          onChange={(e) => { setTarifaTxt(e.target.value.replace(/[^\d.,]/g, "")); setCuadManual((m) => ({ ...m, tarifa: true })); }} />
                      </label>
                      <label><span>¿Quién?</span>
                        <input ref={(el) => { refs.current.cuadrilla = el; }} value={cuadTxt} aria-label="Cuadrilla" onKeyDown={pasa("cuadrilla")} onChange={(e) => setCuadTxt(e.target.value)} />
                      </label>
                    </>)}
                    {esFondo && (<>
                      <label className="is-ancho"><span>⏳ ¿Quién recibe?</span>
                        <input ref={(el) => { refs.current.responsable = el; }} value={responsable} aria-label="Quién recibe" placeholder="Nombre de quien recibe el dinero" onKeyDown={pasa("responsable")}
                          onChange={(e) => { setResponsable(e.target.value); setRespManual(true); }} />
                      </label>
                      <span className="cjh-extra__nota">Sale de la caja y queda por liquidar: cuando se sepa en qué se fue, se usa 💸 Liquidar en esta misma fila.</span>
                    </>)}
                    {conCredito && (
                      <label className="is-ancho"><span>📝 ¿A quién se le debe?</span>
                        <input ref={(el) => { refs.current.acreedor = el; }} value={acreedor} aria-label="A quién se le debe" placeholder="Proveedor o persona" onKeyDown={pasa("acreedor")} onChange={(e) => setAcreedor(e.target.value)} />
                      </label>
                    )}
                    {(tipoQuien === "agricultor" || tipoQuien === "cobro" || tipoQuien === "pago") && quien?.detalle && <span className="cjh-extra__nota">{quien.detalle}</span>}
                  </div>
                </td>
              </tr>
            )}
          </thead>
          <tbody>
            {/* Lo que se está guardando: la fila ya quedó libre para seguir escribiendo. */}
            {[...cola].reverse().map((c) => (
              <tr key={`cola-${c.id}`} className={`cjh-cola ${c.estado === "error" ? "is-error" : ""}`}>
                <td className="cjh-fecha">{c.estado === "error" ? "⚠️ No se guardó" : "⏳ Guardando…"}</td>
                <td>{c.fila.description}{c.estado === "error" && <small>{c.error}</small>}</td>
                <td className="num cjh-entra">{c.fila.movement === "INCOME" ? money(c.fila.amount) : ""}</td>
                <td className="num cjh-sale">{c.fila.movement === "EXPENSE" ? money(c.fila.amount) : ""}</td>
                <td />
                <td className="cjh-acc">
                  {c.estado === "error" && (<>
                    <button type="button" onClick={() => corregir(c)}>Corregir</button>
                    <button type="button" onClick={() => reintentar(c)}>Reintentar</button>
                    <button type="button" onClick={() => cambiarCola((l) => l.filter((x) => x.id !== c.id))}>Quitar</button>
                  </>)}
                </td>
              </tr>
            ))}
            {filasVistas.length === 0 && (
              <tr className="cjh-vacio"><td colSpan={6}>{filas.length ? "Ningún movimiento coincide con lo que buscas." : "Todavía no hay movimientos en esta caja."}</td></tr>
            )}
            {bloques.map((b, n) => (
              <Fragment key={`${b.dia}-${n}`}>
              <tr className="cjh-dia">
                <td colSpan={2}>{diaLargo(b.t)}<small>{b.filas.length} {b.filas.length === 1 ? "movimiento" : "movimientos"}</small></td>
                <td className="num">{b.entra > 0 ? `+ ${money(b.entra)}` : ""}</td>
                <td className="num">{b.sale > 0 ? `− ${money(b.sale)}` : ""}</td>
                <td /><td />
              </tr>
              {b.filas.map((f) => {
              if (f.k === "cred") {
                const c = f.c;
                const anulado = c.status === "CANCELLED";
                const abonado = Number(c.amount) - Number(c.balance);
                return (
                  <tr key={`cred-${c.id}`} className={`cjh-cred ${anulado ? "is-anulado" : ""}`}>
                    <td className="cjh-fecha">{fechaCorta(c.created_at)}</td>
                    <td>
                      {c.description ?? "—"}
                      <span className="cjh-tags"><span className="cjh-tag">{etiquetaCat(c.categoria)}</span></span>
                      <small>💳 A crédito · 🏪 {c.proveedor_nombre ?? "—"}{anulado ? " · ANULADO" : Number(c.balance) < 0.005 ? " · pagada" : abonado > 0.005 ? ` · saldo ${money(Number(c.balance))}` : " · en Por Pagar"}</small>
                    </td>
                    <td />
                    <td className="num cjh-sin">{money(Number(c.amount))}<small>no sale de caja</small></td>
                    <td className="num">{money(f.saldo)}</td>
                    <td className="cjh-acc">
                      {puedeAnular && !anulado && abonado < 0.005 && !c.transporte && <button type="button" onClick={() => onAnularCredito(c)}>Anular</button>}
                    </td>
                  </tr>
                );
              }
              const m = f.m;
              const anulado = !!m.reversed_at;
              const esAnulacion = !!m.reversal_of;
              const origen = origenExterno(m);
              const entra = m.movement === "INCOME";
              return (
                <tr key={m.id} className={`${entra ? "is-in" : "is-out"} ${anulado ? "is-anulado" : ""} ${esAnulacion ? "is-reverso" : ""} ${origen ? "is-externo" : ""} ${nuevos.has(m.id) ? "is-nuevo" : ""}`}>
                  <td className="cjh-fecha">{fechaCorta(m.created_at)}</td>
                  <td>
                    {m.description || etiquetaCat(m.category)}
                    <span className="cjh-tags">
                      <span className="cjh-tag">{etiquetaCat(m.category)}</span>
                      {quienDeMovimiento(m) && <span className="cjh-tag is-quien">{quienDeMovimiento(m)}</span>}
                      {m.codigo && m.codigo !== CODIGO && <span className="cjh-tag">cód. {m.codigo}</span>}
                    </span>
                    {(m.subcategoria || m.proveedor_nombre || origen || anulado || esAnulacion || (mixto && m.medio === "BANCO") || m.maq_activo || m.area) && (
                      <small>
                        {[
                          m.subcategoria,
                          m.proveedor_nombre ? `🏪 ${m.proveedor_nombre}` : "",
                          (m.maq_activo || m.area) ? `🔧 ${[m.area, m.maq_activo].filter(Boolean).join(" · ")}` : "",
                          mixto && m.medio === "BANCO" ? "🏦 Banco" : "",
                          origen ? `↪ ${origen}` : "",
                          esAnulacion ? "Anulación" : "",
                          anulado ? `ANULADO${m.reversed_reason ? `: ${m.reversed_reason}` : ""}` : ""
                        ].filter(Boolean).join(" · ")}
                      </small>
                    )}
                    {m.es_fondo && (
                      <small className={m.fondo_estado === "LIQUIDADO" ? "cjh-ok" : "cjh-warn"}>
                        {m.fondo_estado === "LIQUIDADO" ? "✅ Fondo liquidado" : "⏳ Fondo por liquidar"}{m.responsable ? ` · 👤 ${m.responsable}` : ""}
                      </small>
                    )}
                  </td>
                  <td className="num cjh-entra">{entra ? money(Number(m.amount)) : ""}</td>
                  <td className="num cjh-sale">{entra ? "" : money(Number(m.amount))}</td>
                  <td className={`num cjh-saldo ${f.saldo < 0 ? "is-neg" : ""}`}>{money(f.saldo)}</td>
                  <td className="cjh-acc">
                    {m.es_fondo && m.fondo_estado === "POR_LIQUIDAR" && !anulado && !esAnulacion && (
                      <button type="button" title="Registrar el gasto real y el vuelto que regresa a caja" onClick={() => onLiquidarFondo(m)}>💸 Liquidar</button>
                    )}
                    {!m.reference_type && !anulado && !esAnulacion && !m.es_fondo && (
                      <button type="button" title="Registrar otra vez este movimiento (se puede cambiar)" onClick={() => onRepetir(m)}>🔁</button>
                    )}
                    {puedeAnular && !anulado && !esAnulacion && <button type="button" onClick={() => onAnular(m)}>Anular</button>}
                  </td>
                </tr>
              );
              })}
              </Fragment>
            ))}
            <tr className="cjh-inicial">
              <td colSpan={2}>Saldo inicial de la caja</td>
              <td /><td />
              <td className="num"><b>{money(saldoInicial)}</b></td>
              <td />
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>{busca.trim() || ver !== "todo" ? `SOLO LO QUE SE VE (${filasVistas.length})` : "TOTALES DE LA SESIÓN"}</td>
              <td className="num cjh-entra">{money(busca.trim() || ver !== "todo" ? totVistos.entra : totEntradas)}</td>
              <td className="num cjh-sale">{money(busca.trim() || ver !== "todo" ? totVistos.sale : totSalidas)}</td>
              <td className="num cjh-saldo"><b>{money(saldoFinal)}</b></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="cjh-pie">
        {pideMaquina && (
          <button type="button" className="cjh-masDatos"
            onClick={() => { onFormularioCompleto("EXPENSE", pideMaquina.codigo, texto, pideMaquina.monto); limpiar(); }}>
            Va a bodega o son varios: abrir formulario
          </button>
        )}
        {error ? <span className="cjh-error">⚠️ {error}</span> : (
          <span>Primero quién o qué máquina (si no hay, <kbd>Enter</kbd>) y luego qué se hizo: <i>Secadora 3</i> → <i>cambio de bandas</i>. También en una sola línea: <i>comida</i> · <i>20 lb de 0,11</i> · <i>abono Gabino</i> · <i>cuadrilla embarque 315 x 0,20</i>.
            {" "}<kbd>Enter</kbd> en el monto guarda y sigues con la próxima · <kbd>Esc</kbd> limpia · el <b>tipo</b> se queda para la siguiente fila{opcionesPago.length > 0 && <> · <b>💳</b> = no salió de la gaveta</>}
            {movimientos.some((m) => origenExterno(m)) && <span className="cjh-leyenda">En gris: lo que se registró desde otros módulos (pedidos, anticipos, compras…).</span>}</span>
        )}
        {pagoElegido && !error && <span className="cjh-aviso">{pagoElegido.icono} {pagoElegido.titulo}: {pagoElegido.detalle}.</span>}
        {fecha !== hoy && !error && <span className="cjh-aviso">📅 Se registrará con fecha {fecha.split("-").reverse().join("/")}. <kbd>Esc</kbd> vuelve a hoy.</span>}
      </div>
      {menuPago && (
        <MenuPago ancla={menuPago} valor={pago} opciones={opcionesPago} onCerrar={() => setMenuPago(null)}
          onElegir={(v) => { setPago(v); setMenuPago(null); enfocar(v === "CREDITO" ? "acreedor" : "salida"); }} />
      )}
    </div>
  );
}

// 💳 ¿Cómo se pagó? Lista sobre la fila (la hoja tiene scroll y un menú normal quedaría recortado).
function MenuPago({ ancla, valor, opciones, onElegir, onCerrar }: {
  ancla: HTMLElement; valor: string; opciones: Array<{ clave: string; icono: string; titulo: string; detalle: string }>;
  onElegir: (clave: string) => void; onCerrar: () => void;
}) {
  const r = ancla.getBoundingClientRect();
  const abajo = window.innerHeight - r.bottom > 260;
  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (!(e.target as HTMLElement | null)?.closest?.(".cjh-pagos") && e.target !== ancla) onCerrar(); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    document.addEventListener("mousedown", fuera); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [ancla, onCerrar]);
  const todas = [{ clave: PAGO_GAVETA, icono: "💵", titulo: "De la gaveta", detalle: "efectivo de esta caja" }, ...opciones];
  return createPortal(
    <ul className="cjh-lista cjh-pagos" role="menu" style={{ right: Math.max(8, window.innerWidth - r.right), ...(abajo ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }), width: 290, left: "auto" }}>
      {todas.map((o) => (
        <li key={o.clave} role="menuitem" className={o.clave === valor ? "is-on" : ""} onMouseDown={(e) => { e.preventDefault(); onElegir(o.clave); }}>
          <span>{o.icono} {o.titulo}</span><small>{o.detalle}</small>
        </li>
      ))}
    </ul>,
    document.body
  );
}

// Celda con autocompletado propio (la lista nativa del navegador se come el Enter): ↑/↓ eligen, Enter o Tab toman la
// marcada y pasan a la siguiente celda, Esc cierra la lista (o limpia la fila si ya está cerrada).
type Opcion = { valor: string; detalle?: string; tono?: string };
function CeldaSugerida({ value, opciones, minimo, elegirPrimera, onChange, onEnter, onEscape, onBlur, inputRef, placeholder, disabled, ariaLabel, className }: {
  value: string; opciones: Opcion[]; minimo: number; elegirPrimera: boolean;
  onChange: (v: string) => void; onEnter: (v: string) => void; onEscape: () => void; onBlur?: () => void;
  inputRef: (el: HTMLInputElement | null) => void; placeholder: string; disabled: boolean; ariaLabel: string; className?: string;
}) {
  const [abierta, setAbierta] = useState(false);
  const [idx, setIdx] = useState(-1);
  // La lista se dibuja fija sobre la celda (la hoja tiene scroll): hacia abajo si hay sitio.
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
  const caja = useRef<HTMLDivElement | null>(null);
  const ubicar = () => { const r = caja.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, width: Math.max(r.width, 240), ...(window.innerHeight - r.bottom > 230 || r.top < 230 ? { top: r.bottom + 2 } : { bottom: window.innerHeight - r.top + 2 }) }); };
  const t = sinTilde(value);
  const lista = useMemo(() => {
    if (t.length < minimo) return [];
    if (!t) return opciones.slice(0, 50);
    const empieza: Opcion[] = [], contiene: Opcion[] = [];
    for (const o of opciones) {
      const n = sinTilde(o.valor);
      if (n === t && !elegirPrimera) continue;
      if (n.startsWith(t)) empieza.push(o); else if (n.includes(t)) contiene.push(o);
      if (empieza.length >= 8) break;
    }
    return [...empieza, ...contiene].slice(0, 8);
  }, [t, opciones, minimo, elegirPrimera]);
  const visible = abierta && lista.length > 0;
  const marcada = visible ? (idx >= 0 ? idx : elegirPrimera ? 0 : -1) : -1;
  const tomar = (o?: Opcion) => { const v = o ? o.valor : value; if (o) onChange(v); setAbierta(false); setIdx(-1); return v; };
  return (
    <div className="cjh-combo" ref={caja}>
      <input ref={inputRef} value={value} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel} className={className}
        autoComplete="off" role="combobox" aria-expanded={visible}
        onChange={(e) => { onChange(e.target.value); setAbierta(true); setIdx(-1); ubicar(); }}
        onFocus={() => { setAbierta(true); ubicar(); }}
        onBlur={() => { setTimeout(() => setAbierta(false), 120); onBlur?.(); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!lista.length) return;
            e.preventDefault(); setAbierta(true);
            setIdx((i) => { const base = i >= 0 ? i : elegirPrimera ? 0 : -1; return e.key === "ArrowDown" ? Math.min(lista.length - 1, base + 1) : Math.max(0, base - 1); });
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (visible) { setAbierta(false); setIdx(-1); } else onEscape();
          } else if (e.key === "Enter") {
            e.preventDefault();
            onEnter(tomar(marcada >= 0 ? lista[marcada] : undefined));
          } else if (e.key === "Tab" && marcada >= 0) {
            tomar(lista[marcada]);
          }
        }} />
      {visible && createPortal(
        <ul className="cjh-lista" role="listbox" style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.top !== undefined ? Math.max(140, Math.min(260, window.innerHeight - pos.top - 8)) : undefined } : undefined}>
          {lista.map((o, i) => (
            <li key={o.valor} role="option" aria-selected={i === marcada} className={`${i === marcada ? "is-on" : ""} ${o.tono ?? ""}`}
              onMouseDown={(e) => { e.preventDefault(); onEnter(tomar(o)); }}>
              <span>{o.valor}</span>{o.detalle && <small>{o.detalle}</small>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}
