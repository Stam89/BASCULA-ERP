// Inventario de SACOS por MARCA y PESO (bodega única de la Matriz).
//  · SacosTablero: vista profesional (resumen + matriz marca × peso + alertas).
//  · SacosCatalogoConfig: alta / edición / eliminación de sacos (Configuración).
//  · SacosAlertaDashboard: aviso cuando un saco llega a su stock mínimo.
// Reglas: los sacos se descuentan al VENDER (Confirmar Preparación del pedido) y
// en Servicios de Pilada con sacos de la planta. El stock mínimo lo fija el
// usuario; el stock solo cambia con compras, ventas y movimientos (kárdex).
import { useMemo, useState, type FormEvent } from "react";
import { apiFetch, apiPatch, apiPost } from "../api";

export type Saco = {
  id: string;
  tipo: string;
  stock: number | string;
  categoria?: "MARCA" | "SUBPRODUCTO" | "GENERICO" | "PROPIO" | string;
  marca?: string | null;
  calidad?: string | null;
  peso_lb?: number | string | null;
  product_id?: string | null;
  stock_minimo?: number | string;
  precio_compra_default?: number | string | null;
  precio_venta_cliente?: number | string;
  activo?: boolean;
  bajo_minimo?: boolean;
  updated_at?: string;
};

type Estado = "NEGATIVO" | "BAJO" | "SIN_STOCK" | "OK";

/**
 * Plan de empaque (MISMA regla que el backend, services/sacos.ts): cada bulto va
 * en el saco más pequeño registrado donde cabe y el sobrante en el más pequeño
 * que lo contiene. 10 QQ en 50 LB → 20 × 100 LB; 100 QQ en 98 LB → 102 × 100 LB + 1 × 10 LB.
 */
