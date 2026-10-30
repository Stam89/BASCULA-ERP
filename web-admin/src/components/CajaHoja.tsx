import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { money } from "../format";

// 📋 CAJA TIPO HOJA DE CÁLCULO (pedido del dueño 2026-10-30): los movimientos de la sesión en filas continuas, como su
// Excel de caja (FECHA · CONCEPTO · CATEGORÍA · CÓDIGO · ENTRADAS · SALIDAS · SALDO), con el saldo acumulado fila por
// fila y una fila de captura al final: Enter o Tab pasa de celda en celda y Enter en el monto guarda.
// Solo registra movimientos SIMPLES (categoría + monto + detalle). Las categorías que piden más datos (equipo, sacos,
// repuestos, activo fijo…) abren el formulario completo con lo escrito.

export type HojaMov = {
  id: string; movement: "INCOME" | "EXPENSE"; category: string; amount: string | number; description: string | null;
  reference_type: string | null; created_at: string; reversal_of?: string | null; reversed_at?: string | null;
  reversed_reason?: string | null; subcategoria?: string | null; proveedor_nombre?: string | null; medio?: string | null;
  es_fondo?: boolean; fondo_estado?: string | null; responsable?: string | null; codigo?: string | null;
  maq_activo?: string | null; area?: string | null;
};
export type HojaCredito = {
  id: string; amount: string | number; balance: string | number; status: string; created_at: string;
  description?: string | null; categoria?: string | null; proveedor_nombre?: string | null;
};
export type HojaCategoria = { codigo: string; nombre: string; tipo: "INGRESO" | "EGRESO" };
/** 🧭 «¿De quién?» (pedido del dueño 2026-10-30): de esta caja, de Transporte (una máquina o general), un anticipo a
 *  un operador de Transporte, o un gasto de un socio. Cada uno sigue su flujo (cruces, vale, deuda), no un egreso suelto. */
export type HojaDestino = { valor: string; tipo: "propio" | "transporte" | "anticipo" | "socio"; id?: string; detalle?: string; claves?: string[] };
export type HojaNueva = {
  movement: "INCOME" | "EXPENSE"; category: string; amount: number; description: string; codigo: string; medio: "EFECTIVO" | "BANCO";
  destino?: HojaDestino;
  /** 💳 No salió de la gaveta: lo pagó el banco / la tarjeta de débito de esta empresa. */
  banco?: boolean;
};

/** Rubro flexible (migración 20261129): donaciones, refrigerios, aportes menores… con descripción libre. */
export const RUBRO_VARIOS = { EGRESO: "GASTOS_VARIOS", INGRESO: "INGRESOS_VARIOS" } as const;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const sinTilde = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const fechaCorta = (iso: string) => new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const CELDAS = ["concepto", "categoria", "quien", "codigo", "entrada", "salida"] as const;
// Para reconocer la máquina en el concepto: «Diésel cose 10,1» → COS101 (como «COS.10.1»).
export const claveMaq = (x: string) => sinTilde(x).toUpperCase().replace(/\bCOSE\b/g, "COS").replace(/[^A-Z0-9]/g, "");
type Celda = typeof CELDAS[number];

