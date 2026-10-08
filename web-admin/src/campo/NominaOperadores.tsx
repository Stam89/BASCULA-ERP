// Nómina de Operadores de Campo (cosechadoras y transporte/fletes) — MATRIZ de
// entrada masiva estilo Excel — y el mantenedor de Tarifas por operador+máquina.
import { memo, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { apiFetch, apiGet, apiPost } from "../api";
import { money } from "../format";

const qqFmt = (n: number) => n.toLocaleString("es-EC", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

async function req(path: string, method: "PATCH" | "DELETE", body?: unknown): Promise<unknown> {
  const r = await apiFetch(path, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "No se pudo completar la operación");
  return r.json().catch(() => ({}));
}

type Activo = { id: string; nombre: string; tipo: string; operador: string | null; activo: boolean };
type Operador = { id: string; nombre: string; activo: boolean };
type Cuenta = { id: string; nombre: string; saldo: number };
type Unidad = "QQ" | "VIAJE" | "DIA";
const unidadLabel = (u: Unidad) => u === "QQ" ? "$ / QQ" : u === "VIAJE" ? "$ / Viaje" : "$ / Día";
const unidadCorta = (u: Unidad) => u === "QQ" ? "QQ" : u === "VIAJE" ? "viaje" : "día";
type Tarifa = { id: string; operador: string; activo_id: string; tarifa: number; unidad: Unidad; activo: boolean; activo_nombre: string; activo_tipo: string };
// Fila de la matriz (GET /campo/nomina-operadores/matriz): operador + máquina con
// sus partes pendientes del periodo (o sin partes, para bonos) y sus vales por rendir.
type Area = "cosechadora" | "transporte" | "otro";
type FilaMatriz = {
  clave: string; operador: string; activo_id: string | null; activo_nombre: string | null; activo_tipo: string | null; area: Area;
  unidad: Unidad; tarifa: number | null; qq: number; viajes: number; dias: number; sugerido: number | null;
  sin_tarifa: boolean; parte_ids: string[]; desde: string | null; hasta: string | null;
  vales: Array<{ id: string; fecha: string; concepto: string | null; monto: number }>;
};
// Lo que el usuario escribió en la fila (vacío = valor sugerido).
type Edicion = { base?: string; extras?: string; descuentos?: string; nota?: string; excluir?: boolean };
type Columna = "base" | "extras" | "descuentos" | "nota";
const AREA_LABEL: Record<Area, string> = { cosechadora: "🌾 Cosechadora", transporte: "🚛 Transporte", otro: "Sin máquina" };
const r2 = (n: number) => Math.round(n * 100) / 100;
const numDe = (v: string | undefined) => { const n = Number(v); return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? n : 0; };

// ── Mantenedor de Tarifas de Operadores (usado en Configuración) ─────────────
export function TarifasOperadorCatalogo({ activos, operadores, onError, onChanged }: {
  activos: Activo[]; operadores: Operador[]; onError: (m: string) => void; onChanged?: (m: string) => void;
}) {
  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [f, setF] = useState({ operador: "", activo_id: "", tarifa: "", unidad: "QQ" as Unidad });
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try { setTarifas(await apiGet<Tarifa[]>("/campo/tarifas-operador")); } catch (e) { onError((e as Error).message); }
  }, [onError]);
  useEffect(() => { cargar(); }, [cargar]);

  // Al elegir máquina, sugiere su operador y la unidad por tipo (cosecha=QQ, resto=VIAJE).
  function elegirMaquina(activo_id: string) {
    const a = activos.find((x) => x.id === activo_id);
    setF((p) => ({
      ...p, activo_id,
      operador: p.operador || (a?.operador ?? ""),
      unidad: a && a.tipo !== "cosechadora" ? "VIAJE" : "QQ"
    }));
  }

  async function guardar() {
    try {
      setBusy(true);
      const operador = f.operador.trim();
      if (!operador) throw new Error("Indica el operador");
      if (!f.activo_id) throw new Error("Elige la máquina");
      const tarifa = Number(f.tarifa);
      if (!(tarifa >= 0)) throw new Error("Tarifa inválida");
      await apiPost("/campo/tarifas-operador", { operador, activo_id: f.activo_id, tarifa, unidad: f.unidad });
      setF({ operador: "", activo_id: "", tarifa: "", unidad: "QQ" });
      await cargar();
      onChanged?.("Tarifa guardada");
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  async function editar(t: Tarifa) {
    const val = window.prompt(`Nueva tarifa para ${t.operador} · ${t.activo_nombre} ($ por ${unidadCorta(t.unidad)}):`, String(t.tarifa));
    if (val == null) return;
    const tarifa = Number(val);
    if (!(tarifa >= 0)) { onError("Tarifa inválida"); return; }
    try { await req(`/campo/tarifas-operador/${t.id}`, "PATCH", { tarifa }); await cargar(); onChanged?.("Tarifa actualizada"); }
    catch (e) { onError((e as Error).message); }
  }

  async function eliminar(t: Tarifa) {
    if (!window.confirm(`¿Eliminar la tarifa de ${t.operador} · ${t.activo_nombre}?`)) return;
    try { await req(`/campo/tarifas-operador/${t.id}`, "DELETE"); await cargar(); onChanged?.("Tarifa eliminada"); }
    catch (e) { onError((e as Error).message); }
  }

  const activosActivos = activos.filter((a) => a.activo);
  return (
    <div className="tablePanel">
      <h2>💲 Tarifas de Operadores</h2>
      <p className="muted" style={{ marginTop: -4 }}>Tarifa por operador y máquina. Cosechadoras cobran por <strong>QQ</strong>; transporte/fletes por <strong>viaje</strong>. Alimenta la Nómina de Operadores.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr 0.8fr 0.9fr auto", gap: 8, alignItems: "end", marginBottom: 12 }}>
        <label><span>Operador</span>
          <input list="tarifaOperadoresList" value={f.operador} onChange={(e) => setF({ ...f, operador: e.target.value })} placeholder="Ej: Leonel" />
          <datalist id="tarifaOperadoresList">
            {operadores.filter((o) => o.activo).map((o) => <option key={o.id} value={o.nombre} />)}
          </datalist>
        </label>
        <label><span>Máquina</span>
          <select value={f.activo_id} onChange={(e) => elegirMaquina(e.target.value)}>
            <option value="">Seleccione</option>
            {activosActivos.map((a) => <option key={a.id} value={a.id}>{a.nombre} ({a.tipo})</option>)}
          </select>
        </label>
        <label><span>Tarifa ($)</span>
          <input type="number" step="0.0001" min="0" value={f.tarifa} onChange={(e) => setF({ ...f, tarifa: e.target.value })} placeholder="0.15" />
        </label>
        <label><span>Unidad</span>
          <select value={f.unidad} onChange={(e) => setF({ ...f, unidad: e.target.value as Unidad })}>
            <option value="QQ">$ / QQ</option>
            <option value="VIAJE">$ / Viaje</option>
            <option value="DIA">$ / Día</option>
          </select>
        </label>
        <button type="button" className="primary" disabled={busy} onClick={guardar}>{busy ? "…" : "Guardar"}</button>
      </div>
      <table className="cajaTable">
        <thead><tr><th>Operador</th><th>Máquina</th><th style={{ textAlign: "right" }}>Tarifa</th><th>Unidad</th><th></th></tr></thead>
        <tbody>
          {tarifas.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 12 }}>Sin tarifas registradas</td></tr>}
          {tarifas.map((t) => (
            <tr key={t.id} style={{ opacity: t.activo ? 1 : 0.5 }}>
              <td>{t.operador}</td>
              <td>{t.activo_nombre} <span className="muted" style={{ fontSize: 11 }}>({t.activo_tipo})</span></td>
              <td style={{ textAlign: "right" }}>{money(t.tarifa)}</td>
              <td>{unidadLabel(t.unidad)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button type="button" onClick={() => editar(t)} title="Editar tarifa" style={{ marginRight: 6 }}>✎</button>
                <button type="button" onClick={() => eliminar(t)} title="Eliminar" style={{ color: "#dc2626" }}>🗑</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Vista principal: MATRIZ de Nómina de Operadores (entrada masiva) ─────────
// Periodo de pago: semana / quincena (actual o anterior), mes o personalizado.
type Periodo = "quincena" | "quincena_ant" | "semana" | "semana_ant" | "mes" | "personalizado";
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function rangoDe(p: Periodo): { from: string; to: string } {
  const h = new Date();
  const y = h.getFullYear(), m = h.getMonth(), d = h.getDate();
  const finMes = (yy: number, mm: number) => new Date(yy, mm + 1, 0);
  if (p === "quincena") return d <= 15 ? { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m, 15)) } : { from: iso(new Date(y, m, 16)), to: iso(finMes(y, m)) };
  if (p === "quincena_ant") return d <= 15 ? { from: iso(new Date(y, m - 1, 16)), to: iso(finMes(y, m - 1)) } : { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m, 15)) };
  const lunes = new Date(y, m, d - ((h.getDay() + 6) % 7));
  if (p === "semana") return { from: iso(lunes), to: iso(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6)) };
  if (p === "semana_ant") return { from: iso(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() - 7)), to: iso(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() - 1)) };
  return { from: iso(new Date(y, m, 1)), to: iso(finMes(y, m)) };
}

