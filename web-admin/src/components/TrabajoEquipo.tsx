// 🔧 TRABAJO EN UN EQUIPO, en un solo flujo (Caja → «Registrar trabajo o repuesto»).
// Reemplaza los formularios separados de Mantenimiento, Compra de repuestos y Materiales consumibles:
//  1) ¿En qué equipo? (o «sin equipo · va a la bodega»)
//  2) ¿Qué se hizo? reparación · mantenimiento · compra de repuesto
//  3) ¿Quién lo hizo? nuestro personal (sin mano de obra; puede haber un pago aparte) o de afuera (mano de obra)
//  4) Lo que se usó: repuestos de bodega (no mueven caja), repuestos comprados e insumos
//  5) ¿Quién compró y cómo se pagó? caja · lo compró el técnico (un solo pago) · fondo a rendir · a crédito
//  6) Resumen: cuánto sale de caja y qué queda en la hoja de vida del equipo.
// Guarda con /equipment/maintenance (hoja de vida + caja o Por Pagar); «sin equipo» con /repuestos/compra.
// 🚜 Máquinas de Transporte y Cosechadora: la plata sale de esta caja (Matriz) pero el gasto es de Transporte;
// se descuenta de lo que la Matriz le debe y el resto queda por cobrarle (/equipment/transporte/gasto).
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api";
import { money } from "../format";
import type { Repuesto } from "./RepuestosModule";

type Equipo = { area: string; section: string; activoId?: string };
type Tipo = "REPARACION" | "MANTENIMIENTO" | "COMPRA";
type Quien = "PROPIO" | "EXTERNO";
type Pago = "CAJA" | "TECNICO" | "FONDO" | "CREDITO";
type Item = { key: string; nombre: string; k: "BODEGA" | "REPUESTO" | "INSUMO"; repuesto_id?: string; cant: string; costo: string; stock?: number };

const INSUMOS_SUGERIDOS = ["Soldadura", "Electrodos", "Pernos", "Tuercas", "Grasa", "Aceite", "Lija", "Thinner", "Pintura", "Cinta aislante", "Silicón", "Abrazaderas"];
const sinTildes = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string) => Number(v) || 0;