export function planDeSacos(
  qq: number,
  pesoPresentacion: number,
  tamanos: number[],
  sobranteSacoLb?: number | null
): Array<{ peso: number; sacos: number }> {
  const tam = [...new Set(tamanos.filter((t) => t > 0))].sort((a, b) => a - b);
  if (!(qq > 0) || !(pesoPresentacion > 0) || !tam.length) return [];
  const cabe = (lb: number) => tam.find((t) => t >= lb - 1e-6) ?? tam[tam.length - 1];
  const totalLb = Math.round(qq * 100 * 1000) / 1000;
  const llenos = Math.floor(totalLb / pesoPresentacion + 1e-6);
  const sobrante = Math.round((totalLb - llenos * pesoPresentacion) * 1000) / 1000;
  const plan = new Map<number, number>();
  if (llenos > 0) plan.set(cabe(pesoPresentacion), llenos);
  if (sobrante > 0.01) {
    // Saco elegido por el cliente para el sobrante (los que hagan falta).
    const elegido = sobranteSacoLb && tam.includes(Number(sobranteSacoLb)) ? Number(sobranteSacoLb) : null;
    const t = elegido ?? cabe(sobrante);
    const n = elegido ? Math.ceil(sobrante / elegido - 1e-9) : 1;
    plan.set(t, (plan.get(t) ?? 0) + n);
  }
  return [...plan.entries()].map(([peso, sacos]) => ({ peso, sacos })).sort((a, b) => b.peso - a.peso);
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const fmt = (n: number) => n.toLocaleString("es-EC");

export function estadoSaco(s: Saco): Estado {
  const stock = num(s.stock);
  const minimo = num(s.stock_minimo);
  if (stock < 0) return "NEGATIVO";
  if (minimo > 0 && stock <= minimo) return "BAJO";
  if (stock === 0) return "SIN_STOCK";
  return "OK";
}

/** Sacos activos que requieren compra: saldo negativo o en/bajo su mínimo. */
export function sacosConAlerta(sacos: Saco[]): Saco[] {
  return sacos.filter((s) => s.activo !== false && (estadoSaco(s) === "NEGATIVO" || estadoSaco(s) === "BAJO"));
}

const ESTILO: Record<Estado, { bg: string; bd: string; fg: string; label: string }> = {
  NEGATIVO: { bg: "#fef2f2", bd: "#fca5a5", fg: "#b91c1c", label: "Faltante" },
  BAJO: { bg: "#fff7ed", bd: "#fdba74", fg: "#c2410c", label: "Stock bajo" },
  SIN_STOCK: { bg: "#f8fafc", bd: "#e2e8f0", fg: "#64748b", label: "Sin stock" },
  OK: { bg: "#f0fdf4", bd: "#86efac", fg: "#15803d", label: "Disponible" }
};

function etiquetaCalidad(c?: string | null) {
  if (c === "0.11") return "Arroz 0.11";
  if (c === "CORRIENTE") return "Arroz Corriente";
  return null;
}

/** Nombre de la fila en la matriz: la marca, o el tipo para genéricos/subproductos. */
function filaDe(s: Saco): string {
  if ((s.categoria === "MARCA" || s.categoria === "PROPIO") && s.marca) return s.marca;
  if (s.categoria === "GENERICO") return "Sin marca (genérico)";
  return s.tipo;
}

/** Libras que sobran tras llenar los bultos completos de la presentación (0 si es exacto). */
export function sobranteLb(qq: number, pesoPresentacion: number): number {
  if (!(qq > 0) || !(pesoPresentacion > 0)) return 0;
  const totalLb = Math.round(qq * 100 * 1000) / 1000;
  const llenos = Math.floor(totalLb / pesoPresentacion + 1e-6);
  const s = Math.round((totalLb - llenos * pesoPresentacion) * 1000) / 1000;
  return s > 0.01 ? s : 0;
}

const ORDEN_GRUPO = ["Mis sacos", "Arroz 0.11", "Arroz Corriente", "Otras marcas", "Subproductos", "Genéricos"];
function grupoDe(s: Saco): string {
  if (s.categoria === "PROPIO") return "Mis sacos";
  if (s.categoria === "SUBPRODUCTO") return "Subproductos";
  if (s.categoria === "GENERICO") return "Genéricos";
  return etiquetaCalidad(s.calidad) ?? "Otras marcas";
}

// ─────────────────────────────────────────────────────────────────────────────
// Tablero de inventario
// ─────────────────────────────────────────────────────────────────────────────
export function SacosTablero({ sacos, onVerKardex, onConfig }: { sacos: Saco[]; onVerKardex?: () => void; onConfig?: () => void }) {
  const [soloAlertas, setSoloAlertas] = useState(false);
  const activos = useMemo(() => sacos.filter((s) => s.activo !== false), [sacos]);
  const alertas = useMemo(() => sacosConAlerta(activos), [activos]);

  const pesos = useMemo(() => {
    const set = new Set<number>();
    activos.forEach((s) => { const p = num(s.peso_lb); if (p > 0 && s.categoria !== "SUBPRODUCTO") set.add(p); });
    return [...set].sort((a, b) => b - a);
  }, [activos]);

  const grupos = useMemo(() => {
    const base = soloAlertas ? alertas : activos;
    const porGrupo = new Map<string, Map<string, Saco[]>>();
    for (const s of base) {
      const g = grupoDe(s);
      if (!porGrupo.has(g)) porGrupo.set(g, new Map());
      const filas = porGrupo.get(g)!;
      const f = filaDe(s);
      filas.set(f, [...(filas.get(f) ?? []), s]);
    }
    return ORDEN_GRUPO.filter((g) => porGrupo.has(g)).map((g) => ({ grupo: g, filas: [...porGrupo.get(g)!.entries()] }));
  }, [activos, alertas, soloAlertas]);

  const totalSacos = activos.reduce((a, s) => a + Math.max(0, num(s.stock)), 0);
  const valor = activos.reduce((a, s) => a + Math.max(0, num(s.stock)) * num(s.precio_compra_default), 0);
  const marcas = new Set(activos.filter((s) => s.categoria === "MARCA" || s.categoria === "PROPIO").map((s) => s.marca)).size;

  const kpi = (titulo: string, valorTxt: string, sub: string, color = "#0f172a") => (
    <div style={{ flex: "1 1 150px", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#64748b" }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 2 }}>{valorTxt}</div>
      <div style={{ fontSize: 11.5, color: "#64748b" }}>{sub}</div>
    </div>
  );

  const celda = (s: Saco | undefined) => {
    if (!s) return <span style={{ color: "#cbd5e1" }}>—</span>;
    const e = ESTILO[estadoSaco(s)];
    const minimo = num(s.stock_minimo);
    return (
      <span title={`${s.tipo} · ${e.label}${minimo > 0 ? ` · mínimo ${fmt(minimo)}` : " · sin mínimo definido"}`}
        style={{ display: "inline-block", minWidth: 64, padding: "5px 10px", borderRadius: 999, background: e.bg, border: `1px solid ${e.bd}`, color: e.fg, fontWeight: 800, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
        {fmt(num(s.stock))}
        {minimo > 0 && <span style={{ fontWeight: 600, fontSize: 10.5, opacity: 0.75 }}> / {fmt(minimo)}</span>}
      </span>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {kpi("Sacos en bodega", fmt(totalSacos), `${activos.length} presentaciones activas`)}
        {kpi("Marcas", String(marcas), "con sacos registrados")}
        {kpi("Valor estimado", `$${valor.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "stock × precio de compra")}
        {kpi("Alertas", String(alertas.length), alertas.length ? "sacos por comprar" : "todo en orden", alertas.length ? "#c2410c" : "#15803d")}
      </div>

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderBottom: "1px solid #eef2f7" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Stock por marca y presentación</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Se descuentan al confirmar la preparación del pedido. Número pequeño = stock mínimo.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className={soloAlertas ? "primary" : "btnSecondary"} onClick={() => setSoloAlertas((v) => !v)} style={{ fontSize: 12 }}>
              {soloAlertas ? "Ver todos" : `⚠️ Solo alertas (${alertas.length})`}
            </button>
            {onVerKardex && <button type="button" className="btnSecondary" onClick={onVerKardex} style={{ fontSize: 12 }}>📄 Kárdex</button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569" }}>
                <th style={{ textAlign: "left", padding: "9px 14px", fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".04em" }}>Marca / Saco</th>
                {pesos.map((p) => <th key={p} style={{ textAlign: "center", padding: "9px 10px", fontSize: 11.5 }}>{p} LB{p === 100 ? " · 1 QQ" : p === 25 ? " · @" : ""}</th>)}
                <th style={{ textAlign: "center", padding: "9px 10px", fontSize: 11.5 }}>Sin peso</th>
                <th style={{ textAlign: "right", padding: "9px 14px", fontSize: 11.5 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {grupos.length === 0 && (
                <tr><td colSpan={pesos.length + 3} style={{ padding: 18, textAlign: "center", color: "#64748b" }}>
                  {soloAlertas ? "Ningún saco está por debajo de su mínimo." : "No hay sacos registrados. Agrégalos en Configuración → Operación y Planta → Catálogo de sacos."}
                  {!soloAlertas && onConfig && <> <button type="button" className="vdTarifaLink" onClick={onConfig}>⚙️ Abrir catálogo</button></>}
                </td></tr>
              )}
              {grupos.map(({ grupo, filas }) => [
                <tr key={`g-${grupo}`}>
                  <td colSpan={pesos.length + 3} style={{ padding: "8px 14px 4px", fontSize: 11, fontWeight: 800, color: "#0f766e", textTransform: "uppercase", letterSpacing: ".06em", background: "#fcfdfd" }}>{grupo}</td>
                </tr>,
                ...filas.map(([fila, items]) => {
                  const sinPeso = items.filter((s) => !(num(s.peso_lb) > 0) || s.categoria === "SUBPRODUCTO");
                  const total = items.reduce((a, s) => a + num(s.stock), 0);
                  return (
                    <tr key={`${grupo}-${fila}`} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "9px 14px", fontWeight: 700 }}>{fila}</td>
                      {pesos.map((p) => (
                        <td key={p} style={{ textAlign: "center", padding: "7px 6px" }}>
                          {celda(items.find((s) => num(s.peso_lb) === p && s.categoria !== "SUBPRODUCTO"))}
                        </td>
                      ))}
                      <td style={{ textAlign: "center", padding: "7px 6px" }}>{sinPeso.length ? celda(sinPeso[0]) : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                      <td style={{ textAlign: "right", padding: "9px 14px", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: total < 0 ? "#b91c1c" : "#0f172a" }}>{fmt(total)}</td>
                    </tr>
                  );
                })
              ])}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "10px 14px", borderTop: "1px solid #eef2f7", fontSize: 11.5, color: "#64748b" }}>
          {(["OK", "BAJO", "NEGATIVO", "SIN_STOCK"] as Estado[]).map((e) => (
            <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: ESTILO[e].bg, border: `1px solid ${ESTILO[e].bd}` }} />
              {ESTILO[e].label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerta del Dashboard
// ─────────────────────────────────────────────────────────────────────────────
export function SacosAlertaDashboard({ sacos, onIr, onConfig }: { sacos: Saco[]; onIr?: () => void; onConfig?: () => void }) {
  const alertas = sacosConAlerta(sacos);
  if (!alertas.length) return null;
  const faltantes = alertas.filter((s) => estadoSaco(s) === "NEGATIVO").length;
  return (
    <div role="alert" style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap", background: "#fff7ed", border: "1px solid #fdba74", borderLeft: "5px solid #ea580c", borderRadius: 12, padding: "12px 16px", margin: "0 0 14px" }}>
      <div style={{ fontSize: 26, lineHeight: 1 }}>📦</div>
      <div style={{ flex: "1 1 260px" }}>
        <div style={{ fontWeight: 800, color: "#9a3412" }}>
          Quedan pocos sacos: {alertas.length} presentación{alertas.length === 1 ? "" : "es"} en o bajo su mínimo{faltantes ? ` · ${faltantes} con faltante` : ""}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {alertas.slice(0, 12).map((s) => {
            const e = ESTILO[estadoSaco(s)];
            return (
              <span key={s.id} style={{ background: "#fff", border: `1px solid ${e.bd}`, color: e.fg, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
                {s.tipo}: {fmt(num(s.stock))}{num(s.stock_minimo) > 0 ? ` / mín ${fmt(num(s.stock_minimo))}` : ""}
              </span>
            );
          })}
          {alertas.length > 12 && <span style={{ fontSize: 12, color: "#9a3412" }}>+{alertas.length - 12} más</span>}
        </div>
      </div>
      {onIr && <button type="button" className="btnSecondary" onClick={onIr} style={{ fontSize: 12, alignSelf: "center" }}>Ver inventario de sacos</button>}
      {onConfig && <button type="button" className="vdTarifaLink" onClick={onConfig} style={{ alignSelf: "center" }} title="Ajustar el stock mínimo de cada saco">⚙️ Ajustar mínimos</button>}
    </div>
  );
}

/** Saco que falta para los pedidos pendientes (GET /sacks/por-comprar). */
export type SacoPorComprar = { id: string; tipo: string; stock: number; necesarios: number; faltan: number; pedidos: string[] };

/**
 * Dashboard: SACOS POR COMPRAR. Los pedidos se toman aunque falten sacos (el
 * vendedor nunca queda bloqueado); aquí se avisa cuántos hay que comprar para
 * poder alistar los pedidos pendientes, más los que ya quedaron en negativo.
 */
export function SacosPorComprarAlerta({ sacos, onIr }: { sacos: SacoPorComprar[]; onIr?: () => void }) {
  if (!sacos.length) return null;
  const pedidos = new Set(sacos.flatMap((s) => s.pedidos));
  return (
    <div role="alert" style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap", background: "#fef2f2", border: "1px solid #fca5a5", borderLeft: "5px solid #dc2626", borderRadius: 12, padding: "12px 16px", margin: "0 0 14px" }}>
      <div style={{ fontSize: 26, lineHeight: 1 }}>🧺</div>
      <div style={{ flex: "1 1 260px" }}>
        <div style={{ fontWeight: 800, color: "#991b1b" }}>
          Sacos por comprar: {sacos.length} tipo{sacos.length === 1 ? "" : "s"}
          {pedidos.size ? ` · para ${pedidos.size} pedido${pedidos.size === 1 ? "" : "s"} pendiente${pedidos.size === 1 ? "" : "s"}` : ""}
        </div>
        <div style={{ fontSize: 12, color: "#7f1d1d", marginTop: 2 }}>
          Los vendedores ya tomaron estos pedidos: compra los sacos (Caja → Sacos) antes de alistarlos.
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {sacos.slice(0, 12).map((s) => (
            <span key={s.id} title={s.pedidos.length ? `Pedidos: ${s.pedidos.join(", ")}` : "Stock en negativo"}
              style={{ background: "#fff", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
              {s.tipo}: faltan {fmt(s.faltan)}
              <span style={{ fontWeight: 500, color: "#b91c1c" }}> (hay {fmt(s.stock)}{s.necesarios > 0 ? `, piden ${fmt(s.necesarios)}` : ""})</span>
            </span>
          ))}
          {sacos.length > 12 && <span style={{ fontSize: 12, color: "#991b1b" }}>+{sacos.length - 12} más</span>}
        </div>
      </div>
      {onIr && <button type="button" className="btnSecondary" onClick={onIr} style={{ fontSize: 12, alignSelf: "center" }}>Ver inventario de sacos</button>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo en Configuración
// ─────────────────────────────────────────────────────────────────────────────
// La planta no maneja sacos de 50 LB: esos pedidos van en saco de 100 LB
// (regla automática de planDeSacos). "Otro peso" permite registrar cualquier otro.
const PESOS_BASE = [100, 25, 10];

export function SacosCatalogoConfig({
  sacos, puedeEditar, onCambio, avisar, modo = "MATRIZ"
}: {
  sacos: Saco[];
  /** MATRIZ: marcas/genéricos de la planta. PROPIO: sacos del socio (envejecido). */
  modo?: "MATRIZ" | "PROPIO";
  puedeEditar: boolean;
  onCambio: () => Promise<void>;
  avisar: (msg: string, tipo: "success" | "error" | "warn") => void;
}) {
  const [form, setForm] = useState({ categoria: "MARCA" as "MARCA" | "GENERICO", marca: "", calidad: "0.11" as "0.11" | "CORRIENTE", pesos: [100, 25, 10] as number[], otroPeso: "", minimo: "", compra: "", cliente: "" });
  const [verInactivos, setVerInactivos] = useState(false);
  const esPropio = modo === "PROPIO";
  const [guardando, setGuardando] = useState(false);
  const marcasExistentes = useMemo(() => [...new Set(sacos.filter((s) => s.marca).map((s) => String(s.marca)))].sort(), [sacos]);
  const lista = sacos.filter((s) => verInactivos || s.activo !== false);

  async function crear(e: FormEvent) {
    e.preventDefault();
    const pesos = [...form.pesos, ...(Number(form.otroPeso) > 0 ? [Number(form.otroPeso)] : [])];
    if (!pesos.length) { avisar("Elige al menos un peso", "error"); return; }
    if ((form.categoria === "MARCA" || esPropio) && !form.marca.trim()) { avisar(esPropio ? "Escribe el nombre del saco" : "Escribe el nombre de la marca", "error"); return; }
    setGuardando(true);
    try {
      const r = await apiPost<{ creados: string[]; existentes: string[] }>("/sacks", {
        categoria: esPropio ? "PROPIO" : form.categoria,
        marca: esPropio || form.categoria === "MARCA" ? form.marca.trim() : undefined,
        calidad: !esPropio && form.categoria === "MARCA" ? form.calidad : null,
        pesos,
        stock_minimo: Math.max(0, Math.round(Number(form.minimo) || 0)),
        precio_compra_default: Math.max(0, Number(form.compra) || 0),
        precio_venta_cliente: Math.max(0, Number(form.cliente) || 0)
      });
      await onCambio();
      if (r.creados.length) avisar(`Sacos agregados: ${r.creados.join(", ")}`, "success");
      if (r.existentes.length) avisar(`Ya existían: ${r.existentes.join(", ")}`, "warn");
      setForm((f) => ({ ...f, marca: "", otroPeso: "" }));
    } catch (err) {
      avisar(err instanceof Error ? err.message : "No se pudo agregar", "error");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarCampo(s: Saco, campo: "stock_minimo" | "precio_compra_default" | "precio_venta_cliente", valor: number) {
    if (!Number.isFinite(valor) || valor < 0) return;
    if (num(s[campo]) === valor) return;
    try {
      await apiPatch(`/sacks/${s.id}`, { [campo]: campo === "stock_minimo" ? Math.round(valor) : valor });
      await onCambio();
      avisar(`${s.tipo} actualizado`, "success");
    } catch (err) {
      avisar(err instanceof Error ? err.message : "No se pudo guardar", "error");
    }
  }

  async function cambiarActivo(s: Saco, activo: boolean) {
    try {
      await apiPatch(`/sacks/${s.id}`, { activo });
      await onCambio();
      avisar(`${s.tipo} ${activo ? "reactivado" : "desactivado"}`, "success");
    } catch (err) {
      avisar(err instanceof Error ? err.message : "No se pudo cambiar", "error");
    }
  }

  async function eliminar(s: Saco) {
    const tieneStock = num(s.stock) !== 0;
    if (!window.confirm(`¿Eliminar "${s.tipo}"?${tieneStock ? `\n\nTiene ${num(s.stock)} sacos en stock.` : ""}\n\nSi tiene movimientos se DESACTIVA (se conserva su historial); si no, se borra.`)) return;
    try {
      const r = await apiFetch(`/sacks/${s.id}`, { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? "No se pudo eliminar");
      await onCambio();
      avisar(data.resultado === "ELIMINADO" ? `${s.tipo} eliminado` : `${s.tipo} desactivado (tenía historial)`, "success");
    } catch (err) {
      avisar(err instanceof Error ? err.message : "No se pudo eliminar", "error");
    }
  }

  const inp = { padding: "5px 7px", borderRadius: 6, border: "1px solid #d1d5db", width: 84, textAlign: "right" as const, fontSize: 12.5 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {esPropio ? (
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
        Estos son <strong>tus sacos propios</strong> para el arroz envejecido. Se cargan con la <strong>Compra de sacos</strong> en tu Caja
        y se descuentan al <strong>recibir el envejecido</strong> en Selección cuando lo empacas en saco. Son independientes de los sacos de la Matriz.
        El <strong>stock mínimo</strong> activa la alerta de tu Dashboard.
      </p>
      ) : (
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
        Los sacos se descuentan al <strong>confirmar la preparación</strong> de un pedido (marca + presentación vendida) y en los
        <strong> servicios de pilada</strong> cuando el cliente pide sacos de la planta (se le cobran al <em>precio al cliente</em>).
        El <strong>stock mínimo</strong> activa la alerta del Dashboard. El stock se carga con la compra de sacos en Caja.
        Empaque automático: cada bulto va en el saco más pequeño de la marca donde cabe (pedido de 50 LB → saco de 100 LB)
        y el sobrante en el más pequeño que lo contiene (100 QQ en 98 LB → 102 sacos de 100 LB + 1 de 10 LB).
      </p>
      )}

      {puedeEditar && (
        <form onSubmit={crear} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5 }}>➕ Agregar sacos</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            {esPropio ? (
              <label><span>Nombre del saco</span>
                <input list="sacos-marcas" value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} placeholder="Ej: Saco envejecido" />
                <datalist id="sacos-marcas">{marcasExistentes.map((m) => <option key={m} value={m} />)}</datalist>
              </label>
            ) : (
            <label><span>Tipo</span>
              <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value as "MARCA" | "GENERICO" })}>
                <option value="MARCA">Saco de marca</option>
                <option value="GENERICO">Saco genérico (sin marca)</option>
              </select>
            </label>
            )}
            {!esPropio && form.categoria === "MARCA" && <>
              <label><span>Marca</span>
                <input list="sacos-marcas" value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} placeholder="Ej: Flor" />
                <datalist id="sacos-marcas">{marcasExistentes.map((m) => <option key={m} value={m} />)}</datalist>
              </label>
              <label><span>Calidad del arroz</span>
                <select value={form.calidad} onChange={(e) => setForm({ ...form, calidad: e.target.value as "0.11" | "CORRIENTE" })}>
                  <option value="0.11">0.11</option>
                  <option value="CORRIENTE">Corriente</option>
                </select>
              </label>
            </>}
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Pesos</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
              {PESOS_BASE.map((p) => {
                const on = form.pesos.includes(p);
                return (
                  <button key={p} type="button" onClick={() => setForm({ ...form, pesos: on ? form.pesos.filter((x) => x !== p) : [...form.pesos, p] })}
                    style={{ padding: "5px 12px", borderRadius: 999, border: `1px solid ${on ? "#0f766e" : "#cbd5e1"}`, background: on ? "#ccfbf1" : "#fff", color: on ? "#0f766e" : "#475569", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                    {on ? "✓ " : ""}{p} LB{p === 100 ? " (1 QQ)" : p === 25 ? " (@)" : ""}
                  </button>
                );
              })}
              <input type="number" min="1" step="0.5" value={form.otroPeso} onChange={(e) => setForm({ ...form, otroPeso: e.target.value })} placeholder="Otro peso (lb)" style={{ width: 120 }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <label><span>Stock mínimo (alerta)</span><input type="number" min="0" step="1" value={form.minimo} onChange={(e) => setForm({ ...form, minimo: e.target.value })} placeholder="0 = sin alerta" /></label>
            <label><span>Precio de compra ($)</span><input type="number" min="0" step="0.01" value={form.compra} onChange={(e) => setForm({ ...form, compra: e.target.value })} placeholder="0.00" /></label>
            {!esPropio && <label><span>Precio al cliente de servicio ($)</span><input type="number" min="0" step="0.01" value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} placeholder="0.00" /></label>}
          </div>
          <div><button className="primary" disabled={guardando}>{guardando ? "Guardando…" : "Agregar sacos"}</button></div>
        </form>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13.5 }}>Sacos registrados ({lista.length})</strong>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Mostrar desactivados
        </label>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#475569" }}>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Saco</th>
              {!esPropio && <th style={{ textAlign: "left", padding: "8px 10px" }}>Calidad</th>}
              <th style={{ textAlign: "right", padding: "8px 10px" }}>Stock</th>
              <th style={{ textAlign: "right", padding: "8px 10px" }}>Mínimo</th>
              <th style={{ textAlign: "right", padding: "8px 10px" }}>P. compra $</th>
              {!esPropio && <th style={{ textAlign: "right", padding: "8px 10px" }}>P. cliente $</th>}
              <th style={{ textAlign: "center", padding: "8px 10px" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={esPropio ? 5 : 7} style={{ padding: 14, textAlign: "center", color: "#64748b" }}>Sin sacos registrados</td></tr>}
            {lista.map((s) => {
              const e = ESTILO[estadoSaco(s)];
              const inactivo = s.activo === false;
              return (
                <tr key={s.id} style={{ borderTop: "1px solid #f1f5f9", opacity: inactivo ? 0.55 : 1 }}>
                  <td style={{ padding: "7px 10px", fontWeight: 700 }}>
                    {s.tipo}
                    {s.categoria !== "MARCA" && s.categoria !== "PROPIO" && <span style={{ marginLeft: 6, fontSize: 10.5, color: "#64748b", fontWeight: 600 }}>{s.categoria === "SUBPRODUCTO" ? "subproducto" : "genérico"}</span>}
                    {inactivo && <span style={{ marginLeft: 6, fontSize: 10.5, color: "#b91c1c" }}>desactivado</span>}
                  </td>
                  {!esPropio && <td style={{ padding: "7px 10px", color: "#475569" }}>{etiquetaCalidad(s.calidad) ?? "—"}</td>}
                  <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800, color: e.fg }}>{fmt(num(s.stock))}</td>
                  {(esPropio ? (["stock_minimo", "precio_compra_default"] as const) : (["stock_minimo", "precio_compra_default", "precio_venta_cliente"] as const)).map((campo) => (
                    <td key={campo} style={{ padding: "5px 10px", textAlign: "right" }}>
                      <input type="number" min="0" step={campo === "stock_minimo" ? "1" : "0.01"} disabled={!puedeEditar || inactivo}
                        key={`${s.id}-${campo}-${String(s[campo] ?? 0)}`}
                        defaultValue={campo === "stock_minimo" ? num(s[campo]) : num(s[campo]).toFixed(2)}
                        onBlur={(ev) => guardarCampo(s, campo, Number(ev.target.value))}
                        onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }}
                        style={inp} />
                    </td>
                  ))}
                  <td style={{ padding: "5px 10px", textAlign: "center", whiteSpace: "nowrap" }}>
                    {puedeEditar && (inactivo
                      ? <button type="button" className="btnSecondary" style={{ fontSize: 11.5 }} onClick={() => cambiarActivo(s, true)}>Reactivar</button>
                      : <button type="button" className="btnSecondary" style={{ fontSize: 11.5, color: "#b91c1c" }} onClick={() => eliminar(s)}>🗑 Eliminar</button>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