// Valores efectivos de una fila (lo escrito o el sugerido) y su total.
function calcularFila(f: FilaMatriz, e: Edicion | undefined) {
  const valesTotal = r2(f.vales.reduce((s, v) => s + v.monto, 0));
  const baseTxt = e?.base ?? (f.sugerido != null ? String(f.sugerido) : "");
  const extrasTxt = e?.extras ?? "";
  const descTxt = e?.descuentos ?? (valesTotal > 0 ? String(valesTotal) : "");
  const nota = e?.nota ?? "";
  const base = numDe(baseTxt), extras = numDe(extrasTxt), descuentos = numDe(descTxt);
  const total = r2(base + extras - descuentos);
  const modificada = !!e && (e.base !== undefined || e.extras !== undefined || e.descuentos !== undefined || !!e.nota);
  // Nota obligatoria: base distinta de la sugerida, o partes sin tarifa.
  const pideNota = (f.sugerido != null && Math.abs(base - f.sugerido) > 0.005) || (f.sin_tarifa && f.parte_ids.length > 0);
  const valesCubiertos = valesTotal > 0 && descuentos + 0.005 >= valesTotal;
  const sugeridaIncluir = total > 0 || (f.parte_ids.length > 0 && modificada);
  const incluida = e?.excluir ? false : sugeridaIncluir;
  const error = total < 0 ? "Descuentos mayores que base + extras" : incluida && pideNota && !nota.trim() ? "Escribe la nota del ajuste" : "";
  return { baseTxt, extrasTxt, descTxt, nota, base, extras, descuentos, total, valesTotal, valesCubiertos, pideNota, incluida, sugeridaIncluir, error };
}