export function TrabajoEquipo({ equipos, maquinasTransporte = [], repuestos, tecnicos, personal, proveedores, registerId, inicial, fondosPorLiquidar, onGuardado, onError }: {
  equipos: Equipo[];
  /** Máquinas de Transporte y Cosechadora (cosechadoras, plataforma, Toyota…): su gasto es de Transporte. */
  maquinasTransporte?: Array<{ id: string; nombre: string; tipo?: string }>;
  repuestos: Repuesto[];
  /** Técnicos o talleres usados antes (más recientes primero). */
  tecnicos: string[];
  /** Personal propio sugerido (pilador, cuadrilla…). */
  personal: string[];
  proveedores: Array<{ id: string; name: string }>;
  registerId: string | null;
  inicial?: { area?: string; section?: string; tipo?: Tipo };
  fondosPorLiquidar: number;
  onGuardado: (mensaje: string) => Promise<void> | void;
  onError: (mensaje: string) => void;
}) {
  const [eq, setEq] = useState<Equipo | "BODEGA" | null>(inicial?.area && inicial.section ? { area: inicial.area, section: inicial.section } : null);
  const [qEq, setQEq] = useState("");
  // Primero la MÁQUINA (área: Montacarga, Piladora…) y luego su parte: así el cajero solo ve lo de esa máquina
  // (pedido del dueño 2026-10-22). Escribiendo se busca en todo.
  const [areaEq, setAreaEq] = useState<string | null>(null);
  const [tipo, setTipo] = useState<Tipo | null>(inicial?.tipo ?? null);
  const [quien, setQuien] = useState<Quien | null>(null);
  const [nom, setNom] = useState("");
  const [mo, setMo] = useState("");
  const [extra, setExtra] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [qItem, setQItem] = useState("");
  const [comprador, setComprador] = useState("");
  const [pago, setPago] = useState<Pago | null>(null);
  const [proveedor, setProveedor] = useState("");
  const [vence, setVence] = useState("");
  const [destino, setDestino] = useState<"USO" | "INVENTARIO">("USO");
  const [det, setDet] = useState("");
  const [factura, setFactura] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const esBodega = eq === "BODEGA";
  const esTransporte = !!(eq && eq !== "BODEGA" && eq.activoId);
  // Cuánto le debe hoy la Matriz a Transporte (se descuenta del gasto) — solo con una máquina de Transporte.
  const [cuentasT, setCuentasT] = useState<{ debe: number; le_deben: number } | null>(null);
  useEffect(() => {
    if (!esTransporte) { setCuentasT(null); return; }
    apiGet<{ debe: number; le_deben: number }>("/equipment/transporte/cuentas-matriz").then(setCuentasT).catch(() => setCuentasT(null));
  }, [esTransporte]);
  const esCompra = tipo === "COMPRA";
  const comprados = items.filter((i) => i.k !== "BODEGA");
  const totComprados = r2(comprados.reduce((s, i) => s + num(i.cant) * num(i.costo), 0));
  const totBodega = r2(items.filter((i) => i.k === "BODEGA").reduce((s, i) => s + num(i.cant) * num(i.costo), 0));
  const manoObra = esCompra || esBodega ? 0 : quien === "EXTERNO" ? num(mo) : num(extra);
  const totalPagar = r2(manoObra + totComprados);
  const cajaAhora = pago === "CREDITO" ? 0 : totalPagar;
  const equipoTxt = esBodega ? "la bodega de repuestos" : eq ? `${eq.area} · ${eq.section}` : "";

  // ── 1) Equipos que coinciden con lo escrito ──
  const todosEquipos = useMemo<Equipo[]>(() => [
    ...equipos,
    ...maquinasTransporte.map((m) => ({ area: "TRANSPORTE", section: m.nombre, activoId: m.id }))
  ], [equipos, maquinasTransporte]);
  const equiposVisibles = useMemo(() => {
    const tk = sinTildes(qEq.trim()).split(/\s+/).filter(Boolean);
    const extra = (e: Equipo) => e.activoId ? `transporte cosechadora ${maquinasTransporte.find((m) => m.id === e.activoId)?.tipo ?? ""}` : "";
    return todosEquipos
      .filter((e) => !areaEq || e.area === areaEq)
      .filter((e) => tk.every((k) => sinTildes(`${e.area} ${e.section} ${extra(e)}`).includes(k)))
      .slice(0, tk.length || areaEq ? 60 : 16);
  }, [todosEquipos, qEq, maquinasTransporte, areaEq]);
  const areasEq = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of todosEquipos) m.set(e.area, (m.get(e.area) ?? 0) + 1);
    return [...m.entries()].map(([area, n]) => ({ area, n }));
  }, [todosEquipos]);
  const verAreas = !areaEq && !qEq.trim();

  // ── 4) Lo que se puede agregar según lo escrito ──
  const sugerencias = useMemo(() => {
    const t = sinTildes(qItem.trim());
    const tk = t.split(/\s+/).filter(Boolean);
    const coincide = (n: string) => tk.every((k) => sinTildes(n).includes(k));
    const out: Array<{ key: string; titulo: string; detalle: string; item: Omit<Item, "key" | "cant"> & { cant?: string } }> = [];
    const activos = repuestos.filter((r) => r.activo !== false && coincide(`${r.nombre} ${r.referencia ?? ""} ${r.equipo ?? ""}`));
    if (!esCompra && !esBodega && !esTransporte) {
      for (const r of activos.filter((x) => Number(x.stock) > 0).slice(0, 6)) {
        out.push({ key: `b-${r.id}`, titulo: r.nombre, detalle: `de la bodega · hay ${Number(r.stock)}`, item: { nombre: r.nombre, k: "BODEGA", repuesto_id: r.id, costo: String(Number(r.costo_unitario) || 0), stock: Number(r.stock) } });
      }
    }
    for (const r of activos.slice(0, 6)) {
      out.push({ key: `r-${r.id}`, titulo: r.nombre, detalle: `comprado ahora${Number(r.costo_unitario) > 0 ? ` · último ${money(Number(r.costo_unitario))}` : ""}`, item: { nombre: r.nombre, k: "REPUESTO", repuesto_id: r.id, costo: Number(r.costo_unitario) > 0 ? String(Number(r.costo_unitario)) : "" } });
    }
    if (!esCompra && !esBodega) {
      for (const n of INSUMOS_SUGERIDOS.filter((x) => !tk.length || coincide(x)).slice(0, tk.length ? 6 : 8)) {
        out.push({ key: `i-${n}`, titulo: n, detalle: "insumo comprado", item: { nombre: n, k: "INSUMO", costo: "" } });
      }
    }
    if (qItem.trim().length >= 2) {
      const txt = qItem.trim();
      if (!repuestos.some((r) => sinTildes(r.nombre) === t)) out.push({ key: "nuevo-r", titulo: `➕ «${txt}»`, detalle: "repuesto nuevo comprado", item: { nombre: txt, k: "REPUESTO", costo: "" } });
      if (!esCompra && !esBodega && !INSUMOS_SUGERIDOS.some((x) => sinTildes(x) === t)) out.push({ key: "nuevo-i", titulo: `➕ «${txt}»`, detalle: "insumo comprado", item: { nombre: txt, k: "INSUMO", costo: "" } });
    }
    return out.slice(0, 14);
  }, [qItem, repuestos, esCompra, esBodega, esTransporte]);

  const agregar = (it: Omit<Item, "key" | "cant"> & { cant?: string }) => {
    setErr("");
    setItems((cur) => {
      const ya = cur.find((x) => x.k === it.k && x.nombre === it.nombre);
      if (ya) return cur.map((x) => (x === ya ? { ...x, cant: String(num(x.cant) + 1) } : x));
      return [...cur, { ...it, key: `${it.k}-${it.nombre}-${Date.now()}`, cant: it.cant ?? "1" }];
    });
    setQItem("");
  };
  const cambiar = (key: string, p: Partial<Item>) => { setErr(""); setItems((cur) => cur.map((x) => (x.key === key ? { ...x, ...p } : x))); };
  const quitar = (key: string) => setItems((cur) => cur.filter((x) => x.key !== key));

  const elegirEquipo = (e: Equipo | "BODEGA") => {
    setEq(e); setQEq(""); setErr("");
    if (e === "BODEGA") { setTipo("COMPRA"); setDestino("INVENTARIO"); setItems((cur) => cur.filter((i) => i.k === "REPUESTO")); }
  };
  const elegirTipo = (t: Tipo) => {
    setTipo(t); setErr("");
    if (t === "COMPRA") { setItems((cur) => cur.filter((i) => i.k === "REPUESTO")); setQuien(null); }
  };

  const necesitaPago = totalPagar > 0.004;
  const pasoQuien = !esCompra && !esBodega;
  const listoQuien = !pasoQuien || !!quien;

  async function guardar() {
    setErr("");
    if (!registerId) { setErr("No hay caja abierta."); return; }
    if (!eq || !tipo) { setErr("Elige el equipo y qué se hizo."); return; }
    if (pasoQuien && !quien) { setErr("Elige quién hizo el trabajo."); return; }
    if (pasoQuien && quien === "EXTERNO" && nom.trim().length < 2) { setErr("Escribe el nombre del técnico o taller."); return; }
    if ((esCompra || esBodega) && comprados.length === 0) { setErr("Agrega el repuesto que se compró."); return; }
    if (items.some((i) => !(num(i.cant) > 0))) { setErr("Cada cosa necesita una cantidad mayor a 0."); return; }
    if (comprados.some((i) => !(num(i.costo) > 0))) { setErr("Pon el precio de lo que se compró."); return; }
    if (items.some((i) => i.k === "BODEGA" && i.stock !== undefined && num(i.cant) > i.stock)) { setErr("Estás usando más de lo que hay en la bodega."); return; }
    if (necesitaPago && !pago) { setErr("Elige cómo se pagó."); return; }
    if (pago === "CREDITO" && proveedor.trim().length < 2) { setErr("Escribe el proveedor que dio el crédito."); return; }
    if (pago === "FONDO" && (comprador.trim() || nom.trim()).length < 2) { setErr("Escribe a quién se le entrega la plata."); return; }
    const provSel = proveedor.trim() ? proveedores.find((p) => p.name.trim().toLowerCase() === proveedor.trim().toLowerCase()) : undefined;
    const credito = pago === "CREDITO" ? {
      pago: "CREDITO" as const,
      supplier_id: provSel?.id,
      proveedor_nombre: provSel ? undefined : proveedor.trim(),
      due_date: vence || undefined
    } : {};
    const tipoTxt = tipo === "REPARACION" ? "Reparación" : tipo === "MANTENIMIENTO" ? "Mantenimiento" : "Compra de repuesto";
    const descripcion = det.trim() || `${tipoTxt}${items.length ? `: ${items.map((i) => i.nombre).join(", ")}` : ""}`;
    setBusy(true);
    try {
      if (esTransporte) {
        const r = await apiPost<{ total: number; descontado: number; por_cobrar: number; maquina: string }>("/equipment/transporte/gasto", {
          cash_register_id: registerId,
          activo_id: (eq as Equipo).activoId,
          maintenance_type: tipo === "REPARACION" ? "CORRECTIVO" : tipo === "MANTENIMIENTO" ? "PREVENTIVO" : "REPUESTO",
          description: descripcion,
          provider: pasoQuien ? nom.trim() || undefined : undefined,
          hecho_por_tipo: pasoQuien ? quien ?? undefined : undefined,
          comprado_por: (pago === "TECNICO" ? nom.trim() : comprador.trim()) || undefined,
          invoice_number: factura.trim() || undefined,
          mano_obra: manoObra,
          items: comprados.map((i) => ({ nombre: i.nombre, cantidad: r2(num(i.cant)), costo_unitario: r2(num(i.costo)), tipo: i.k === "INSUMO" ? "INSUMO" : "REPUESTO" }))
        });
        await onGuardado(`🚜 ${tipoTxt} en ${r.maquina} (Transporte): salió ${money(r.total)} de caja` +
          (r.descontado > 0 ? ` · se descontaron ${money(r.descontado)} de lo que se le debía a Transporte` : "") +
          (r.por_cobrar > 0 ? ` · quedan ${money(r.por_cobrar)} por cobrar a Transporte` : ""));
        return;
      }
      if (esBodega) {
        const r = await apiPost<{ total: number; credito: boolean }>("/repuestos/compra", {
          cash_register_id: registerId,
          modalidad_pago: pago === "CREDITO" ? "CREDITO" : "CONTADO",
          supplier_id: pago === "CREDITO" ? provSel?.id : undefined,
          proveedor_nombre: pago === "CREDITO" && !provSel ? proveedor.trim() : undefined,
          due_date: pago === "CREDITO" && vence ? vence : undefined,
          descripcion: [det.trim(), factura.trim() ? `Factura ${factura.trim()}` : "", comprador.trim() ? `Compró ${comprador.trim()}` : ""].filter(Boolean).join(" · ") || undefined,
          uso_inmediato: false,
          items: comprados.map((i) => ({
            repuesto_id: i.repuesto_id,
            nuevo: i.repuesto_id ? undefined : { nombre: i.nombre, referencia: null, unidad: "UNIDAD", stock_minimo: 0 },
            cantidad: r2(num(i.cant)), costo_unitario: r2(num(i.costo))
          }))
        });
        await onGuardado(r.credito ? `💳 Repuestos a crédito a bodega por ${money(r.total)} (Por Pagar)` : `📦 ${money(r.total)} en repuestos entraron a la bodega`);
        return;
      }
      await apiPost("/equipment/maintenance", {
        area: (eq as Equipo).area,
        section: (eq as Equipo).section,
        maintenance_type: tipo === "REPARACION" ? "CORRECTIVO" : tipo === "MANTENIMIENTO" ? "PREVENTIVO" : "REPUESTO",
        description: descripcion,
        provider: pasoQuien ? nom.trim() || undefined : undefined,
        invoice_number: factura.trim() || undefined,
        amount: totalPagar,
        cash_register_id: registerId,
        repuestos_usados: items.filter((i) => i.k === "BODEGA").map((i) => ({ repuesto_id: i.repuesto_id, cantidad: r2(num(i.cant)) })),
        repuestos_comprados: comprados.map((i) => ({
          repuesto_id: i.repuesto_id, nombre: i.nombre, cantidad: r2(num(i.cant)), costo_unitario: r2(num(i.costo)),
          destino: esCompra && destino === "INVENTARIO" && i.k === "REPUESTO" ? "INVENTARIO" : "USO",
          tipo: i.k === "INSUMO" ? "INSUMO" : "REPUESTO"
        })),
        hecho_por_tipo: pasoQuien ? quien : undefined,
        comprado_por: (pago === "TECNICO" ? nom.trim() : comprador.trim()) || undefined,
        registro_equipo: true,
        es_fondo: pago === "FONDO" || undefined,
        responsable: pago === "FONDO" ? (comprador.trim() || nom.trim()) : undefined,
        ...credito
      });
      const partes = [
        cajaAhora > 0 ? `salió ${money(cajaAhora)} de caja${pago === "FONDO" ? " (fondo por rendir)" : ""}` : "",
        pago === "CREDITO" && totalPagar > 0 ? `${money(totalPagar)} quedó en Por Pagar a ${proveedor.trim()}` : "",
        totBodega > 0 ? `${money(totBodega)} en repuestos de bodega` : ""
      ].filter(Boolean);
      await onGuardado(`🔧 ${tipoTxt} en ${equipoTxt} guardada en su hoja de vida${partes.length ? ` · ${partes.join(" · ")}` : " · no salió dinero"}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : "No se pudo guardar";
      setErr(m); onError(m);
    } finally { setBusy(false); }
  }

  const opt = (on: boolean, onClick: () => void, titulo: string, ayuda: string) => (
    <button type="button" className={`teq-opt ${on ? "is-on" : ""}`} onClick={onClick}>
      <b>{titulo}</b><small>{ayuda}</small>
    </button>
  );
  let n = 1;

  return (
    <div className="teq">
      {/* 1 · Equipo */}
      <section className="teq-paso">
        <div className="teq-paso__t"><i>{n++}</i>¿En qué equipo?</div>
        {eq ? (
          <div className="teq-sel">
            <span>🔧 <b>{esBodega ? "Sin equipo · va a la bodega" : `${(eq as Equipo).area} · ${(eq as Equipo).section}`}</b>
              {!esBodega && /montacarga/i.test((eq as Equipo).area) && <small> · rubro Montacarga</small>}
              {esTransporte && <small> · 🚜 es de Transporte y Cosechadora</small>}</span>
            <button type="button" className="btnGhost" onClick={() => { setEq(null); setErr(""); setQEq(""); setAreaEq(eq !== "BODEGA" ? (eq as Equipo).area : null); }}>Cambiar</button>
          </div>
        ) : (
          <>
            <input type="search" className="teq-input" autoFocus value={qEq} onChange={(e) => setQEq(e.target.value)}
              placeholder={areaEq ? `Buscar en ${areaEq}: motor, batería, llantas…` : "Elige la máquina o escribe: cilindro, motor, batería…"}
              onKeyDown={(e) => { if (e.key === "Enter" && !verAreas && equiposVisibles[0]) { e.preventDefault(); elegirEquipo(equiposVisibles[0]); } }} />
            {areaEq && (
              <div className="teq-area">
                <b>{areaEq === "TRANSPORTE" ? "🚜 " : "🔧 "}{areaEq}</b><span>· ¿qué parte?</span>
                <button type="button" className="btnGhost" onClick={() => { setAreaEq(null); setQEq(""); }}>← Otra máquina</button>
              </div>
            )}
            <div className="teq-chips">
              {verAreas ? areasEq.map(({ area, n }) => (
                <button key={area} type="button" className={`teq-chip--area ${area === "TRANSPORTE" ? "teq-chip--tr" : ""}`} onClick={() => setAreaEq(area)}>
                  {area === "TRANSPORTE" ? "🚜 " : "🔧 "}{area} <small>{n}</small>
                </button>
              )) : equiposVisibles.map((e) => (
                <button key={`${e.area}|${e.section}|${e.activoId ?? ""}`} type="button" className={e.activoId ? "teq-chip--tr" : ""} onClick={() => elegirEquipo(e)}>
                  {e.activoId ? "🚜 " : ""}{areaEq ? e.section : `${e.area} · ${e.section}`}
                </button>
              ))}
              {!areaEq && <button type="button" className="teq-chip--alt" onClick={() => elegirEquipo("BODEGA")}>📦 Sin equipo · va a la bodega</button>}
            </div>
            {equiposVisibles.length === 0 && <small className="muted">No hay equipos con esas palabras. Se crean en Configuración → Categorías de mantenimiento.</small>}
          </>
        )}
      </section>

      {/* 2 · Qué se hizo */}
      {eq && (
        <section className="teq-paso">
          <div className="teq-paso__t"><i>{n++}</i>¿Qué se hizo?</div>
          {esBodega ? <small className="muted">Compra de repuestos para guardar en la bodega.</small> : (
            <div className="teq-opts">
              {opt(tipo === "REPARACION", () => elegirTipo("REPARACION"), "🔨 Reparación", "Algo se dañó y se arregló")}
              {opt(tipo === "MANTENIMIENTO", () => elegirTipo("MANTENIMIENTO"), "⚙️ Mantenimiento", "Preventivo: aceite, limpieza, ajuste")}
              {opt(tipo === "COMPRA", () => elegirTipo("COMPRA"), "🛒 Compra de repuesto", "Solo se compró la pieza")}
            </div>
          )}
        </section>
      )}

      {/* 3 · Quién lo hizo */}
      {eq && tipo && pasoQuien && (
        <section className="teq-paso">
          <div className="teq-paso__t"><i>{n++}</i>¿Quién lo hizo?</div>
          <div className="teq-opts">
            {opt(quien === "PROPIO", () => { if (quien !== "PROPIO") { setQuien("PROPIO"); setNom(""); if (pago === "TECNICO") setPago(null); } }, "👷 Nuestro personal", "Pilador o cuadrilla: no cobra aparte")}
            {opt(quien === "EXTERNO", () => { if (quien !== "EXTERNO") { setQuien("EXTERNO"); setNom(""); } }, "🧑‍🔧 Técnico o taller de afuera", "Se le paga la mano de obra")}
          </div>
          {quien && (
            <>
              <div className="teq-fila">
                <label><span>{quien === "PROPIO" ? "¿Quién?" : "Nombre del técnico o taller"}</span>
                  <input value={nom} onChange={(e) => { setNom(e.target.value); setErr(""); }} placeholder={quien === "PROPIO" ? "Pilador" : "Jacobo"} /></label>
                {quien === "EXTERNO" ? (
                  <label><span>¿Cuánto cobró de mano de obra? $</span>
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={mo} onChange={(e) => { setMo(e.target.value); setErr(""); }} placeholder="0.00" /></label>
                ) : (
                  <label><span>¿Se le pagó algo aparte? $ <small>(opcional)</small></span>
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={extra} onChange={(e) => { setExtra(e.target.value); setErr(""); }} placeholder="0.00" /></label>
                )}
              </div>
              {(quien === "PROPIO" ? personal : tecnicos).length > 0 && (
                <div className="teq-chips">
                  {(quien === "PROPIO" ? personal : tecnicos).slice(0, 6).map((x) => <button key={x} type="button" onClick={() => setNom(x)}>{x}</button>)}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* 4 · Lo que se usó / compró */}
      {eq && tipo && listoQuien && (
        <section className="teq-paso">
          <div className="teq-paso__t"><i>{n++}</i>{esCompra || esBodega ? "¿Qué repuesto se compró?" : "Lo que se usó en el trabajo"} <small className="muted">{esCompra || esBodega ? "" : "(opcional)"}</small></div>
          {items.map((i) => (
            <div key={i.key} className="teq-item">
              <span className="teq-item__n">{i.nombre}
                <em className={`teq-tag teq-tag--${i.k.toLowerCase()}`}>{i.k === "BODEGA" ? "de bodega" : i.k === "INSUMO" ? "insumo" : "comprado"}</em></span>
              <span className="teq-item__v">
                <input type="number" min="0" step="1" inputMode="decimal" aria-label="Cantidad" value={i.cant} onChange={(e) => cambiar(i.key, { cant: e.target.value })} />
                <span>×</span>
                {i.k === "BODEGA" ? <span className="muted">{money(num(i.costo))}</span>
                  : <input type="number" min="0" step="0.01" inputMode="decimal" aria-label="Precio unitario" placeholder="$ c/u" value={i.costo} onChange={(e) => cambiar(i.key, { costo: e.target.value })} />}
                <b>{money(num(i.cant) * num(i.costo))}</b>
                <button type="button" className="btnGhost" aria-label="Quitar" onClick={() => quitar(i.key)}>✕</button>
              </span>
            </div>
          ))}
          <input type="search" className="teq-input" value={qItem} onChange={(e) => setQItem(e.target.value)}
            placeholder={esCompra || esBodega ? "Busca el repuesto o escribe uno nuevo" : "Busca un repuesto o insumo: rodamiento, banda, soldadura, pernos…"}
            onKeyDown={(e) => { if (e.key === "Enter" && sugerencias[0]) { e.preventDefault(); agregar(sugerencias[0].item); } }} />
          <div className="teq-sug">
            {sugerencias.map((s) => (
              <button key={s.key} type="button" onClick={() => agregar(s.item)}>
                <span>{s.titulo}</span><small>{s.detalle}</small>
              </button>
            ))}
          </div>
          {esCompra && !esBodega && !esTransporte && comprados.length > 0 && (
            <div className="teq-opts">
              {opt(destino === "USO", () => setDestino("USO"), "✅ Ya se instaló", `En ${equipoTxt}`)}
              {opt(destino === "INVENTARIO", () => setDestino("INVENTARIO"), "📦 Se guarda en bodega", "Queda para cuando se necesite")}
            </div>
          )}
        </section>
      )}

      {/* 5 · Quién compró y cómo se pagó */}
      {eq && tipo && listoQuien && necesitaPago && (
        <section className="teq-paso">
          <div className="teq-paso__t"><i>{n++}</i>{comprados.length ? "¿Quién compró y cómo se pagó?" : "¿Cómo se pagó?"}</div>
          {comprados.length > 0 && (
            <div className="teq-fila">
              <label><span>¿Quién fue a comprar? <small>(opcional)</small></span>
                <input value={pago === "TECNICO" ? nom : comprador} disabled={pago === "TECNICO"} onChange={(e) => setComprador(e.target.value)} placeholder="Nombre" /></label>
              <label><span>N.º de factura <small>(opcional)</small></span>
                <input value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="001-001-123" /></label>
            </div>
          )}
          <div className="teq-opts">
            {opt(pago === "CAJA", () => setPago("CAJA"), "💵 De la caja ahora", "Sale hoy de la gaveta")}
            {quien === "EXTERNO" && comprados.length > 0 && !esCompra && opt(pago === "TECNICO", () => setPago("TECNICO"), "🧑‍🔧 Lo compró el técnico", "Se le paga todo junto con su mano de obra")}
            {!esBodega && !esTransporte && !(esCompra && destino === "INVENTARIO") && opt(pago === "FONDO", () => setPago("FONDO"), "👛 Se le da plata y luego rinde cuentas", "Fondo a rendir: después registra el vuelto")}
            {!esTransporte && opt(pago === "CREDITO", () => setPago("CREDITO"), "🧾 A crédito", "Queda en Por Pagar al proveedor")}
          </div>
          {pago === "CREDITO" && (
            <div className="teq-fila">
              <label><span>Proveedor</span>
                <input list="teqProveedores" value={proveedor} onChange={(e) => { setProveedor(e.target.value); setErr(""); }} placeholder="Ferretería Ortiz" />
                <datalist id="teqProveedores">{proveedores.map((p) => <option key={p.id} value={p.name} />)}</datalist></label>
              <label><span>Vence <small>(opcional)</small></span><input type="date" value={vence} onChange={(e) => setVence(e.target.value)} /></label>
            </div>
          )}
          {pago === "FONDO" && <small className="muted">Queda «⏳ Por liquidar». Cuando vuelva con las facturas, usa «💸 Liquidar» en Movimientos.</small>}
          {fondosPorLiquidar > 0 && pago !== "FONDO" && (
            <small className="muted">¿Ya se le había dado plata antes para esto? Regístralo desde «💸 Liquidar» de ese fondo en Movimientos ({fondosPorLiquidar} por liquidar).</small>
          )}
        </section>
      )}

      {/* 6 · Resumen */}
      {eq && tipo && listoQuien && (
        <section className="teq-paso">
          <div className="teq-paso__t"><i>{n++}</i>Resumen</div>
          <label className="teq-det"><span>Detalle <small>(opcional)</small></span>
            <input value={det} onChange={(e) => setDet(e.target.value)} placeholder={esCompra || esBodega ? "Para el cambio del próximo mes" : "Se cambió el rodamiento y se soldó la base"} /></label>
          <div className="teq-res">
            <div className="teq-res__f"><span>Sale de caja ahora</span><b className={cajaAhora > 0 ? "cj-neg" : ""}>{cajaAhora > 0 ? `−${money(cajaAhora)}` : "$0.00"}</b></div>
            {manoObra > 0 && <div className="teq-res__s"><span>{quien === "EXTERNO" ? "Mano de obra" : "Pago aparte"}</span><span>{money(manoObra)}</span></div>}
            {totComprados > 0 && <div className="teq-res__s"><span>Lo comprado</span><span>{money(totComprados)}</span></div>}
            {pago === "CREDITO" && totalPagar > 0 && <div className="teq-res__f"><span>Queda en Por Pagar a {proveedor.trim() || "el proveedor"}</span><b>{money(totalPagar)}</b></div>}
            {totBodega > 0 && <div className="teq-res__f"><span>Repuestos de bodega (no mueve caja)</span><b>{money(totBodega)}</b></div>}
            {!esBodega && <div className="teq-res__f teq-res__t"><span>Costo del trabajo en {equipoTxt}</span><b>{money(totalPagar + totBodega)}</b></div>}
            {esTransporte && totalPagar > 0 && (() => {
              const debe = cuentasT?.debe ?? 0;
              const desc = r2(Math.min(debe, totalPagar));
              const porCobrar = r2(totalPagar - desc);
              return (
                <div className="teq-tr">
                  <b>🚜 Es gasto de Transporte y Cosechadora</b>
                  <span>La plata sale de esta caja, pero no es costo de la piladora.</span>
                  {cuentasT === null ? <span className="muted">Revisando cuánto se le debe a Transporte…</span> : (
                    <>
                      {debe > 0 ? <span>Hoy se le debe a Transporte {money(debe)} → se descuentan <b>{money(desc)}</b>.</span> : <span>Hoy no se le debe nada a Transporte.</span>}
                      {porCobrar > 0 && <span>Quedan <b>{money(porCobrar)}</b> por cobrar a Transporte (Por Cobrar).</span>}
                    </>
                  )}
                </div>
              );
            })()}
            <small className="muted">{esBodega ? "Los repuestos entran a la bodega con su precio." : `Queda en la hoja de vida de ${equipoTxt}${esTransporte ? " en Transporte" : ""}${nom.trim() && pasoQuien ? `, hecho por ${nom.trim()}` : ""}.`}</small>
          </div>
          {err && <div className="teq-err">{err}</div>}
          <button type="button" className="primary teq-guardar" disabled={busy} onClick={() => guardar()}>
            {busy ? "Guardando…" : !necesitaPago && !esBodega ? "Guardar en la hoja de vida (no sale dinero)" : pago === "CREDITO" ? "Guardar (a crédito)" : "Guardar"}
          </button>
        </section>
      )}
      {err && !(eq && tipo && listoQuien) && <div className="teq-err">{err}</div>}
    </div>
  );
}
