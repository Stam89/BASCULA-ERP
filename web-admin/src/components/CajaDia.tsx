import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { apiGet, apiPatch, apiPost, apiPut } from "../api";
import { money } from "../format";
import { confirmar, pedirTexto } from "./Dialogo";
import { buscarRegla, categoriaPorPalabras, type ProductoHoja, type ReglaCaja } from "./cajaHojaLeer";
import { cuenta, leer, norm, type Bloque, type CuentaLeida, type DeudorLeido, type Lectura } from "./cajaDiaLeer";
import { guardarRenglon, resolver, type ApoyoDia, type Borrador, type ContextoDia, type Flujo, type Pago, type Plan } from "./cajaDiaGuardar";
import "./cajaDia.css";

// 📒 CAJA DEL DÍA (pedido del dueño 2026-11-23): la hoja de un día como su Excel. Tres bloques (ingresos, egresos de la piladora,
// egresos de Transporte); se escribe quién, qué y cuánto, y debajo la hoja dice en palabras simples a dónde se va. Lo que no
// entiende lo pregunta; nada se guarda adivinando.
// Dos vistas (pedido del dueño 2026-11-24): «Lo último arriba» (una sola captura fija y los renglones en el orden en que se
// registraron, el más nuevo primero con el saldo que quedó después de él) y «Por bloques», la de su Excel.

type Fila = {
  k: string; origen: "hoja" | "otro"; bloque: Bloque; quien: string; detalle: string; monto: number; efecto: number; sin_gaveta: string; flujo: string; categoria: string | null;
  datos: Record<string, unknown>; reportar: string | null; reportado_at: string | null; anulado: boolean; anulado_motivo: string | null; hora: string; por: string | null; maquina: string | null; socio: string | null;
};
type Dia = {
  caja: { id: string; nombre: string; tipo: string; abierta: string; es_matriz: boolean }; fecha: string; hoy: string; anterior: number; filas: Fila[]; anulados: Fila[];
  totales: { entro: number; salio: number; ingresos: number; piladora: number; transporte: number; disponible: number; descuadre: number };
  conteo: { lineas: string[]; apartado: string; contado: number; diferencia: number } | null;
  por_reportar: Array<{ id: string; fecha: string; quien: string; detalle: string; monto: number; reportar: string }>;
};
type EnCola = { id: string; bloque: Bloque; b: Borrador; plan: Plan; estado: "espera" | "enviando" | "error"; error?: string };

const BLOQUES: Array<{ b: Bloque; titulo: string; sub: string; que: string }> = [
  { b: "INGRESO", titulo: "⬇ Ingresos", sub: "lo que entra a la gaveta", que: "¿Qué entró?" },
  { b: "EGRESO", titulo: "⬆ Egresos piladora", sub: "lo que sale por la piladora y los socios", que: "¿Qué se hizo?" },
  { b: "TRANSPORTE", titulo: "🚜 Egresos transporte / cosechadora", sub: "sale de la misma gaveta", que: "¿Qué se hizo?" }
];
const CORTO: Record<Bloque, string> = { INGRESO: "⬇ Ingreso", EGRESO: "⬆ Egreso piladora", TRANSPORTE: "🚜 Egreso transporte" };
const MARCA: Record<Bloque, string> = { INGRESO: "⬇", EGRESO: "⬆", TRANSPORTE: "🚜" };
const CLAVE_VISTA = "bascula-erp:caja-dia-vista";
const FLUJOS: Record<Bloque, Array<[Flujo, string]>> = {
  INGRESO: [["venta", "🛒 Venta al detalle"], ["cobro", "📥 Cobro de una cuenta"], ["fomento_dev", "🌾 Devuelve fomento"], ["banco", "🏦 Retiro del banco"], ["otro", "Otro ingreso"]],
  EGRESO: [["fomento", "🌾 Fomento"], ["agricultor", "🌾 Arroz a un agricultor"], ["pago", "📤 Pago de una cuenta"], ["nomina", "🗓️ Nómina pendiente"], ["maquina", "🔧 Máquina o repuesto"],
    ["socio", "🤝 Gasto de un socio"], ["fondo", "⏳ Fondo a rendir"], ["banco", "🏦 Depósito al banco"], ["otro", "🧾 Otro gasto"]],
  TRANSPORTE: [["transporte", "🚜 Gasto de Transporte"], ["operador", "👷 Anticipo a un operador"]]
};
const ICONO: Record<string, string> = { venta: "🛒 venta", cobro: "📥 cobro", fomento: "🌾 fomento", fomento_dev: "🌾 devuelve fomento", banco: "🏦 banco", agricultor: "🌾 arroz", pago: "📤 pago", nomina: "🗓️ nómina",
  maquina: "🔧 máquina", transporte: "🚜 transporte", operador: "👷 operador", socio: "🤝 socio", fondo: "⏳ fondo", arqueo: "🧮 arqueo", prestamo: "💸 préstamo", anulacion: "↩ anulación" };