// Mover el foco como en Excel: Enter / ↓ baja, ↑ sube (misma columna).
function moverFoco(e: KeyboardEvent<HTMLInputElement>, idx: number, col: Columna) {
  const destino = e.key === "Enter" || e.key === "ArrowDown" ? idx + 1 : e.key === "ArrowUp" ? idx - 1 : null;
  if (destino == null) return;
  const el = document.querySelector<HTMLInputElement>(`[data-celda="${destino}:${col}"]`);
  if (el) { e.preventDefault(); el.focus(); el.select(); }
  else if (e.key === "Enter") e.preventDefault();
}

// Una fila de la matriz. memo: escribir en una celda solo vuelve a pintar SU fila.
const FilaNomina = memo(function FilaNomina({ fila: f, idx, edit, onEdit }: {
  fila: FilaMatriz; idx: number; edit: Edicion | undefined; onEdit: (clave: string, cambio: Partial<Edicion>) => void;
}) {
  const c = calcularFila(f, edit);
  const prod = f.parte_ids.length === 0 ? null
    : f.unidad === "QQ" ? `${qqFmt(f.qq)} QQ` : f.unidad === "DIA" ? `${f.dias} día(s)` : `${f.viajes} viaje(s)`;
  const celda = (col: Columna, valor: string, extra?: { placeholder?: string; title?: string; alerta?: boolean }) => (
    <input data-celda={`${idx}:${col}`} type={col === "nota" ? "text" : "number"} min={col === "nota" ? undefined : 0} step={col === "nota" ? undefined : "0.01"}
      className={`nomMatriz__celda ${col === "nota" ? "nomMatriz__celda--nota" : ""} ${extra?.alerta ? "is-alerta" : ""}`}
      value={valor} placeholder={extra?.placeholder ?? (col === "nota" ? "" : "0.00")} title={extra?.title}
      onChange={(e) => onEdit(f.clave, { [col]: e.target.value })}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => moverFoco(e, idx, col)} />
  );
  return (
    <tr className={`${c.incluida ? "" : "is-fuera"} ${c.error ? "is-error" : ""}`}>
      <td className="nomMatriz__check">
        <input type="checkbox" checked={c.incluida} aria-label={`Incluir a ${f.operador}`} disabled={!c.sugeridaIncluir}
          title={c.sugeridaIncluir ? "Incluir en el lote" : "Escribe un monto para incluirla"}
          onChange={(e) => onEdit(f.clave, { excluir: !e.target.checked })} />
      </td>
      <td>
        <strong>{f.operador}</strong>
        <small className="nomMatriz__sub">{f.activo_nombre ?? "Sin máquina"}{f.activo_nombre ? ` · ${AREA_LABEL[f.area].split(" ").slice(1).join(" ")}` : ""}</small>
      </td>
      <td className="nomMatriz__prod">
        {prod ? <>{prod}{f.sin_tarifa
          ? <small className="nomMatriz__alerta">⚠️ sin tarifa</small>
          : <small className="nomMatriz__sub">× {money(f.tarifa ?? 0)} / {unidadCorta(f.unidad)}</small>}</>
          : <span className="muted">—</span>}
      </td>
      <td className="num">{celda("base", c.baseTxt, { alerta: c.pideNota, title: f.sugerido != null ? `Sugerido: ${money(f.sugerido)}` : undefined, placeholder: f.parte_ids.length ? "0.00" : "—" })}</td>
      <td className="num">{celda("extras", c.extrasTxt)}</td>
      <td className="num">
        {celda("descuentos", c.descTxt, { title: f.vales.length ? f.vales.map((v) => `${v.fecha} · ${v.concepto ?? "Vale"} · ${money(v.monto)}`).join("\n") : undefined })}
        {f.vales.length > 0 && (
          <small className={c.valesCubiertos ? "nomMatriz__sub" : "nomMatriz__alerta"} title={f.vales.map((v) => `${v.fecha} · ${v.concepto ?? "Vale"} · ${money(v.monto)}`).join("\n")}>
            🧾 {f.vales.length} vale(s) {money(c.valesTotal)}{c.valesCubiertos ? " · se rinden" : " · quedan pendientes"}
          </small>
        )}
      </td>
      <td className={`num nomMatriz__total ${c.total < 0 ? "is-negativo" : ""}`}>{money(c.total)}</td>
      <td>{celda("nota", c.nota, { alerta: c.pideNota && !c.nota.trim(), placeholder: c.pideNota ? "Motivo del ajuste *" : "Opcional" })}
        {c.error && <small className="nomMatriz__alerta">{c.error}</small>}
      </td>
    </tr>
  );
});

