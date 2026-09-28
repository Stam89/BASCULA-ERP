// 🔎 «¿Cuándo se hizo?»: respuesta inmediata a "¿qué día se arregló / cambió /
// compró X?". Busca en lo que ya se registra en Caja (egresos con subcategoría,
// máquina y área) y en los mantenimientos. Dos ámbitos independientes:
// "matriz" (Caja de la Matriz + mantenimiento de planta) y "transporte" (Caja y
// flota de Transporte y Cosechadora). Solo lectura.
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";

type Fila = {
  fuente: "CAJA" | "MANTENIMIENTO" | string;
  id: string;
  fecha: string;
  categoria: string | null;
  subcategoria: string | null;
  maquina: string | null;
  area: string | null;
  detalle: string | null;
  proveedor: string | null;
  factura: string | null;
  monto: number;
  donde: string | null;
};

const dinero = (n: number) => `$${(Number(n) || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaLarga = (f: string) => new Date(f).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fechaCorta = (f: string) => new Date(f).toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", year: "numeric" });
function haceDias(f: string): string {
  const d = Math.floor((Date.now() - new Date(f).getTime()) / 86400000);
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 31) return `hace ${d} días`;
  const m = Math.floor(d / 30);
  return m < 12 ? `hace ${m} mes${m === 1 ? "" : "es"}` : `hace ${Math.floor(m / 12)} año${m >= 24 ? "s" : ""}`;
}
const queHizo = (r: Fila) => r.detalle || r.subcategoria || r.categoria || "Egreso";

export function BuscadorHistorial({ ambito, titulo }: { ambito: "matriz" | "transporte"; titulo: string }) {
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chips, setChips] = useState<Array<{ texto: string; veces: number }>>([]);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    apiGet<Array<{ texto: string; veces: number }>>(`/historial/sugerencias?ambito=${ambito}`).then(setChips).catch(() => setChips([]));
  }, [ambito]);

  // Busca mientras escribe (con una pequeña pausa para no saturar).
  useEffect(() => {
    const t = window.setTimeout(() => {
      const p = new URLSearchParams({ ambito });
      if (texto.trim()) p.set("q", texto.trim());
      if (desde) p.set("desde", desde);
      if (hasta) p.set("hasta", hasta);
      setCargando(true);
      apiGet<{ filas: Fila[]; total: number }>(`/historial/buscar?${p.toString()}`)
        .then((r) => { setFilas(r.filas); setTotal(r.total); setError(null); })
        .catch((e) => setError(e instanceof Error ? e.message : "No se pudo buscar"))
        .finally(() => setCargando(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [ambito, texto, desde, hasta]);

  const ultima = filas[0];
  const buscando = texto.trim().length >= 2;
  const respuesta = useMemo(() => {
    if (!ultima) return "";
    const que = buscando ? `«${texto.trim()}»` : queHizo(ultima);
    return `${titulo} · ${que}: la última vez fue el ${fechaLarga(ultima.fecha)} (${haceDias(ultima.fecha)}) — ${queHizo(ultima)}`
      + `${ultima.maquina ? ` · ${ultima.maquina}` : ""}${ultima.proveedor ? ` · ${ultima.proveedor}` : ""} · ${dinero(ultima.monto)}.`
      + (buscando && filas.length > 1 ? ` Registrado ${filas.length} veces (total ${dinero(total)}).` : "");
  }, [ultima, buscando, texto, titulo, filas.length, total]);

  async function copiar() {
    try { await navigator.clipboard.writeText(respuesta); setCopiado(true); window.setTimeout(() => setCopiado(false), 1800); }
    catch { window.prompt("Copia la respuesta:", respuesta); }
  }

  return (
    <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
      <h2 style={{ margin: 0 }}>🔎 ¿Cuándo se hizo? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {titulo}</span></h2>
      <p className="muted" style={{ margin: "4px 0 12px", fontSize: 12.5 }}>
        Escribe qué se arregló, cambió o compró (ej: <em>rodamiento</em>, <em>banda secadora</em>, <em>llanta</em>, <em>aceite</em>) y te dice el día.
        Busca en los egresos de Caja (descripción, subcategoría, máquina y área) y en los mantenimientos.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) repeat(2, minmax(120px, 1fr))", gap: 10, alignItems: "end" }} className="buscadorHistorialGrid">
        <label><span>¿Qué buscas?</span>
          <input type="search" autoFocus value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Ej: rodamiento secadora, llanta, filtro…" style={{ fontSize: 15, padding: "10px 12px" }} />
        </label>
        <label><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </div>
      {chips.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>Rápido:</span>
          {chips.map((c) => (
            <button key={c.texto} type="button" onClick={() => setTexto(c.texto)}
              style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999, border: "1px solid #cbd5e1", background: texto === c.texto ? "#ccfbf1" : "#fff", cursor: "pointer" }}>
              {c.texto} <span className="muted">({c.veces})</span>
            </button>
          ))}
          {(texto || desde || hasta) && (
            <button type="button" className="btnSecondary" style={{ fontSize: 12, padding: "3px 10px" }} onClick={() => { setTexto(""); setDesde(""); setHasta(""); }}>Limpiar</button>
          )}
        </div>
      )}

      {error && <div className="alertBox" style={{ marginTop: 10 }}>{error}</div>}

      {/* Respuesta directa: la última vez */}
      {ultima && buscando && (
        <div style={{ marginTop: 14, background: "#f0fdf4", border: "1px solid #86efac", borderLeft: "5px solid #16a34a", borderRadius: 12, padding: "12px 16px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 280px" }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#15803d", textTransform: "uppercase", letterSpacing: ".04em" }}>Última vez</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", textTransform: "capitalize" }}>{fechaLarga(ultima.fecha)}</div>
            <div style={{ fontSize: 13, color: "#334155", marginTop: 2 }}>
              <strong>{haceDias(ultima.fecha)}</strong> · {queHizo(ultima)}{ultima.maquina ? ` · ${ultima.maquina}` : ""}{ultima.proveedor ? ` · ${ultima.proveedor}` : ""} · <strong>{dinero(ultima.monto)}</strong>
            </div>
            {filas.length > 1 && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Registrado {filas.length} veces · total {dinero(total)} · la vez anterior: {fechaCorta(filas[1].fecha)} ({haceDias(filas[1].fecha)})
              </div>
            )}
          </div>
          <button type="button" className="primary" onClick={copiar} title="Copia la respuesta para enviarla por WhatsApp">
            {copiado ? "✓ Copiado" : "📋 Copiar respuesta"}
          </button>
        </div>
      )}
      {buscando && !cargando && filas.length === 0 && !error && (
        <div className="emptyState" style={{ marginTop: 14 }}><div className="emptyIcon">🔍</div><p>No hay registros con «{texto.trim()}». Prueba con otra palabra (ej: el nombre de la máquina o del repuesto).</p></div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
        <strong style={{ fontSize: 13.5 }}>{buscando ? `Historial de «${texto.trim()}»` : "Últimos egresos y mantenimientos"}</strong>
        <span className="muted" style={{ fontSize: 12 }}>{cargando ? "Buscando…" : `${filas.length} registro${filas.length === 1 ? "" : "s"} · ${dinero(total)}`}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="cajaTable" style={{ marginTop: 6 }}>
          <thead><tr>
            <th>Fecha</th><th>Qué se hizo / compró</th><th>Máquina / Área</th><th>Categoría</th><th>Proveedor</th><th>Dónde</th><th className="num">Monto</th>
          </tr></thead>
          <tbody>
            {filas.length === 0 ? (
              <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 14 }}>{cargando ? "Buscando…" : "Sin registros."}</td></tr>
            ) : filas.map((r) => (
              <tr key={`${r.fuente}-${r.id}`}>
                <td style={{ whiteSpace: "nowrap" }}>{fechaCorta(r.fecha)}<small className="muted" style={{ display: "block" }}>{haceDias(r.fecha)}</small></td>
                <td style={{ fontWeight: 600 }}>{queHizo(r)}{r.subcategoria && r.detalle ? <small className="muted" style={{ display: "block", fontWeight: 400 }}>{r.subcategoria}</small> : null}</td>
                <td>{[r.maquina, r.area].filter(Boolean).join(" · ") || "—"}</td>
                <td>{r.fuente === "MANTENIMIENTO" ? <span className="chip" style={{ background: "#e0f2fe", color: "#075985" }}>🔧 {r.categoria}</span> : (r.categoria ?? "—")}</td>
                <td>{r.proveedor || "—"}{r.factura ? <small className="muted" style={{ display: "block" }}>Fact. {r.factura}</small> : null}</td>
                <td className="muted">{r.donde || "—"}</td>
                <td className="num" style={{ fontWeight: 700 }}>{dinero(r.monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