const CAT_TRANSPORTE: Array<[string, string]> = [["DIESEL", "Diésel"], ["GASOLINA", "Gasolina"], ["VIATICOS", "Viáticos"], ["REPARACION_MANT", "Reparación / repuesto"], ["MATRICULACION", "Matriculación"], ["OTROS", "Otros"]];
const FUERA: Record<string, string> = { banco: "🏦 por el banco", credito: "📝 a crédito", socio: "🤝 lo pagó un socio", cuenta: "📝 a cuenta" };
const vacio = (): Borrador => ({ q: "", d: "", m: "", pago: "" });
const larga = (f: string) => { const t = new Date(`${f}T12:00:00`).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long" }); return t.charAt(0).toUpperCase() + t.slice(1); };
const corta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const mover = (f: string, n: number) => { const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
// getRandomValues: randomUUID no existe entrando por http://IP:4000.
const uuid = () => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

/** Elegir escribiendo: al coincidir con una opción queda elegida. */
function Elegir({ id, valor, opciones, placeholder, onElegir }: { id: string; valor: string; opciones: Array<{ v: string; t: string }>; placeholder: string; onElegir: (v: string) => void }) {
  const actual = opciones.find((o) => o.v === valor)?.t ?? "";
  const [txt, setTxt] = useState(actual);
  useEffect(() => { setTxt(actual); }, [actual]);
  return <>
    <input className="cjd-elegir" list={id} value={txt} placeholder={placeholder} aria-label={placeholder}
      onChange={(e) => { setTxt(e.target.value); const o = opciones.find((x) => norm(x.t) === norm(e.target.value)); if (o) onElegir(o.v); else if (valor) onElegir(""); }} />
    <datalist id={id}>{opciones.map((o) => <option key={o.v} value={o.t} />)}</datalist>
  </>;
}

export function CajaDia({ version, cajaId, matriz, productos, bodegaId, categorias, reglas, memoria, puedeEditar, puedeAnular, onCambio, onNomina, onFormulario, avisar }: {
  /** Sube cuando otro equipo guardó algo: se vuelve a leer el día. */
  version: number; cajaId: string; matriz: { id: string; nombre: string };
  productos: ProductoHoja[]; bodegaId: string | null;
  categorias: Array<{ codigo: string; nombre: string; tipo: "INGRESO" | "EGRESO" }>;
  reglas: ReglaCaja[]; memoria: Array<{ concepto: string; category: string }>;
  puedeEditar: boolean; puedeAnular: boolean;
  onCambio: () => Promise<unknown>; onNomina: () => void; onFormulario: () => void;
  avisar: (m: string, t: "success" | "error" | "warn") => void;
}) {
  const [fecha, setFecha] = useState("");
  const [dia, setDia] = useState<Dia | null>(null);
  const [ctx, setCtx] = useState<ContextoDia | null>(null);
  const [error, setError] = useState("");
  const [borradores, setBorradores] = useState<Record<Bloque, Borrador>>({ INGRESO: vacio(), EGRESO: vacio(), TRANSPORTE: vacio() });
  const [cola, setCola] = useState<EnCola[]>([]);
  const colaRef = useRef<EnCola[]>([]);
  const corriendo = useRef(false);
  const pedido = useRef(0);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const [vista, setVista] = useState<"ultimo" | "bloques">(() => { try { return localStorage.getItem(CLAVE_VISTA) === "bloques" ? "bloques" : "ultimo"; } catch { return "ultimo"; } });
  const [bloque, setBloque] = useState<Bloque>("EGRESO");
  const [busca, setBusca] = useState("");
  const [ver, setVer] = useState<"" | Bloque>("");
  const [nuevos, setNuevos] = useState<Set<string>>(new Set());
  const scroll = useRef<HTMLDivElement | null>(null);

  const cargar = useCallback(async (f: string) => {
    const n = ++pedido.current;
    try {
      const [d, c] = await Promise.all([apiGet<Dia>(`/cash/dia/${cajaId}${f ? `?fecha=${f}` : ""}`), apiGet<ContextoDia>(`/cash/dia/${cajaId}/contexto${f ? `?fecha=${f}` : ""}`)]);
      if (n !== pedido.current) return;
      setDia(d); setCtx(c); setError("");
    } catch (e) { if (n === pedido.current) setError(e instanceof Error ? e.message : "No se pudo leer la caja"); }
  }, [cajaId]);
  useEffect(() => { void cargar(fecha); }, [cargar, fecha, version]);

  const apoyo = useMemo<ApoyoDia | null>(() => {
    if (!ctx || !dia) return null;
    const apodosDe = (tipo: string, nombre: string) => ctx.apodos.filter((a) => a.tipo === tipo && norm(a.nombre) === norm(nombre)).map((a) => a.apodo);
    const precios: Record<string, number> = {};
    const porClave = new Map<string, ProductoHoja>();
    for (const p of productos) {
      const l = norm(p.label);
      const k = /0[.,]11/.test(l) ? "0.11" : l.includes("3/4") ? "3/4" : ["fino", "polvillo", "corriente", "oso", "conejo", "flor", "lira", "envejecido"].find((w) => l.includes(w))?.toUpperCase();
      if (k && !porClave.has(k)) { porClave.set(k, p); precios[k] = p.precioLibra; }
    }
    return {
      ctx, caja: dia.caja, matriz, bodegaId, categorias, productoPorClave: porClave,
      lector: {
        precios, trabajadores: [...new Set(ctx.trabajadores.flatMap((t) => norm(t.nombre).split(" ").slice(0, 1)))].filter((x) => x.length >= 4),
        fomentos: ctx.fomentos.map((f) => ({ ...f, alias: apodosDe("fomento", f.nombre) })),
        cobros: ctx.cobros.map((p) => ({ ...p, alias: apodosDe("cobro", p.nombre) })) as DeudorLeido[],
        agricultores: ctx.agricultores.map((a) => ({ ...a, alias: [...a.alias, ...apodosDe("agricultor", a.nombre)] }))
      },
      categoriaDe: (q, d, porDefecto) => {
        const txt = [q, d].filter(Boolean).join(" · ");
        const codigos = new Set(categorias.map((c) => c.codigo));
        const val = (x?: string | null) => (x && codigos.has(x) ? x : null);
        const mem = (x: string) => val(memoria.find((m) => norm(m.concepto) === norm(x))?.category);
        return val(buscarRegla(txt, reglas, "ambas")) ?? mem(txt) ?? val(porDefecto) ?? val(buscarRegla(txt, reglas, "quien")) ?? val(buscarRegla(txt, reglas, "palabra")) ?? val(categoriaPorPalabras(txt, codigos));
      }
    };
  }, [ctx, dia, productos, bodegaId, categorias, reglas, memoria, matriz]);

  const planes = useMemo(() => {
    if (!apoyo) return null;
    const de = (bl: Bloque): { lectura: Lectura | null; plan: Plan | null } => {
      const b = borradores[bl];
      if (!b.q.trim() && !b.d.trim()) return { lectura: null, plan: null };
      const lectura = leer(bl, { cliente: b.d.trim() ? b.q : bl === "TRANSPORTE" ? "" : b.q, detalle: b.d, monto: cuenta(b.m) }, apoyo.lector);
      return { lectura, plan: resolver(bl, b, lectura, apoyo) };
    };
    return { INGRESO: de("INGRESO"), EGRESO: de("EGRESO"), TRANSPORTE: de("TRANSPORTE") };
  }, [borradores, apoyo]);

  const poner = (bl: Bloque, x: Partial<Borrador>) => setBorradores((s) => ({ ...s, [bl]: { ...s[bl], ...x } }));
  // Al reescribir quién o qué se hizo, lo elegido a mano para el texto anterior ya no vale.
  const escribir = (bl: Bloque, x: Partial<Pick<Borrador, "q" | "d">>) => setBorradores((s) => ({ ...s, [bl]: { q: s[bl].q, d: s[bl].d, m: s[bl].m, pago: s[bl].pago, ...x } }));
  const enfocar = (bl: Bloque, c: "q" | "d" | "m") => { const el = refs.current[`${bl}${c}`]; if (el) { el.focus(); el.select(); } };

  // ── Guardar: la fila se limpia al instante y lo escrito se envía en orden ──
  const cambiar = (f: (c: EnCola[]) => EnCola[]) => { colaRef.current = f(colaRef.current); setCola(colaRef.current); };
  const procesar = async (f: string) => {
    if (corriendo.current || !apoyo) return;
    corriendo.current = true;
    let guardados = 0;
    const hechos: string[] = [];
    try {
      for (;;) {
        const sig = colaRef.current.find((x) => x.estado === "espera");
        if (!sig) break;
        cambiar((c) => c.map((x) => (x.id === sig.id ? { ...x, estado: "enviando" } : x)));
        try {
          await guardarRenglon({ id: sig.id, fecha: f, bloque: sig.bloque, b: sig.b, plan: sig.plan, apoyo });
          guardados++;
          hechos.push(`r:${sig.id}`);
          cambiar((c) => c.filter((x) => x.id !== sig.id));
          if (sig.plan.apodo && sig.b.q.trim()) apiPost("/cash/dia/apodos", { tipo: sig.plan.apodo.tipo, apodo: sig.b.q.trim(), nombre: sig.plan.apodo.nombre }).catch(() => undefined);
        } catch (e) {
          const m = e instanceof Error ? e.message : "No se pudo guardar";
          cambiar((c) => c.map((x) => (x.id === sig.id ? { ...x, estado: "error", error: m } : x)));
        }
      }
      if (guardados) {
        setNuevos(new Set(hechos));
        setTimeout(() => setNuevos((n) => (hechos.some((x) => n.has(x)) ? new Set() : n)), 6500);
        scroll.current?.scrollTo({ top: 0 });
        await cargar(f);
        await onCambio().catch(() => undefined);
      }
    } finally {
      corriendo.current = false;
      if (colaRef.current.some((x) => x.estado === "espera")) void procesar(f);
    }
  };
  const guardar = (bl: Bloque) => {
    const p = planes?.[bl].plan;
    const b = borradores[bl];
    if (!b.q.trim() && !b.d.trim()) { enfocar(bl, "q"); return; }
    if (!(cuenta(b.m) > 0)) { enfocar(bl, "m"); return; }
    if (!p || !dia) return;
    if (p.falta) { avisar(p.falta, "warn"); return; }
    cambiar((c) => [...c, { id: uuid(), bloque: bl, b, plan: p, estado: "espera" }]);
    setBorradores((s) => ({ ...s, [bl]: vacio() }));
    enfocar(bl, "q");
    void procesar(dia.fecha);
  };
  const verComo = (v: "ultimo" | "bloques") => { setVista(v); try { localStorage.setItem(CLAVE_VISTA, v); } catch { /* sin memoria del navegador */ } };
  // Cambiar el tipo se lleva lo que ya estaba escrito.
  const cambiarBloque = (a: Bloque) => {
    const x = borradores[bloque];
    if (a !== bloque) {
      if (x.q || x.d || x.m) setBorradores((s) => ({ ...s, [bloque]: vacio(), [a]: { ...vacio(), q: x.q, d: x.d, m: x.m } }));
      setBloque(a);
    }
    setTimeout(() => enfocar(a, !x.q && !x.d ? "q" : x.d ? "m" : "d"), 0);
  };
  const tecla = (bl: Bloque, c: "q" | "d" | "m") => (e: KeyboardEvent) => {
    // Con la celda vacía, ← y → cambian el tipo (Alt+número ya cambia de negocio).
    if (vista === "ultimo" && c === "q" && !borradores[bl].q && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const tipos = BLOQUES.map((x) => x.b).filter((b) => b !== "TRANSPORTE" || dia?.caja.es_matriz);
      const i = tipos.indexOf(bl) + (e.key === "ArrowRight" ? 1 : -1);
      e.preventDefault();
      if (tipos[i]) cambiarBloque(tipos[i]);
      return;
    }
    if (e.key === "Escape") { setBorradores((s) => ({ ...s, [bl]: vacio() })); enfocar(bl, "q"); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (c === "q") enfocar(bl, "d"); else if (c === "d") enfocar(bl, "m"); else guardar(bl);
  };
  const irA = (f: string) => {
    if (colaRef.current.length) { avisar("Espera a que termine de guardarse, o corrige la fila que no se guardó.", "warn"); return; }
    setFecha(f);
  };

  const anular = async (f: Fila) => {
    const motivo = await pedirTexto({ titulo: `Anular ${[f.quien, f.detalle].filter(Boolean).join(" · ")} (${money(f.monto)})`, mensaje: "Se deshace todo lo que hizo este renglón. Escribe el motivo.", confirmar: "Anular", tono: "peligro", minimo: 3 });
    if (motivo === null || !dia) return;
    try { await apiPost(`/cash/dia/renglones/${f.k.slice(2)}/anular`, { motivo: motivo.trim() }); avisar("Renglón anulado", "success"); await cargar(dia.fecha); await onCambio(); }
    catch (e) { avisar(e instanceof Error ? e.message : "No se pudo anular", "error"); }
  };
  const hizo = async (f: Fila, d: string) => {
    if (!d || !dia) return;
    try { await apiPatch(`/cash/dia/renglones/${f.k.slice(2)}`, { fecha_trabajo: d }); await cargar(dia.fecha); } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo cambiar", "error"); }
  };
  const reporto = async (id: string) => {
    if (!dia || !(await confirmar("¿Ya entregó la cuenta de ese dinero?"))) return;
    try { await apiPost(`/cash/dia/renglones/${id}/reportado`, {}); await cargar(dia.fecha); } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo guardar", "error"); }
  };

  if (error && !dia) return <div className="cjd"><p className="alertBox">{error} <button type="button" onClick={() => { void cargar(fecha); }}>Reintentar</button></p></div>;
  if (!dia || !apoyo || !ctx) return <div className="cjd"><p className="muted" style={{ padding: 16 }}>Abriendo la hoja del día…</p></div>;

  const quienes = [...new Set([...ctx.cobros, ...ctx.pagos, ...ctx.fomentos, ...ctx.agricultores].map((x) => x.nombre))].sort();
  let saldo = dia.anterior;
  const t = dia.totales;

  const captura = (bl: Bloque, que: string) => {
    const b = borradores[bl];
    const { plan } = planes?.[bl] ?? { plan: null };
    const ingreso = bl === "INGRESO";
    const frec = ctx.frecuentes.filter((x) => x.bloque === bl).slice(0, 6);
    const campo = (c: "q" | "d" | "m", placeholder: string, extra?: object) => (
      <input ref={(el) => { refs.current[`${bl}${c}`] = el; }} value={b[c]} placeholder={placeholder} aria-label={`${placeholder} (${bl.toLowerCase()})`} autoComplete="off"
        onChange={(e) => (c === "m" ? poner(bl, { m: e.target.value }) : escribir(bl, { [c]: e.target.value }))} onKeyDown={tecla(bl, c)} {...extra} />
    );
    return (
      <div className="cjd-cap" key={`cap${bl}`}>
        <div className="cjd-cap__fila">
          {campo("q", "¿Quién o qué?", { list: "cjd-quienes" })}
          {campo("d", que)}
          {campo("m", "0.00", { inputMode: "decimal", className: "n" })}
        </div>
        {plan ? (
          <div className="cjd-plan" aria-live="polite">
            <div className="cjd-plan__txt">
              {plan.chips.map((c, i) => <span key={i} className={`cjd-t ${c.tono ?? ""}`}>{c.t}</span>)}
              {plan.falta && <span className="cjd-t av">{plan.falta}</span>}
            </div>
            <div className="cjd-plan__op">
              <select value={plan.flujo} aria-label="¿Qué es?" onChange={(e) => poner(bl, { flujo: e.target.value as Flujo, personaId: undefined, cuentaIds: undefined, socioId: undefined, categoria: undefined, maquinaId: undefined })}>
                {plan.flujo === "pregunta" && <option value="pregunta">❓ ¿Qué es?</option>}
                {FLUJOS[bl].map(([v, n]) => <option key={v} value={v}>{n}</option>)}
              </select>
              {plan.pide.includes("persona") && <Elegir id={`cjd-p-${bl}`} valor={plan.personaId ?? ""} placeholder="¿De quién?" opciones={plan.personas} onElegir={(v) => poner(bl, { personaId: v || "-", cuentaIds: undefined, socioId: undefined })} />}
              {plan.pide.includes("cuenta") && (
                <select aria-label="¿Cuál cuenta?" value={(b.cuentaIds ?? []).join(",")} onChange={(e) => poner(bl, { cuentaIds: e.target.value ? e.target.value.split(",") : undefined })}>
                  <option value="">Todas ({money(plan.cuentas.reduce((s: number, x: CuentaLeida) => s + x.saldo, 0))}), la más vieja primero</option>
                  {plan.cuentas.map((x) => <option key={x.id} value={x.id}>{money(x.saldo)} · {corta(x.fecha)} · {x.que}</option>)}
                </select>
              )}
              {plan.pide.includes("socio") && (
                <select aria-label="¿De qué socio?" value={plan.socioId ?? ""} onChange={(e) => poner(bl, { socioId: e.target.value || undefined })}>
                  <option value="">¿De qué socio?</option>{ctx.socios.filter((s) => plan.flujo !== "socio" || s.id !== matriz.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {plan.pide.includes("maquina") && <Elegir id={`cjd-m-${bl}`} valor={plan.maquinaId ?? ""} placeholder="¿De qué máquina?" opciones={ctx.maquinas.map((m) => ({ v: m.id, t: `${m.area} · ${m.section}` }))} onElegir={(v) => poner(bl, { maquinaId: v || "-" })} />}
              {plan.pide.includes("clase") && (
                <select aria-label="Tipo de trabajo" value={plan.clase ?? ""} onChange={(e) => poner(bl, { clase: e.target.value })}>
                  <option value="REPARACION">Reparación</option><option value="REPUESTO">Repuesto</option><option value="MATERIAL">Material</option>
                </select>
              )}
              {plan.pide.includes("activo") && (
                <select aria-label="¿Cuál máquina de Transporte?" value={plan.activoId ?? ""} onChange={(e) => poner(bl, { activoId: e.target.value || "-" })}>
                  <option value="">Transporte general</option>{ctx.transporte.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              )}
              {plan.pide.includes("catTransporte") && (
                <select aria-label="Categoría de Transporte" value={plan.catTransporte} onChange={(e) => poner(bl, { catTransporte: e.target.value })}>{CAT_TRANSPORTE.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
              )}
              {plan.pide.includes("operador") && (
                <select aria-label="¿Cuál operador?" value={plan.operador ?? ""} onChange={(e) => poner(bl, { operador: e.target.value || undefined })}>
                  <option value="">¿Cuál operador?</option>{ctx.operadores.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {plan.pide.includes("categoria") && (
                <select aria-label="Categoría" value={plan.categoria ?? ""} onChange={(e) => poner(bl, { categoria: e.target.value || undefined })}>
                  <option value="">Elige la categoría</option>{categorias.filter((c) => c.tipo === (ingreso ? "INGRESO" : "EGRESO")).map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                </select>
              )}
              {plan.pide.includes("fecha") && <label className="cjd-hizo">📅 se hizo el <input type="date" max={dia.hoy} value={b.fechaTrabajo ?? dia.fecha} onChange={(e) => poner(bl, { fechaTrabajo: e.target.value })} /></label>}
              {plan.pagos.length > 1 && (
                <select aria-label="¿Cómo se pagó?" value={plan.pago} onChange={(e) => poner(bl, { pago: e.target.value as Pago })}>{plan.pagos.map((p) => <option key={p.v} value={p.v}>{p.t}</option>)}</select>
              )}
              {plan.confirmar && <button type="button" className="cjd-btn" onClick={() => poner(bl, { flujo: plan.flujo })}>{plan.confirmar}</button>}
              {plan.sugerido != null && <button type="button" className="cjd-link" onClick={() => poner(bl, { m: String(plan.sugerido) })}>usar {money(plan.sugerido)}</button>}
              {plan.flujo === "nomina" && <button type="button" className="cjd-link" onClick={onNomina}>abrir Nómina</button>}
              {plan.formulario && <button type="button" className="cjd-link" onClick={onFormulario}>abrir el formulario</button>}
              <button type="button" className="cjd-btn" disabled={!!plan.falta || !(cuenta(b.m) > 0)} onClick={() => guardar(bl)}>Guardar {cuenta(b.m) > 0 ? money(cuenta(b.m)) : ""} ↵</button>
            </div>
            {plan.ultima && <div className="cjd-uv">{plan.ultima}</div>}
          </div>
        ) : frec.length > 0 && (
          <div className="cjd-frec">{frec.map((x, i) => <button key={i} type="button" onClick={() => { escribir(bl, { q: x.quien, d: x.detalle }); setTimeout(() => enfocar(bl, "m"), 0); }}>{[x.quien, x.detalle].filter(Boolean).join(" · ")}</button>)}</div>
        )}
      </div>
    );
  };

  const fila = (f: Fila) => {
    saldo = Math.round((saldo + f.efecto) * 100) / 100;
    return (
      <div key={f.k} className={`cjd-f ${f.origen === "hoja" ? "" : "otro"} ${f.quien ? "" : "sinq"}`}>
        <span className="q">{f.quien}</span>
        <span className="d">{f.detalle}{etiquetas(f)}</span>
        <span className={`m n ${f.sin_gaveta ? "fuera" : f.efecto >= 0 ? "ent" : "sal"}`}>{f.efecto < 0 ? "−" : ""}{money(f.monto)}</span>
        <span className="s n">{f.efecto ? money(saldo) : ""}</span>
        <span className="x">{botonAnular(f)}</span>
      </div>
    );
  };

  const etiquetas = (f: Fila) => {
    const hoja = f.origen === "hoja";
    const trabajo = hoja && (f.flujo === "maquina" || f.flujo === "transporte") && typeof f.datos.fecha_trabajo === "string" ? f.datos.fecha_trabajo : null;
    return (
      <span className="cjd-tags">
        <span className="cjd-t">{ICONO[f.flujo] ?? f.categoria ?? "otro"}{f.maquina ? ` · ${f.maquina}` : ""}{f.socio ? ` · ${f.socio}` : ""}</span>
        {f.sin_gaveta && <span className="cjd-t ba">{FUERA[f.sin_gaveta] ?? f.sin_gaveta}: no mueve la gaveta</span>}
        {f.reportar && <span className={`cjd-t ${f.reportado_at ? "ok" : "av"}`}>{f.reportado_at ? `✓ reportó ${f.reportar}` : `⏳ por reportar · ${f.reportar}`}</span>}
        {trabajo && <label className="cjd-hizo">📅 se hizo el <input type="date" disabled={!puedeEditar} max={dia.hoy} value={trabajo} onChange={(e) => { void hizo(f, e.target.value); }} /></label>}
        {!hoja && <span className="cjd-tenue">desde otro módulo</span>}
      </span>
    );
  };
  const botonAnular = (f: Fila) => f.origen === "hoja" && puedeAnular && <button type="button" aria-label={`Anular ${f.quien} ${f.detalle}`} title={`Anular${f.por ? ` · lo escribió ${f.por}` : ""}`} onClick={() => { void anular(f); }}>✕</button>;
  const avisoCola = (c: EnCola) => (
    <span className="cjd-tags">{c.estado === "error" ? <>
      <span className="cjd-t av">No se guardó: {c.error}</span>
      <button type="button" className="cjd-link" onClick={() => { cambiar((x) => x.map((y) => (y.id === c.id ? { ...y, estado: "espera" } : y))); void procesar(dia.fecha); }}>Reintentar</button>
      <button type="button" className="cjd-link" onClick={() => { setBloque(c.bloque); setBorradores((s) => ({ ...s, [c.bloque]: c.b })); cambiar((x) => x.filter((y) => y.id !== c.id)); }}>Corregir</button>
    </> : <span className="cjd-tenue">guardando…</span>}</span>
  );
  const pie = <>
    {Math.abs(t.descuadre) > 0.005 && <p className="alertBox">Hay {money(t.descuadre)} que la hoja no explica: avise para revisarlo.</p>}
    {dia.anulados.length > 0 && <details className="cjd-anul"><summary>Anulados de este día ({dia.anulados.length})</summary>{dia.anulados.map((f) => <p key={f.k}><s>{[f.quien, f.detalle].filter(Boolean).join(" · ")} {money(f.monto)}</s> {f.anulado_motivo}</p>)}</details>}
  </>;

  // ── Lo último arriba: el saldo se suma en el orden en que se registró y después se da la vuelta ──
  const ultimo = () => {
    let s = dia.anterior;
    const todas = dia.filas.map((f) => { s = Math.round((s + f.efecto) * 100) / 100; return { f, queda: s }; }).reverse();
    const palabras = norm(busca).split(" ").filter(Boolean);
    const textoDe = (f: Fila) => `${norm([f.quien, f.detalle, ICONO[f.flujo] ?? "", f.categoria, f.maquina, f.socio, f.reportar, f.por].filter(Boolean).join(" "))} ${f.monto.toFixed(2)} ${f.monto.toFixed(2).replace(".", ",")} ${money(f.monto)}`;
    const vistas = todas.filter(({ f }) => (!ver || f.bloque === ver) && palabras.every((w) => textoDe(f).includes(w)));
    const entro = vistas.reduce((x, { f }) => x + Math.max(f.efecto, 0), 0);
    const salio = vistas.reduce((x, { f }) => x + Math.max(-f.efecto, 0), 0);
    const tipos = BLOQUES.map((x) => x.b).filter((b) => b !== "TRANSPORTE" || dia.caja.es_matriz);
    return (
      <div className="cjd-hoja">
        {puedeEditar && (
          <div className="cjd-captura">
            <div className="cjd-tipos" role="radiogroup" aria-label="Tipo de operación">
              {tipos.map((b) => <button key={b} type="button" role="radio" aria-checked={bloque === b} className={`b-${b}`} onClick={() => cambiarBloque(b)}>{CORTO[b]}</button>)}
              <small><kbd>←</kbd> <kbd>→</kbd> tipo · <kbd>Enter</kbd> guarda</small>
            </div>
            {captura(bloque, BLOQUES.find((x) => x.b === bloque)?.que ?? "")}
          </div>
        )}
        <div className="cjh-herr">
          <input className="cjh-busca" type="search" value={busca} placeholder="🔍 Buscar por nombre, detalle o monto" aria-label="Buscar en el día" onChange={(e) => setBusca(e.target.value)} />
          <div className="cjh-seg" role="group" aria-label="Qué ver">
            <button type="button" aria-pressed={!ver} onClick={() => setVer("")}>Todo</button>
            {tipos.map((b) => <button key={b} type="button" aria-pressed={ver === b} onClick={() => setVer(b)}>{b === "INGRESO" ? "⬇ Ingresos" : b === "EGRESO" ? "⬆ Piladora" : "🚜 Transporte"}</button>)}
          </div>
        </div>
        <div className="cjd-scroll" ref={scroll}>
          <div className="cjd-f lista cab"><span /><span>¿Quién o qué?</span><span>¿Qué se hizo?</span><span className="n">Entradas</span><span className="n">Salidas</span><span className="n">Saldo</span><span /></div>
          {[...cola].reverse().map((c) => (
            <div key={c.id} className={`cjd-f lista b-${c.bloque} ${c.estado === "error" ? "err" : "cola"} ${c.b.q ? "" : "sinq"}`}>
              <span className="i">{MARCA[c.bloque]}</span><span className="q">{c.b.q}</span><span className="d">{c.b.d}{avisoCola(c)}</span>
              <span className="m n">{c.bloque === "INGRESO" ? money(cuenta(c.b.m)) : ""}</span><span className="m n">{c.bloque === "INGRESO" ? "" : money(cuenta(c.b.m))}</span><span className="s" /><span className="x" />
            </div>
          ))}
          {vistas.map(({ f, queda }) => {
            const entra = f.efecto ? f.efecto > 0 : f.bloque === "INGRESO";
            return (
              <div key={f.k} className={`cjd-f lista b-${f.bloque} ${f.origen === "hoja" ? "" : "otro"} ${f.quien ? "" : "sinq"} ${nuevos.has(f.k) ? "nuevo" : ""}`}>
                <span className="i" title={CORTO[f.bloque]}>{MARCA[f.bloque]}</span>
                <span className="q">{f.quien}</span>
                <span className="d">{f.detalle}{etiquetas(f)}</span>
                <span className={`m n ${f.sin_gaveta ? "fuera" : "ent"}`}>{entra ? money(f.monto) : ""}</span>
                <span className={`m n ${f.sin_gaveta ? "fuera" : "sal"}`}>{entra ? "" : money(f.monto)}</span>
                <span className="s n">{f.efecto ? money(queda) : ""}</span>
                <span className="x">{botonAnular(f)}</span>
              </div>
            );
          })}
          {vistas.length === 0 && <p className="cjd-nada">{dia.filas.length ? "Nada de este día coincide con lo que buscas." : "Nada todavía en este día."}</p>}
          <div className="cjd-f lista inicial"><span className="i" /><span className="q">Saldo anterior</span><span className="d">con lo que arrancó el día</span><span className="m" /><span className="m" /><span className="s n">{money(dia.anterior)}</span><span className="x" /></div>
        </div>
        <div className="cjd-f lista total"><span className="i" /><span className="q">{ver || palabras.length ? `Solo lo que se ve (${vistas.length})` : "Totales del día"}</span><span className="d" /><span className="m n ent">{money(entro)}</span><span className="m n sal">{money(salio)}</span><span className="s n">{money(t.disponible)}</span><span className="x" /></div>
        {pie}
      </div>
    );
  };

  // ➡️ Lo que esta hoja ya llevó a cada lugar (antes se copiaba a mano).
  const DESTINO: Record<string, string> = { fomento: "🌾 Fomentos", fomento_dev: "🌾 Fomentos", venta: "🛒 Ventas e inventario", transporte: "🚜 Caja de Transporte", operador: "🚜 Caja de Transporte", maquina: "🔧 Hoja de vida de máquinas", nomina: "🗓️ Nómina", cobro: "👤 Cuentas", pago: "👤 Cuentas", agricultor: "👤 Cuentas", socio: "👤 Cuentas", banco: "🏦 Banco" };
  const va = new Map<string, { n: number; t: number }>();
  for (const f of dia.filas) { const k = DESTINO[f.flujo]; if (k) { const x = va.get(k) ?? { n: 0, t: 0 }; va.set(k, { n: x.n + 1, t: x.t + f.monto }); } }

  return (
    <div className="cjd">
      <datalist id="cjd-quienes">{quienes.map((x) => <option key={x} value={x} />)}</datalist>
      <div className="cjd-dia">
        <button type="button" aria-label="Día anterior" disabled={dia.fecha <= dia.caja.abierta} onClick={() => irA(mover(dia.fecha, -1))}>◀</button>
        <div><b>{larga(dia.fecha)}</b><small>{dia.fecha === dia.hoy ? "hoy" : "un día anterior: lo que escribas queda con esta fecha"}</small></div>
        <div className="cjd-vistas" role="group" aria-label="Cómo ver la hoja">
          <button type="button" aria-pressed={vista === "ultimo"} onClick={() => verComo("ultimo")}>⬆ Lo último arriba</button>
          <button type="button" aria-pressed={vista === "bloques"} onClick={() => verComo("bloques")}>📑 Por bloques (como el Excel)</button>
        </div>
        <input type="date" aria-label="Ir a un día" min={dia.caja.abierta} max={dia.hoy} value={dia.fecha} onChange={(e) => { if (e.target.value) irA(e.target.value); }} />
        {dia.fecha !== dia.hoy && <button type="button" className="cjd-hoy" onClick={() => irA("")}>Hoy</button>}
        <button type="button" aria-label="Día siguiente" disabled={dia.fecha >= dia.hoy} onClick={() => irA(mover(dia.fecha, 1))}>▶</button>
      </div>
      <div className="cjd-kpis">
        <div><small>Saldo anterior</small><b>{money(dia.anterior)}</b></div>
        <div><small>Entró</small><b className="ent">{money(t.entro)}</b></div>
        <div><small>Salió</small><b className="sal">{money(t.salio)}</b><span>piladora {money(t.piladora)} · transporte {money(t.transporte)}</span></div>
        <div className="fuerte"><small>Saldo disponible</small><b>{money(t.disponible)}</b><span>solo la gaveta; el banco va aparte</span></div>
      </div>
      <div className="cjd-cuerpo">
        {vista === "ultimo" ? ultimo() : <div className="cjd-hoja">
          <div className="cjd-f cab"><span>¿Quién o qué?</span><span>¿Qué se hizo?</span><span className="n">Monto</span><span className="n">Saldo</span><span /></div>
          {BLOQUES.filter((x) => x.b !== "TRANSPORTE" || dia.caja.es_matriz).map(({ b, titulo, sub, que }) => {
            const filas = dia.filas.filter((f) => f.bloque === b);
            return (
              <section key={b}>
                <h3>{titulo} <small>{sub}</small><b className="n">{money(b === "INGRESO" ? t.ingresos : b === "EGRESO" ? t.piladora : t.transporte)}</b></h3>
                {filas.map(fila)}
                {filas.length === 0 && <p className="cjd-nada">Nada todavía.</p>}
                {cola.filter((c) => c.bloque === b).map((c) => (
                  <div key={c.id} className={`cjd-f ${c.estado === "error" ? "err" : "cola"}`}>
                    <span className="q">{c.b.q}</span>
                    <span className="d">{c.b.d}{avisoCola(c)}</span>
                    <span className="m n">{money(cuenta(c.b.m))}</span><span /><span />
                  </div>
                ))}
                {puedeEditar && captura(b, que)}
              </section>
            );
          })}
          <div className="cjd-fin"><span>Saldo disponible (mañana arranca con esto)</span><b>{money(t.disponible)}</b></div>
          {pie}
        </div>}
        <aside className="cjd-lado">
          {dia.caja.tipo !== "BANCO" && <Conteo key={dia.fecha} dia={dia} puede={puedeEditar} onGuardar={async (lineas, apartado) => {
            try { await apiPut(`/cash/dia/${cajaId}/conteo`, { fecha: dia.fecha, lineas, apartado }); await cargar(dia.fecha); avisar("Conteo anotado", "success"); } catch (e) { avisar(e instanceof Error ? e.message : "No se pudo guardar", "error"); }
          }} />}
          {dia.por_reportar.length > 0 && <div className="cjd-card"><h4>⏳ Falta que reporten</h4>{dia.por_reportar.map((x) => (
            <div key={x.id} className="cjd-rep"><span><b>{x.reportar}</b> {money(x.monto)}<small>{corta(x.fecha)} · {[x.quien, x.detalle].filter(Boolean).join(" · ")}</small></span>{puedeEditar && <button type="button" onClick={() => { void reporto(x.id); }}>Ya reportó</button>}</div>
          ))}</div>}
          <div className="cjd-card"><h4>➡️ Se fue solo</h4>{va.size === 0 ? <p className="muted">Lo que escribas aquí llega solo a fomentos, Transporte, máquinas, nómina y cuentas.</p>
            : [...va].map(([k, x]) => <div key={k} className="cjd-va"><span>{k}</span><b>{x.n} · {money(x.t)}</b></div>)}</div>
        </aside>
      </div>
    </div>
  );
}

// 🧮 Conteo «13*20»: se anota con su diferencia, no mueve el saldo.
function Conteo({ dia, puede, onGuardar }: { dia: Dia; puede: boolean; onGuardar: (lineas: string[], apartado: string) => Promise<void> }) {
  const [lineas, setLineas] = useState<string[]>(dia.conteo?.lineas.length ? [...dia.conteo.lineas, ""] : ["", "", "", ""]);
  const [apartado, setApartado] = useState(dia.conteo?.apartado ?? "");
  const [busy, setBusy] = useState(false);
  const fisico = Math.round((lineas.reduce((s, x) => s + cuenta(x), 0) - cuenta(apartado)) * 100) / 100;
  const dif = Math.round((fisico - dia.totales.disponible) * 100) / 100;
  const hay = lineas.some((x) => x.trim());
  return (
    <div className="cjd-card">
      <h4>🧮 Cuadre del día</h4>
      <p className="muted">Como en su Excel: <b>13*20</b> son trece billetes de 20.</p>
      {lineas.map((x, i) => <div key={i} className="cjd-cta"><input value={x} disabled={!puede} inputMode="text" aria-label={`Conteo ${i + 1}`} onChange={(e) => setLineas((l) => { const n = l.map((y, k) => (k === i ? e.target.value : y)); return n[n.length - 1].trim() ? [...n, ""] : n; })} /><span>{cuenta(x) ? money(cuenta(x)) : ""}</span></div>)}
      <div className="cjd-cta"><input value={apartado} disabled={!puede} placeholder="apartado: anotado y no entregado" aria-label="Apartado" onChange={(e) => setApartado(e.target.value)} /><span>{cuenta(apartado) ? `−${money(cuenta(apartado))}` : ""}</span></div>
      {hay && <>
        <div className="cjd-va"><span>Físico</span><b>{money(fisico)}</b></div>
        <div className="cjd-va"><span>Saldo disponible</span><b>{money(dia.totales.disponible)}</b></div>
        <div className={`cjd-dif ${Math.abs(dif) < 0.005 ? "ok" : dif < 0 ? "falta" : "sobra"}`}><span>{Math.abs(dif) < 0.005 ? "✓ Cuadra" : dif < 0 ? "Faltante" : "Sobrante"}</span><b>{money(Math.abs(dif))}</b></div>
      </>}
      {puede && <button type="button" className="cjd-btn" disabled={!hay || busy} onClick={() => { setBusy(true); onGuardar(lineas.map((x) => x.trim()).filter(Boolean), apartado.trim()).finally(() => setBusy(false)); }}>Anotar el conteo</button>}
      <p className="muted">Queda anotado, pero no mueve el saldo: mañana se arranca con {money(dia.totales.disponible)}.</p>
    </div>
  );
}