export function CajaHoja({
  movimientos, creditos, verOtros, origenExterno, saldoInicial, categorias, sugerencias, mixto, puedeAnular,
  esCompleja, onGuardar, onFormularioCompleto, onAnular, onAnularCredito, onRepetir, onLiquidarFondo,
  destinos = [], puedeBanco = false
}: {
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
  const [concepto, setConcepto] = useState("");
  const [catTxt, setCatTxt] = useState("");
  const [codigo, setCodigo] = useState("001");
  const [entrada, setEntrada] = useState("");
  const [salida, setSalida] = useState("");
  const [medio, setMedio] = useState<"EFECTIVO" | "BANCO">("EFECTIVO");
  const [quienTxt, setQuienTxt] = useState("");
  const [quienManual, setQuienManual] = useState(false);
  const [banco, setBanco] = useState(false);
  const conQuien = destinos.length > 0;
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const refs = useRef<Partial<Record<Celda, HTMLInputElement | null>>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const nombreCat = useMemo(() => new Map(categorias.map((c) => [c.codigo, c.nombre])), [categorias]);
  // Categoría escrita → la del catálogo (nombre exacto; si no, la única que empieza o contiene lo escrito).
  const resolverCat = (txt: string): HojaCategoria | null => {
    const t = sinTilde(txt.replace(/^[+−-]\s*/, ""));
    if (!t) return null;
    const exacta = categorias.find((c) => sinTilde(c.nombre) === t || sinTilde(c.codigo) === t);
    if (exacta) return exacta;
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
  // Lo que dice el concepto: «Diésel cose 10» → Transporte · COS.10; «Anticipo LEONEL» → vale de LEONEL.
  const detectarQuien = (txt: string): HojaDestino | null => {
    if (!conQuien) return null;
    const k = claveMaq(txt);
    if (/ANTICIPO/.test(k)) {
      const op = destinos.find((d) => d.tipo === "anticipo" && (d.claves ?? []).some((c) => c && k.includes(c)));
      if (op) return op;
    }
    const maquinas = destinos.filter((d) => d.tipo === "transporte" && d.id)
      .map((d) => ({ d, c: [...(d.claves ?? [])].filter((x) => x.length >= 4).filter((x) => k.includes(x)).sort((a, b) => b.length - a.length)[0] ?? "" }))
      .filter((x) => x.c).sort((a, b) => b.c.length - a.c.length);
    return maquinas[0]?.d ?? null;
  };
  const quien = resolverQuien(quienTxt);
  const esAnticipo = quien?.tipo === "anticipo";
  const cat = resolverCat(catTxt);
  const tipo: "INCOME" | "EXPENSE" | null = esAnticipo ? "EXPENSE" : cat ? (cat.tipo === "INGRESO" ? "INCOME" : "EXPENSE") : null;

  // Memoria: el mismo concepto escrito antes sugiere su categoría.
  const catPorConcepto = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of [...movimientos].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
      if (x.description && !x.reference_type && !x.reversal_of) m.set(sinTilde(x.description), x.category);
    }
    return m;
  }, [movimientos]);

  // Saldo acumulado con TODOS los movimientos (también los de otros módulos aunque estén escondidos).
  const filas = useMemo(() => {
    let saldo = saldoInicial;
    const orden = [...movimientos].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    const conSaldo = orden.map((m) => {
      saldo = r2(saldo + (m.movement === "INCOME" ? 1 : -1) * Number(m.amount));
      return { k: "mov" as const, t: m.created_at, m, saldo };
    });
    const visibles = conSaldo.filter((f) => verOtros || !origenExterno(f.m));
    // Los egresos a crédito van en su hora, sin mover el saldo (son Cuentas por Pagar).
    const todas: Array<typeof visibles[number] | { k: "cred"; t: string; c: HojaCredito; saldo: number }> = [...visibles];
    for (const c of creditos) {
      const previo = [...conSaldo].reverse().find((f) => f.t <= c.created_at);
      todas.push({ k: "cred", t: c.created_at, c, saldo: previo ? previo.saldo : saldoInicial });
    }
    return todas.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  }, [movimientos, creditos, verOtros, origenExterno, saldoInicial]);

  const totEntradas = r2(movimientos.filter((m) => m.movement === "INCOME").reduce((s, m) => s + Number(m.amount), 0));
  const totSalidas = r2(movimientos.filter((m) => m.movement === "EXPENSE").reduce((s, m) => s + Number(m.amount), 0));
  const saldoFinal = r2(saldoInicial + totEntradas - totSalidas);

  // La hoja abre al final (lo último y la fila de captura).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filas.length]);

  // Foco al instante (quien escribe rápido no pierde letras); si la celda aún está deshabilitada, en cuanto se habilite.
  const enfocar = (c: Celda) => {
    const ir = () => { const el = refs.current[c]; if (!el || el.disabled) return false; el.focus(); el.select(); return true; };
    if (!ir()) setTimeout(ir, 0);
  };
  const limpiar = () => {
    setConcepto(""); setCatTxt(""); setCodigo("001"); setEntrada(""); setSalida(""); setError("");
    setQuienTxt(""); setQuienManual(false); setBanco(false); enfocar("concepto");
  };

  const guardar = async (forzada?: HojaCategoria | null) => {
    setError("");
    const destino = conQuien ? resolverQuien(quienTxt) : null;
    if (conQuien && !destino) { setError(`No hay «${quienTxt.trim()}» en ¿De quién?. Elígelo de la lista.`); enfocar("quien"); return; }
    const anticipo = destino?.tipo === "anticipo";
    const cat = forzada ?? resolverCat(catTxt);
    const tipo = anticipo ? "EXPENSE" : cat ? (cat.tipo === "INGRESO" ? "INCOME" : "EXPENSE") : null;
    if (!cat && !anticipo) { setError(catTxt.trim() ? `No hay una categoría «${catTxt.trim()}». Elígela de la lista.` : "Escribe la categoría."); enfocar("categoria"); return; }
    const deOtro = !!destino && destino.tipo !== "propio";
    if (tipo === "INCOME" && deOtro) { setError("Solo una salida puede ser de Transporte, de un operador o de un socio."); enfocar("quien"); return; }
    if (tipo === "INCOME" && banco) { setError("«💳 No es efectivo» es solo para salidas."); return; }
    const monto = r2(Number((tipo === "INCOME" ? entrada : salida).replace(",", ".")));
    // Lo que pide más datos (o tiene su propio flujo, como las ventas) abre su formulario; de Transporte/socio no.
    if (cat && !deOtro && esCompleja(cat.codigo, tipo!)) { onFormularioCompleto(tipo!, cat.codigo, concepto.trim(), monto > 0 ? monto : null); limpiar(); return; }
    if (!(monto > 0)) { setError(`Escribe el monto en ${tipo === "INCOME" ? "Entradas" : "Salidas"}.`); enfocar(tipo === "INCOME" ? "entrada" : "salida"); return; }
    if (concepto.trim().length < 2) { setError("Escribe el concepto o la descripción."); enfocar("concepto"); return; }
    setGuardando(true);
    try {
      await onGuardar({ movement: tipo!, category: cat?.codigo ?? "", amount: monto, description: concepto.trim(), codigo: codigo.trim() || "001", medio,
        destino: destino ?? undefined, banco: banco || undefined });
      limpiar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally { setGuardando(false); }
  };

  // Enter = siguiente celda (Tab ya lo hace el navegador); Enter en el monto guarda; Esc limpia la fila.
  // Concepto y Categoría llegan con el valor ya elegido de su lista (`valor`), sin esperar al estado.
  const siguiente = (c: Celda, valor?: string) => {
    if (c === "concepto") {
      const previa = catPorConcepto.get(sinTilde(valor ?? concepto));
      if (previa && !catTxt && nombreCat.get(previa)) setCatTxt(nombreCat.get(previa)!);
      // Si el concepto nombra una máquina de Transporte o un anticipo a un operador, «¿De quién?» se llena solo.
      const detectado = !quienManual ? detectarQuien(valor ?? concepto) : null;
      if (detectado) setQuienTxt(detectado.valor);
      enfocar(detectado?.tipo === "anticipo" ? "salida" : "categoria");
    } else if (c === "categoria") {
      const elegida = resolverCat(valor ?? catTxt);
      if (elegida) setCatTxt(elegida.nombre);
      const deOtro = !!quien && quien.tipo !== "propio";
      if (elegida && !deOtro && esCompleja(elegida.codigo, elegida.tipo === "INGRESO" ? "INCOME" : "EXPENSE")) { guardar(elegida); return; }
      enfocar(elegida ? (conQuien ? "quien" : "codigo") : "categoria");
    } else if (c === "quien") {
      const elegido = resolverQuien(valor ?? quienTxt);
      if (elegido) setQuienTxt(elegido.valor);
      enfocar(elegido ? (elegido.tipo === "anticipo" ? "salida" : "codigo") : "quien");
    }
  };
  const tecla = (c: Celda) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); limpiar(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (c === "codigo") {
      enfocar(tipo === "INCOME" ? "entrada" : tipo === "EXPENSE" ? "salida" : "categoria");
    } else {
      guardar();
    }
  };

  // Conceptos rápidos: el rubro flexible y las categorías más usadas en esta caja.
  const rapidos = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const m of movimientos) if (!m.reference_type && !m.reversal_of) cuenta.set(m.category, (cuenta.get(m.category) ?? 0) + 1);
    const usadas = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
      .filter((k) => k !== RUBRO_VARIOS.EGRESO && k !== RUBRO_VARIOS.INGRESO);
    const lista = [RUBRO_VARIOS.EGRESO, RUBRO_VARIOS.INGRESO, ...usadas].map((k) => categorias.find((c) => c.codigo === k)).filter(Boolean) as HojaCategoria[];
    return lista.slice(0, 8);
  }, [movimientos, categorias]);

  const opcionesCat = useMemo(() => categorias.map((c) => ({ valor: c.nombre, detalle: c.tipo === "INGRESO" ? "+ entrada" : "− salida", tono: c.tipo === "INGRESO" ? "is-in" : "is-out" })), [categorias]);
  const opcionesConcepto = useMemo(() => sugerencias.map((x) => ({ valor: x })), [sugerencias]);
  const opcionesQuien = useMemo(() => destinos.map((d) => ({ valor: d.valor, detalle: d.detalle, tono: d.tipo === "propio" ? "" : d.tipo === "socio" ? "is-in" : "is-out" })), [destinos]);

  // Columna «¿De quién?» de lo ya registrado: Transporte (gasto que pagó esta caja), un socio, o el banco.
  const quienDeMovimiento = (m: HojaMov) => {
    const d = (m.description ?? "");
    if (m.reference_type === "campo_cxp") return /Anticipo a /.test(d) ? `👷 ${(d.match(/Anticipo a ([^:(·]+)/)?.[1] ?? "operador").trim()}` : "🚜 Transporte";
    if (m.category === "GASTO_POR_SOCIO") return `🤝 ${(d.match(/^Gasto de ([^:]+):/)?.[1] ?? "socio").trim()}`;
    if (m.reference_type === "pagado_con_banco") return "💳 Banco";
    return "";
  };
  const etiquetaCat = (codigo: string | null | undefined) => (codigo ? nombreCat.get(codigo) ?? codigo.replace(/_/g, " ").toLowerCase() : "—");

  return (
    <div className="cjh">
      {rapidos.length > 0 && (
        <div className="cjh-rapidos">
          <span>Conceptos rápidos</span>
          {rapidos.map((c) => (
            <button key={c.codigo} type="button" className={c.tipo === "INGRESO" ? "is-in" : "is-out"} title={c.nombre}
              onClick={() => { setCatTxt(c.nombre); setError(""); enfocar(concepto.trim() ? (c.tipo === "INGRESO" ? "entrada" : "salida") : "concepto"); }}>
              {c.tipo === "INGRESO" ? "+" : "−"} {c.nombre}
            </button>
          ))}
        </div>
      )}
      <div className="cjh-scroll" ref={scrollRef}>
        <table className="cjh-tabla">
          <thead>
            <tr>
              <th className="cjh-n">#</th>
              <th>Fecha</th>
              <th>Concepto / descripción</th>
              <th>Categoría</th>
              {conQuien && <th>¿De quién?</th>}
              <th>Código</th>
              <th className="num">Entradas $</th>
              <th className="num">Salidas $</th>
              <th className="num">Saldo $</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr className="cjh-inicial">
              <td className="cjh-n" />
              <td colSpan={conQuien ? 5 : 4}>Saldo inicial de la caja</td>
              <td /><td />
              <td className="num"><b>{money(saldoInicial)}</b></td>
              <td />
            </tr>
            {filas.map((f, i) => {
              if (f.k === "cred") {
                const c = f.c;
                const anulado = c.status === "CANCELLED";
                const abonado = Number(c.amount) - Number(c.balance);
                return (
                  <tr key={`cred-${c.id}`} className={`cjh-cred ${anulado ? "is-anulado" : ""}`}>
                    <td className="cjh-n">{i + 1}</td>
                    <td className="cjh-fecha">{fechaCorta(c.created_at)}</td>
                    <td>
                      {c.description ?? "—"}
                      <small>💳 A crédito · 🏪 {c.proveedor_nombre ?? "—"}{anulado ? " · ANULADO" : Number(c.balance) < 0.005 ? " · pagada" : abonado > 0.005 ? ` · saldo ${money(Number(c.balance))}` : " · en Por Pagar"}</small>
                    </td>
                    <td>{etiquetaCat(c.categoria)}</td>
                    {conQuien && <td className="cjh-quien">—</td>}
                    <td className="cjh-cod">—</td>
                    <td />
                    <td className="num cjh-sin">{money(Number(c.amount))}<small>no sale de caja</small></td>
                    <td className="num">{money(f.saldo)}</td>
                    <td className="cjh-acc">
                      {puedeAnular && !anulado && abonado < 0.005 && <button type="button" onClick={() => onAnularCredito(c)}>Anular</button>}
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
                <tr key={m.id} className={`${entra ? "is-in" : "is-out"} ${anulado ? "is-anulado" : ""} ${esAnulacion ? "is-reverso" : ""}`}>
                  <td className="cjh-n">{i + 1}</td>
                  <td className="cjh-fecha">{fechaCorta(m.created_at)}</td>
                  <td>
                    {m.description || etiquetaCat(m.category)}
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
                  <td>{etiquetaCat(m.category)}</td>
                  {conQuien && <td className="cjh-quien">{quienDeMovimiento(m)}</td>}
                  <td className="cjh-cod">{m.codigo || "001"}</td>
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
            {/* Fila de captura: como escribir la siguiente línea del Excel. */}
            <tr className="cjh-nueva">
              <td className="cjh-n">＋</td>
              <td className="cjh-fecha">Hoy</td>
              <td>
                <CeldaSugerida inputRef={(el) => { refs.current.concepto = el; }} value={concepto} opciones={opcionesConcepto} minimo={2} elegirPrimera={false}
                  placeholder="Concepto (ej: refrigerio, JUAN PÉREZ…)" disabled={guardando} ariaLabel="Concepto o descripción"
                  onChange={setConcepto} onEnter={(v) => siguiente("concepto", v)} onEscape={limpiar} />
              </td>
              <td>
                <CeldaSugerida inputRef={(el) => { refs.current.categoria = el; }} value={catTxt} opciones={opcionesCat} minimo={0} elegirPrimera
                  placeholder="Categoría" disabled={guardando} ariaLabel="Categoría"
                  className={catTxt && !cat ? "is-mal" : tipo === "INCOME" ? "is-in" : tipo === "EXPENSE" ? "is-out" : ""}
                  onChange={(v) => { setCatTxt(v); setError(""); }} onEnter={(v) => siguiente("categoria", v)} onEscape={limpiar}
                  onBlur={() => { if (cat) setCatTxt(cat.nombre); }} />
              </td>
              {conQuien && (
                <td>
                  <CeldaSugerida inputRef={(el) => { refs.current.quien = el; }} value={quienTxt} opciones={opcionesQuien} minimo={0} elegirPrimera
                    placeholder={destinos[0]?.valor ?? "Esta caja"} disabled={guardando} ariaLabel="¿De quién es?"
                    className={quienTxt && !quien ? "is-mal" : quien && quien.tipo !== "propio" ? "is-out" : ""}
                    onChange={(v) => { setQuienTxt(v); setQuienManual(true); setError(""); }} onEnter={(v) => siguiente("quien", v)} onEscape={limpiar}
                    onBlur={() => { if (quien && quienTxt) setQuienTxt(quien.valor); }} />
                </td>
              )}
              <td>
                <input ref={(el) => { refs.current.codigo = el; }} value={codigo} className="cjh-cod" maxLength={20} disabled={guardando}
                  onChange={(e) => setCodigo(e.target.value)} onKeyDown={tecla("codigo")} aria-label="Código" />
              </td>
              <td>
                <input ref={(el) => { refs.current.entrada = el; }} value={entrada} inputMode="decimal" className="num"
                  placeholder={tipo === "EXPENSE" ? "" : "0.00"} disabled={guardando || tipo === "EXPENSE"}
                  onChange={(e) => setEntrada(e.target.value.replace(/[^\d.,]/g, ""))} onKeyDown={tecla("entrada")} aria-label="Entradas" />
              </td>
              <td>
                <input ref={(el) => { refs.current.salida = el; }} value={salida} inputMode="decimal" className="num"
                  placeholder={tipo === "INCOME" ? "" : "0.00"} disabled={guardando || tipo === "INCOME"}
                  onChange={(e) => setSalida(e.target.value.replace(/[^\d.,]/g, ""))} onKeyDown={tecla("salida")} aria-label="Salidas" />
              </td>
              <td className="num cjh-saldo">
                {(() => {
                  const n = Number((tipo === "INCOME" ? entrada : salida).replace(",", "."));
                  return tipo && n > 0 ? money(r2(saldoFinal + (tipo === "INCOME" ? n : -n))) : "";
                })()}
              </td>
              <td className="cjh-acc">
                {puedeBanco && !mixto && (
                  <button type="button" className={`cjh-banco ${banco ? "is-on" : ""}`} aria-pressed={banco} disabled={guardando || tipo === "INCOME"}
                    title="💳 No es efectivo: lo pagó el banco / la tarjeta de débito de esta empresa (no sale de la gaveta)"
                    onClick={() => setBanco((b) => !b)}>💳</button>
                )}
                {mixto && (
                  <select value={medio} onChange={(e) => setMedio(e.target.value as "EFECTIVO" | "BANCO")} aria-label="Efectivo o banco" disabled={guardando}>
                    <option value="EFECTIVO">💵</option>
                    <option value="BANCO">🏦</option>
                  </select>
                )}
                <button type="button" className="cjh-guardar" disabled={guardando} onClick={() => { guardar(); }}>{guardando ? "…" : "Guardar ↵"}</button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td className="cjh-n" />
              <td colSpan={conQuien ? 5 : 4}>TOTALES DE LA SESIÓN</td>
              <td className="num cjh-entra">{money(totEntradas)}</td>
              <td className="num cjh-sale">{money(totSalidas)}</td>
              <td className="num"><b>{money(saldoFinal)}</b></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="cjh-pie">
        {error ? <span className="cjh-error">⚠️ {error}</span> : (
          <span><kbd>Enter</kbd>/<kbd>Tab</kbd> pasa a la siguiente celda · <kbd>Enter</kbd> en el monto guarda · <kbd>Esc</kbd> limpia la fila · lo que pide más datos (equipo, sacos, repuestos, ventas…) abre su formulario
            {conQuien && <> · <b>¿De quién?</b>: esta caja, 🚜 Transporte, 👷 anticipo a un operador o 🤝 un socio</>}
            {puedeBanco && <> · <b>💳</b> = no salió de la gaveta (banco / tarjeta)</>}</span>
        )}
        {banco && !error && <span className="cjh-aviso">💳 Esta salida no sale de la gaveta: entra lo mismo como «Retiro del banco».</span>}
      </div>
    </div>
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
  // La lista se dibuja fija sobre la celda (la hoja tiene scroll y la fila de captura está al fondo).
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const caja = useRef<HTMLDivElement | null>(null);
  const ubicar = () => { const r = caja.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, bottom: window.innerHeight - r.top + 2, width: Math.max(r.width, 240) }); };
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
        <ul className="cjh-lista" role="listbox" style={pos ? { left: pos.left, bottom: pos.bottom, width: pos.width } : undefined}>
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