type PagoHist = {
  id: string; created_at: string; operador: string; activo_nombre: string | null; monto: number; partes_count: number;
  cuenta_nombre: string | null; anulado_at: string | null; anulado_motivo: string | null;
};

export default function NominaOperadores() {
  const [periodo, setPeriodo] = useState<Periodo>("quincena");
  const [rango, setRango] = useState(() => rangoDe("quincena"));
  const [area, setArea] = useState<"todas" | Area>("todas");
  // Partes NO pagados de antes del periodo: se deben igual, por eso entran por defecto.
  const [conAnteriores, setConAnteriores] = useState(true);
  const [filas, setFilas] = useState<FilaMatriz[]>([]);
  const [edits, setEdits] = useState<Record<string, Edicion>>({});
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cuentaId, setCuentaId] = useState("");
  const [pagos, setPagos] = useState<PagoHist[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 4000); };

  const cambiarPeriodo = (p: Periodo) => { setPeriodo(p); if (p !== "personalizado") setRango(rangoDe(p)); };

  const cargar = useCallback(async () => {
    try {
      setBusy(true);
      const qs = new URLSearchParams();
      if (rango.from && !conAnteriores) qs.set("from", rango.from);
      if (rango.to) qs.set("to", rango.to);
      const [data, cuentasData] = await Promise.all([
        apiGet<{ filas: FilaMatriz[] }>(`/campo/nomina-operadores/matriz?${qs.toString()}`),
        apiGet<Cuenta[]>("/campo/cuentas")
      ]);
      setPagos(await apiGet<PagoHist[]>("/campo/nomina-operadores/pagos?limit=60").catch(() => []));
      const cuentasPago = cuentasData.filter((c) => c.nombre !== "CRUCE PILADORA");
      setFilas(data.filas); setCuentas(cuentasPago); setEdits({});
      setCuentaId((actual) => actual || cuentasPago.find((c) => c.nombre === "CAJA")?.id || cuentasPago[0]?.id || "");
    } catch (e) { notify((e as Error).message, "err"); } finally { setBusy(false); }
  }, [rango.from, rango.to, conAnteriores]);
  useEffect(() => { cargar(); }, [cargar]);

  // Edición estable (no cambia entre renders): solo se repinta la fila tocada.
  const onEdit = useCallback((clave: string, cambio: Partial<Edicion>) => {
    setEdits((prev) => ({ ...prev, [clave]: { ...prev[clave], ...cambio } }));
  }, []);

  const visibles = useMemo(() => filas.filter((f) => area === "todas" || f.area === area), [filas, area]);
  const resumen = useMemo(() => {
    const t = { base: 0, extras: 0, descuentos: 0, total: 0, incluidas: 0, errores: 0 };
    for (const f of visibles) {
      const c = calcularFila(f, edits[f.clave]);
      if (!c.incluida) continue;
      t.base += c.base; t.extras += c.extras; t.descuentos += c.descuentos; t.total += c.total; t.incluidas += 1;
      if (c.error) t.errores += 1;
    }
    return { ...t, base: r2(t.base), extras: r2(t.extras), descuentos: r2(t.descuentos), total: r2(t.total) };
  }, [visibles, edits]);

  async function procesar() {
    if (!cuentaId) { notify("Selecciona la cuenta desde la que se pagará la nómina.", "err"); return; }
    const lote = visibles.map((f) => ({ f, c: calcularFila(f, edits[f.clave]) })).filter(({ c }) => c.incluida);
    if (!lote.length) { notify("No hay filas para pagar: escribe montos o marca las filas a incluir.", "err"); return; }
    const conError = lote.find(({ c }) => c.error);
    if (conError) { notify(`${conError.f.operador}: ${conError.c.error}.`, "err"); return; }
    const cuenta = cuentas.find((c) => c.id === cuentaId)?.nombre ?? "la cuenta seleccionada";
    if (!window.confirm(`¿Procesar la nómina de ${lote.length} operador(es) por ${money(resumen.total)} desde ${cuenta}?\n\n`
      + lote.map(({ f, c }) => `• ${f.operador}${f.activo_nombre ? ` (${f.activo_nombre})` : ""}: ${money(c.total)}`).join("\n")
      + "\n\nSe registra un egreso por operador; sus partes quedan pagados y los vales descontados, rendidos. Todo o nada.")) return;
    try {
      setBusy(true);
      const r = await apiPost<{ total: number; pagos: unknown[] }>("/campo/nomina-operadores/lote", {
        cuenta_id: cuentaId, desde: rango.from || undefined, hasta: rango.to || undefined,
        filas: lote.map(({ f, c }) => ({
          operador: f.operador, activo_id: f.activo_id, parte_ids: f.parte_ids,
          base: c.base, extras: c.extras, descuentos: c.descuentos,
          // Los vales se rinden solo si el descuento los cubre; si no, quedan pendientes.
          vale_ids: c.valesCubiertos ? f.vales.map((v) => v.id) : [],
          nota: c.nota.trim() || undefined
        }))
      });
      notify(`Nómina procesada: ${r.pagos.length} pago(s) por ${money(r.total)} ✓`);
      await cargar();
    } catch (e) { notify((e as Error).message, "err"); } finally { setBusy(false); }
  }

  async function anularPago(p: PagoHist) {
    const motivo = window.prompt(`Anular el pago de ${money(p.monto)} a ${p.operador}.

El dinero vuelve a ${p.cuenta_nombre ?? "la cuenta"}, sus partes quedan sin pagar y los vales que descontó vuelven a pendientes.

Motivo (obligatorio):`, "");
    if (motivo === null) return;
    if (motivo.trim().length < 5) { notify("Escribe el motivo (mínimo 5 letras).", "err"); return; }
    try {
      setBusy(true);
      const r = await apiPost<{ partes_liberados: number; vales_devueltos: number }>(`/campo/nomina-operadores/pagos/${p.id}/anular`, { motivo: motivo.trim() });
      notify(`Pago anulado ✓ · ${r.partes_liberados} parte(s) vuelven a pendientes${r.vales_devueltos ? ` · ${r.vales_devueltos} vale(s) devueltos` : ""}`);
      await cargar();
    } catch (e) { notify((e as Error).message, "err"); } finally { setBusy(false); }
  }

  const PERIODOS: Array<[Periodo, string]> = [["quincena", "Quincena actual"], ["quincena_ant", "Quincena anterior"], ["semana", "Semana actual"],
    ["semana_ant", "Semana anterior"], ["mes", "Mes actual"], ["personalizado", "Personalizado"]];
  return (
    <section className="panelGrid">
      {flash && <div className={`tablePanel`} style={{ gridColumn: "1 / -1", background: flash.kind === "ok" ? "#dcfce7" : "#fee2e2", color: flash.kind === "ok" ? "#15803d" : "#b91c1c", fontWeight: 600 }}>{flash.text}</div>}
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <div className="nomMatriz__barra">
          <h2 style={{ margin: 0 }}>💵 Nómina de Operadores</h2>
          <div className="nomMatriz__filtros">
            <label>Periodo de pago
              <select value={periodo} onChange={(e) => cambiarPeriodo(e.target.value as Periodo)}>
                {PERIODOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </label>
            {periodo === "personalizado" ? (
              <>
                <label>Desde<input type="date" value={rango.from} onChange={(e) => setRango({ ...rango, from: e.target.value })} /></label>
                <label>Hasta<input type="date" value={rango.to} onChange={(e) => setRango({ ...rango, to: e.target.value })} /></label>
              </>
            ) : <span className="nomMatriz__rango">{rango.from.split("-").reverse().join("/")} → {rango.to.split("-").reverse().join("/")}</span>}
            <label className="nomMatriz__anteriores" title="Partes no pagados de antes del periodo (se deben igual)">
              <span><input type="checkbox" checked={conAnteriores} onChange={(e) => setConAnteriores(e.target.checked)} /> Incluir pendientes anteriores</span>
            </label>
            <label>Departamento / Área
              <select value={area} onChange={(e) => setArea(e.target.value as "todas" | Area)}>
                <option value="todas">Todas</option>
                <option value="cosechadora">🌾 Cosechadora</option>
                <option value="transporte">🚛 Transporte</option>
                <option value="otro">Sin máquina</option>
              </select>
            </label>
            <label>Pagar desde
              <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
                <option value="">Seleccione cuenta</option>
                {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({money(c.saldo)})</option>)}
              </select>
            </label>
            <button type="button" onClick={cargar} disabled={busy}>↻ Actualizar</button>
          </div>
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
          Escribe directo en las celdas (Enter o ↓ baja a la siguiente fila). <strong>Base</strong> = producción × tarifa (editable con nota);
          <strong> Vales / Descuentos</strong> trae los vales por rendir del operador. <strong>Total</strong> = Base + Extras − Descuentos.
          Se pagan las filas marcadas con total mayor a 0 o modificadas.{conAnteriores ? " Incluye los partes sin pagar de antes del periodo." : ""}
        </p>
      </div>

      <div className="tablePanel nomMatriz" style={{ gridColumn: "1 / -1" }}>
        <div className="nomMatriz__scroll">
          <table className="nomMatriz__tabla">
            <thead><tr>
              <th className="nomMatriz__check" title="Incluir en el lote">✓</th>
              <th>Operador</th><th>Producción</th>
              <th className="num">Sueldo Base / Días</th><th className="num">Horas Extras / Bonos</th>
              <th className="num">Vales / Descuentos</th><th className="num">Total a Pagar</th><th>Nota</th>
            </tr></thead>
            <tbody>
              {visibles.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 16 }}>{busy ? "Cargando…" : "No hay operadores activos ni partes pendientes en este periodo."}</td></tr>}
              {visibles.map((f, i) => <FilaNomina key={f.clave} fila={f} idx={i} edit={edits[f.clave]} onEdit={onEdit} />)}
            </tbody>
            {visibles.length > 0 && (
              <tfoot><tr>
                <td></td><td colSpan={2}>{resumen.incluidas} a pagar{resumen.errores ? <span className="nomMatriz__alerta"> · {resumen.errores} con error</span> : ""}</td>
                <td className="num">{money(resumen.base)}</td><td className="num">{money(resumen.extras)}</td>
                <td className="num">{money(resumen.descuentos)}</td><td className="num nomMatriz__total">{money(resumen.total)}</td><td></td>
              </tr></tfoot>
            )}
          </table>
        </div>
        <div className="nomMatriz__acciones">
          <small className="muted">Un egreso por operador desde la cuenta elegida; los partes quedan pagados y los vales descontados, rendidos. Si una fila falla, no se paga ninguna.</small>
          <button type="button" className="primary" disabled={busy || resumen.incluidas === 0 || resumen.errores > 0} onClick={procesar}>
            {busy ? "Procesando…" : `💾 Procesar Nómina en Lote · ${resumen.incluidas} · ${money(resumen.total)}`}
          </button>
        </div>
      </div>

      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <h3 style={{ margin: "0 0 8px" }}>🧾 Pagos de nómina recientes</h3>
        <div className="nomMatriz__scroll">
          <table className="nomMatriz__tabla nomHist">
            <thead><tr><th>Fecha</th><th>Operador</th><th>Máquina</th><th className="num">Partes</th><th className="num">Monto</th><th>Cuenta</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {pagos.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 12 }}>Aún no hay pagos de nómina.</td></tr>}
              {pagos.map((p) => (
                <tr key={p.id} style={p.anulado_at ? { opacity: 0.55 } : undefined}>
                  <td>{String(p.created_at).slice(0, 10).split("-").reverse().join("/")}</td>
                  <td>{p.operador}</td>
                  <td>{p.activo_nombre ?? "—"}</td>
                  <td className="num">{p.partes_count}</td>
                  <td className="num">{money(p.monto)}</td>
                  <td>{p.cuenta_nombre ?? "—"}</td>
                  <td>{p.anulado_at ? <span title={p.anulado_motivo ?? ""}>Anulado</span> : "Pagado"}</td>
                  <td>{!p.anulado_at && <button type="button" disabled={busy} onClick={() => anularPago(p)}>Anular</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
