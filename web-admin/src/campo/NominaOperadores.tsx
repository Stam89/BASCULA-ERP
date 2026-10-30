// Nómina de Operadores de Campo (cosechadoras y transporte/fletes) — MATRIZ de
// entrada masiva estilo Excel — y el mantenedor de Tarifas por operador+máquina.
import { memo, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { apiFetch, apiGet, apiPost, esAdministrador } from "../api";
import { money } from "../format";
import { confirmar, pedirTexto } from "../components/Dialogo";

const qqFmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

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
  clave: string; operador_id: string | null; operador: string; cargo: string | null;
  activo_id: string | null; activo_nombre: string | null; activo_tipo: string | null; area: Area;
  unidad: Unidad; tarifa: number | null; qq: number; viajes: number; dias: number; sugerido: number | null;
  produccion_sugerida: number | null; sueldo_semanal: number; modalidad_fija: boolean;
  sueldo_semanal_principal: boolean; sueldo_semanal_pagado: boolean; periodo_semanal: boolean;
  sin_tarifa: boolean; parte_ids: string[]; desde: string | null; hasta: string | null;
  vales: Array<{ id: string; fecha: string; concepto: string | null; monto: number }>;
  /** 📄 Recibo: cada parte pendiente con su fecha, agricultor y QQ. */
  detalle?: Array<{ fecha: string; qq: number; agricultor: string | null }>;
  /** La tarifa es la del operador en OTRA máquina del mismo tipo (no tiene tarifa en esta). */
  tarifa_de_maquina?: string | null;
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
    const val = (await pedirTexto(`Nueva tarifa para ${t.operador} · ${t.activo_nombre} ($ por ${unidadCorta(t.unidad)}):`, String(t.tarifa)));
    if (val == null) return;
    const tarifa = Number(val);
    if (!(tarifa >= 0)) { onError("Tarifa inválida"); return; }
    try { await req(`/campo/tarifas-operador/${t.id}`, "PATCH", { tarifa }); await cargar(); onChanged?.("Tarifa actualizada"); }
    catch (e) { onError((e as Error).message); }
  }

  async function eliminar(t: Tarifa) {
    if (!(await confirmar(`¿Eliminar la tarifa de ${t.operador} · ${t.activo_nombre}?`))) return;
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
  // Nota obligatoria: base distinta de la sugerida, o partes sin tarifa. En
  // sueldo fijo las filas secundarias esperan base cero: la semana se paga una
  // sola vez aunque el trabajador aparezca en varias máquinas.
  const baseEsperada = f.modalidad_fija ? (f.sueldo_semanal_principal ? f.sueldo_semanal : 0) : f.sugerido;
  const pideNota = (baseEsperada != null && Math.abs(base - baseEsperada) > 0.005) || (!f.modalidad_fija && f.sin_tarifa && f.parte_ids.length > 0);
  const valesCubiertos = valesTotal > 0 && descuentos + 0.005 >= valesTotal;
  const sugeridaIncluir = total > 0 || (f.modalidad_fija && f.parte_ids.length > 0) || (f.parte_ids.length > 0 && modificada);
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

// 📄 Recibo de un operador (todas sus máquinas): cada parte con fecha, máquina, agricultor y QQ, y los días trabajados.
function ReciboOperador({ filas }: { filas: FilaMatriz[] }) {
  const lineas = filas.flatMap((f) => (f.detalle ?? []).map((d) => ({ ...d, maquina: f.activo_nombre ?? "" })))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (lineas.length === 0) return null;
  const dias = new Set(lineas.map((l) => l.fecha)).size;
  const qq = lineas.reduce((s, l) => s + Number(l.qq || 0), 0);
  return (
    <details className="nomMatriz__recibo campoNomina__recibo">
      <summary>📄 Recibo · {dias} día(s) trabajado(s) · {lineas.length} parte(s) · {qqFmt(qq)} QQ</summary>
      <table>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={i}>
              <td>{l.fecha.split("-").reverse().join("/")}</td>
              <td>{l.maquina}</td>
              <td>{l.agricultor ?? "—"}</td>
              <td className="num">{qqFmt(l.qq)} QQ</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// Una fila de la matriz. memo: escribir en una celda solo vuelve a pintar SU fila.
const FilaNomina = memo(function FilaNomina({ fila: f, idx, edit, onEdit }: {
  fila: FilaMatriz; idx: number; edit: Edicion | undefined; onEdit: (clave: string, cambio: Partial<Edicion>) => void;
}) {
  const c = calcularFila(f, edit);
  const prod = f.parte_ids.length === 0 ? null
    : f.unidad === "QQ" ? `${qqFmt(f.qq)} QQ` : f.unidad === "DIA" ? `${f.dias} día(s)` : `${f.viajes} viaje(s)`;
  const celda = (col: Columna, valor: string, extra?: { placeholder?: string; title?: string; alerta?: boolean; disabled?: boolean }) => (
    <input data-celda={`${idx}:${col}`} type={col === "nota" ? "text" : "number"} min={col === "nota" ? undefined : 0} step={col === "nota" ? undefined : "0.01"}
      className={`nomMatriz__celda ${col === "nota" ? "nomMatriz__celda--nota" : ""} ${extra?.alerta ? "is-alerta" : ""}`}
      value={valor} placeholder={extra?.placeholder ?? (col === "nota" ? "" : "0.00")} title={extra?.title}
      disabled={extra?.disabled}
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
        {f.cargo && <small className="nomMatriz__sub">{f.cargo}</small>}
        <small className="nomMatriz__sub">{f.activo_nombre ?? "Sin máquina"}{f.activo_nombre ? ` · ${AREA_LABEL[f.area].split(" ").slice(1).join(" ")}` : ""}</small>
        {f.modalidad_fija && (
          <small className={f.sueldo_semanal_pagado ? "nomMatriz__sub" : "nomMatriz__fijo"}>
            {f.sueldo_semanal_pagado
              ? "✓ Sueldo de esta semana pagado"
              : f.sueldo_semanal_principal
                ? `Sueldo semanal ${money(f.sueldo_semanal)}`
                : f.periodo_semanal ? "Sueldo incluido en otra fila" : "Elige un periodo semanal para pagar sueldo"}
          </small>
        )}
      </td>
      <td className="nomMatriz__prod">
        {prod ? <>{prod}{f.modalidad_fija
          ? <small className="nomMatriz__sub">Pago fijo semanal</small>
          : f.sin_tarifa
            ? <small className="nomMatriz__alerta">⚠️ sin tarifa</small>
            : <small className="nomMatriz__sub">× {money(f.tarifa ?? 0)} / {unidadCorta(f.unidad)}{f.tarifa_de_maquina ? ` (tarifa de ${f.tarifa_de_maquina})` : ""}</small>}</>
          : <span className="muted">—</span>}
        {f.modalidad_fija && f.produccion_sugerida != null && <small className="nomMatriz__sub">Referencia por producción: {money(f.produccion_sugerida)}</small>}
        {(f.detalle?.length ?? 0) > 0 && (
          <details className="nomMatriz__recibo">
            <summary>📄 Recibo · {f.dias} día(s) · {f.detalle!.length} parte(s)</summary>
            <table>
              <tbody>
                {f.detalle!.map((d, i) => (
                  <tr key={i}>
                    <td>{d.fecha.split("-").reverse().join("/")}</td>
                    <td>{d.agricultor ?? "—"}</td>
                    <td className="num">{qqFmt(d.qq)} QQ</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </td>
      <td className="num">{celda("base", c.baseTxt, {
        alerta: c.pideNota,
        title: f.modalidad_fija ? `Sueldo configurado: ${money(f.sueldo_semanal)}` : f.sugerido != null ? `Sugerido: ${money(f.sugerido)}` : undefined,
        placeholder: f.parte_ids.length || f.modalidad_fija ? "0.00" : "—",
        disabled: f.modalidad_fija && !f.sueldo_semanal_principal
      })}</td>
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
  cargo: string | null; es_sueldo_semanal: boolean;
  cuenta_nombre: string | null; anulado_at: string | null; anulado_motivo: string | null;
};
type VistaNomina = "semana" | "ajustes" | "historial";

export default function NominaOperadores() {
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [rango, setRango] = useState(() => rangoDe("semana"));
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
  const [vista, setVista] = useState<VistaNomina>("semana");
  const [previewScope, setPreviewScope] = useState<"semana" | "ajustes" | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 4000); };

  const cambiarPeriodo = (p: Periodo) => { setPeriodo(p); if (p !== "personalizado") setRango(rangoDe(p)); };

  const cargar = useCallback(async () => {
    try {
      setBusy(true);
      const qs = new URLSearchParams();
      if (rango.from && !conAnteriores) qs.set("from", rango.from);
      if (rango.to) qs.set("to", rango.to);
      if (rango.from) qs.set("periodo_desde", rango.from);
      if (rango.to) qs.set("periodo_hasta", rango.to);
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

  // El sueldo fijo debe asignarse una sola vez por persona antes de filtrar por
  // area. Asi la vista simple y Ajustes avanzados siempre suman lo mismo.
  const filasPreparadas = useMemo(() => {
    const sueldoAsignado = new Set<string>();
    return filas.map((f) => {
      if (!f.modalidad_fija) return f;
      const claveOperador = f.operador_id ?? f.operador.trim().toLowerCase();
      const principal = f.periodo_semanal && !f.sueldo_semanal_pagado && !sueldoAsignado.has(claveOperador);
      if (principal) sueldoAsignado.add(claveOperador);
      return { ...f, sueldo_semanal_principal: principal, sugerido: principal ? f.sueldo_semanal : 0 };
    });
  }, [filas]);
  const visibles = useMemo(() => filasPreparadas.filter((f) => area === "todas" || f.area === area), [filasPreparadas, area]);
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

  const gruposSemana = useMemo(() => {
    const mapa = new Map<string, { clave: string; operador: string; cargo: string | null; filas: FilaMatriz[] }>();
    for (const f of filasPreparadas) {
      const clave = f.operador_id ?? f.operador.trim().toLowerCase();
      const actual = mapa.get(clave);
      if (actual) actual.filas.push(f);
      else mapa.set(clave, { clave, operador: f.operador, cargo: f.cargo, filas: [f] });
    }
    return [...mapa.values()].map((g) => {
      const calculos = g.filas.map((f) => ({ f, c: calcularFila(f, edits[f.clave]) }));
      const areas = [...new Set(g.filas.map((f) => AREA_LABEL[f.area]))];
      const maquinas = [...new Set(g.filas.map((f) => f.activo_nombre).filter((v): v is string => !!v))];
      const base = r2(calculos.reduce((s, x) => s + (x.c.incluida ? x.c.base : 0), 0));
      const extras = r2(calculos.reduce((s, x) => s + (x.c.incluida ? x.c.extras : 0), 0));
      const descuentos = r2(calculos.reduce((s, x) => s + (x.c.incluida ? x.c.descuentos : 0), 0));
      const total = r2(calculos.reduce((s, x) => s + (x.c.incluida ? x.c.total : 0), 0));
      const incluida = calculos.some((x) => x.c.incluida);
      const puedeIncluir = calculos.some((x) => x.c.sugeridaIncluir);
      const error = calculos.find((x) => x.c.error)?.c.error ?? "";
      const principal = g.filas.find((f) => f.sueldo_semanal_principal) ?? g.filas[0];
      return { ...g, calculos, areas, maquinas, base, extras, descuentos, total, incluida, puedeIncluir, error, principal };
    });
  }, [filasPreparadas, edits]);

  const resumenSemana = useMemo(() => {
    const incluidos = gruposSemana.filter((g) => g.incluida);
    return {
      personas: incluidos.length,
      base: r2(incluidos.reduce((s, g) => s + g.base, 0)),
      extras: r2(incluidos.reduce((s, g) => s + g.extras, 0)),
      descuentos: r2(incluidos.reduce((s, g) => s + g.descuentos, 0)),
      total: r2(incluidos.reduce((s, g) => s + g.total, 0)),
      errores: incluidos.filter((g) => g.error).length
    };
  }, [gruposSemana]);

  function cambiarInclusionGrupo(filasGrupo: FilaMatriz[], incluir: boolean) {
    setEdits((prev) => {
      const next = { ...prev };
      for (const f of filasGrupo) next[f.clave] = { ...next[f.clave], excluir: !incluir };
      return next;
    });
  }

  function cambiarExtraGrupo(filasGrupo: FilaMatriz[], principal: FilaMatriz, valor: string) {
    setEdits((prev) => {
      const next = { ...prev };
      for (const f of filasGrupo) {
        const actual = { ...next[f.clave] };
        actual.extras = f.clave === principal.clave ? valor : "";
        next[f.clave] = actual;
      }
      return next;
    });
  }

  const filasPreview = previewScope === "semana" ? filasPreparadas : previewScope === "ajustes" ? visibles : [];
  const lotePreview = filasPreview.map((f) => ({ f, c: calcularFila(f, edits[f.clave]) })).filter(({ c }) => c.incluida);
  const totalPreview = r2(lotePreview.reduce((s, x) => s + x.c.total, 0));

  function abrirPreview(scope: "semana" | "ajustes") {
    if (!cuentaId) { notify("Selecciona la cuenta desde la que se pagará la nómina.", "err"); return; }
    const base = scope === "semana" ? filasPreparadas : visibles;
    const lote = base.map((f) => ({ f, c: calcularFila(f, edits[f.clave]) })).filter(({ c }) => c.incluida);
    if (!lote.length) { notify("No hay pagos seleccionados. Revisa los trabajadores y sus montos.", "err"); return; }
    const conError = lote.find(({ c }) => c.error);
    if (conError) { notify(`${conError.f.operador}: ${conError.c.error}.`, "err"); return; }
    setPreviewScope(scope);
  }

  async function procesarConfirmado() {
    const lote = lotePreview;
    if (!lote.length || !previewScope) { setPreviewScope(null); return; }
    try {
      setBusy(true);
      const r = await apiPost<{ total: number; pagos: unknown[] }>("/campo/nomina-operadores/lote", {
        cuenta_id: cuentaId, desde: rango.from || undefined, hasta: rango.to || undefined,
        filas: lote.map(({ f, c }) => ({
          operador_id: f.operador_id, operador: f.operador, activo_id: f.activo_id, parte_ids: f.parte_ids,
          base: c.base, extras: c.extras, descuentos: c.descuentos,
          es_sueldo_semanal: f.sueldo_semanal_principal,
          // Los vales se rinden solo si el descuento los cubre; si no, quedan pendientes.
          vale_ids: c.valesCubiertos ? f.vales.map((v) => v.id) : [],
          nota: c.nota.trim() || undefined
        }))
      });
      notify(`Nómina procesada: ${r.pagos.length} pago(s) por ${money(r.total)} ✓`);
      setPreviewScope(null);
      await cargar();
    } catch (e) { notify((e as Error).message, "err"); } finally { setBusy(false); }
  }

  async function anularPago(p: PagoHist) {
    const motivo = (await pedirTexto(`Anular el pago de ${money(p.monto)} a ${p.operador}.

El dinero vuelve a ${p.cuenta_nombre ?? "la cuenta"}, sus partes quedan sin pagar y los vales que descontó vuelven a pendientes.

Motivo (obligatorio):`, ""));
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
      <div className="tablePanel" style={{ gridColumn: "1 / -1", paddingBottom: 8 }}>
        <div className="nomMatriz__barra">
          <div>
            <h2 style={{ margin: 0 }}>💵 Nómina de Transporte y Cosechadora</h2>
            <p className="muted" style={{ margin: "3px 0 0" }}>Pago semanal con el mismo flujo claro de la Matriz, conservando producción, vales y ajustes.</p>
          </div>
          <button type="button" onClick={cargar} disabled={busy}>{busy ? "Cargando…" : "↻ Actualizar"}</button>
        </div>
        <nav className="cajaSubNav campoNomina__nav">
          <button type="button" className={vista === "semana" ? "active" : ""} onClick={() => {
            setVista("semana"); setArea("todas");
            if (periodo !== "semana" && periodo !== "semana_ant") cambiarPeriodo("semana");
          }}>🗓️ Pagar la semana</button>
          <button type="button" className={vista === "ajustes" ? "active" : ""} onClick={() => setVista("ajustes")}>✎ Ajustes avanzados</button>
          <button type="button" className={vista === "historial" ? "active" : ""} onClick={() => setVista("historial")}>📜 Historial de pagos</button>
        </nav>
      </div>

      {vista === "semana" && (
        <div className="semana campoNomina__semana" style={{ gridColumn: "1 / -1" }}>
          <div className="semana-head">
            <div>
              <h3 className="semana-title">🗓️ Pagar la semana</h3>
              <p className="semana-sub">Revisa el sueldo, los adicionales y los descuentos antes de confirmar. El pago completo se guarda en una sola operación.</p>
            </div>
            <div className="campoNomina__semanaControles">
              <label>Semana
                <select value={periodo === "semana_ant" ? "semana_ant" : "semana"} onChange={(e) => cambiarPeriodo(e.target.value as "semana" | "semana_ant")}>
                  <option value="semana">Semana actual</option>
                  <option value="semana_ant">Semana anterior</option>
                </select>
              </label>
              <span className="nomMatriz__rango">{rango.from.split("-").reverse().join("/")} → {rango.to.split("-").reverse().join("/")}</span>
              <label>Pagar desde
                <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>
                  <option value="">Seleccione cuenta</option>
                  {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({money(c.saldo)})</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="semana-kpis">
            <div><span>Trabajadores</span><b>{resumenSemana.personas}</b></div>
            <div><span>Sueldo / Producción</span><b>{money(resumenSemana.base)}</b></div>
            <div><span>Adicionales</span><b>{money(resumenSemana.extras)}</b></div>
            <div><span>Vales / Descuentos</span><b className={resumenSemana.descuentos > 0 ? "neg" : ""}>{money(resumenSemana.descuentos)}</b></div>
            <div className="semana-kpi-total"><span>Total a pagar</span><b>{money(resumenSemana.total)}</b></div>
          </div>
          {resumenSemana.errores > 0 && <p className="semana-aviso semana-aviso--warn">Hay {resumenSemana.errores} trabajador(es) que requieren una nota o corrección antes de pagar.</p>}
          <div className="campoNomina__lista">
            {gruposSemana.length === 0 && <div className="emptyState"><p>{busy ? "Cargando nómina…" : "No hay trabajadores activos."}</p></div>}
            {gruposSemana.map((g) => (
              <article key={g.clave} className={`campoNomina__persona ${g.error ? "is-error" : ""} ${g.incluida ? "" : "is-fuera"}`}>
                <label className="campoNomina__personaCheck" title={g.puedeIncluir ? "Incluir en el pago semanal" : "Este trabajador no tiene valores pendientes"}>
                  <input type="checkbox" checked={g.incluida} disabled={!g.puedeIncluir} onChange={(e) => cambiarInclusionGrupo(g.filas, e.target.checked)} />
                </label>
                <div className="campoNomina__identidad">
                  <strong>{g.operador}</strong>
                  <small>{g.cargo || "Operador"} · {g.areas.join(" / ")}</small>
                  <small>{g.maquinas.length ? g.maquinas.join(", ") : "Sin máquina asignada"}</small>
                </div>
                <div className="campoNomina__monto"><span>Ganó</span><b>{money(g.base)}</b></div>
                <label className="campoNomina__adicional"><span>Adicional / Bono</span>
                  <input type="number" min="0" step="0.01" value={g.extras ? String(g.extras) : ""} placeholder="0.00"
                    onChange={(e) => cambiarExtraGrupo(g.filas, g.principal, e.target.value)} />
                </label>
                <div className="campoNomina__monto campoNomina__descuento"><span>Vales / Desc.</span><b>{g.descuentos > 0 ? `−${money(g.descuentos)}` : "—"}</b></div>
                <div className="campoNomina__monto campoNomina__neto"><span>A pagar</span><b>{money(g.total)}</b></div>
                <button type="button" className="btnGhost" onClick={() => { setVista("ajustes"); setArea("todas"); }} title="Ver producción, descuentos y notas">Revisar</button>
                {g.error && <small className="nomMatriz__alerta campoNomina__error">{g.error}</small>}
                <ReciboOperador filas={g.filas} />
              </article>
            ))}
          </div>
          <div className="semana-acciones">
            <button type="button" className="semana-pagar" disabled={busy || resumenSemana.personas === 0 || resumenSemana.errores > 0} onClick={() => abrirPreview("semana")}>
              Revisar y pagar · {money(resumenSemana.total)}
            </button>
            <small className="muted">Nada se descuenta hasta confirmar la vista previa.</small>
          </div>
        </div>
      )}

      {vista === "ajustes" && (<>
        <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
          <div className="nomMatriz__barra">
            <div><h3 style={{ margin: 0 }}>✎ Ajustes avanzados</h3><p className="muted" style={{ margin: "3px 0 0" }}>Producción, vales, descuentos y notas por máquina.</p></div>
            <div className="nomMatriz__filtros">
              <label>Periodo de pago<select value={periodo} onChange={(e) => cambiarPeriodo(e.target.value as Periodo)}>{PERIODOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
              {periodo === "personalizado" ? <><label>Desde<input type="date" value={rango.from} onChange={(e) => setRango({ ...rango, from: e.target.value })} /></label><label>Hasta<input type="date" value={rango.to} onChange={(e) => setRango({ ...rango, to: e.target.value })} /></label></> : <span className="nomMatriz__rango">{rango.from.split("-").reverse().join("/")} → {rango.to.split("-").reverse().join("/")}</span>}
              <label className="nomMatriz__anteriores" title="Partes no pagados de antes del periodo (se deben igual)"><span><input type="checkbox" checked={conAnteriores} onChange={(e) => setConAnteriores(e.target.checked)} /> Incluir pendientes anteriores</span></label>
              <label>Área<select value={area} onChange={(e) => setArea(e.target.value as "todas" | Area)}><option value="todas">Todas</option><option value="cosechadora">🌾 Cosechadora</option><option value="transporte">🚛 Transporte</option><option value="otro">Sin máquina</option></select></label>
              <label>Pagar desde<select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}><option value="">Seleccione cuenta</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({money(c.saldo)})</option>)}</select></label>
            </div>
          </div>
        </div>
        <div className="tablePanel nomMatriz" style={{ gridColumn: "1 / -1" }}>
          <div className="nomMatriz__scroll"><table className="nomMatriz__tabla">
            <thead><tr><th className="nomMatriz__check" title="Incluir en el lote">✓</th><th>Operador</th><th>Producción</th><th className="num">Sueldo semanal / Base</th><th className="num">Adicional / Bonos</th><th className="num">Vales / Descuentos</th><th className="num">Total a Pagar</th><th>Nota</th></tr></thead>
            <tbody>{visibles.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 16 }}>{busy ? "Cargando…" : "No hay operadores activos ni partes pendientes en este periodo."}</td></tr>}{visibles.map((f, i) => <FilaNomina key={f.clave} fila={f} idx={i} edit={edits[f.clave]} onEdit={onEdit} />)}</tbody>
            {visibles.length > 0 && <tfoot><tr><td></td><td colSpan={2}>{resumen.incluidas} a pagar{resumen.errores ? <span className="nomMatriz__alerta"> · {resumen.errores} con error</span> : ""}</td><td className="num">{money(resumen.base)}</td><td className="num">{money(resumen.extras)}</td><td className="num">{money(resumen.descuentos)}</td><td className="num nomMatriz__total">{money(resumen.total)}</td><td></td></tr></tfoot>}
          </table></div>
          <div className="nomMatriz__acciones"><small className="muted">Si una fila falla, no se paga ninguna.</small><button type="button" className="primary" disabled={busy || resumen.incluidas === 0 || resumen.errores > 0} onClick={() => abrirPreview("ajustes")}>{busy ? "Procesando…" : `Revisar pago · ${money(resumen.total)}`}</button></div>
        </div>
      </>)}

      {vista === "historial" && <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <h3 style={{ margin: "0 0 8px" }}>📜 Historial de pagos de nómina</h3>
        <div className="nomMatriz__scroll">
          <table className="nomMatriz__tabla nomHist">
            <thead><tr><th>Fecha</th><th>Operador</th><th>Máquina</th><th className="num">Partes</th><th className="num">Monto</th><th>Cuenta</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {pagos.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 12 }}>Aún no hay pagos de nómina.</td></tr>}
              {pagos.map((p) => (
                <tr key={p.id} style={p.anulado_at ? { opacity: 0.55 } : undefined}>
                  <td>{String(p.created_at).slice(0, 10).split("-").reverse().join("/")}</td>
                  <td>{p.operador}</td>
                  <td>{p.es_sueldo_semanal ? <span className="chip info">Sueldo semanal</span> : p.activo_nombre ?? "—"}</td>
                  <td className="num">{p.partes_count}</td>
                  <td className="num">{money(p.monto)}</td>
                  <td>{p.cuenta_nombre ?? "—"}</td>
                  <td>{p.anulado_at ? <span title={p.anulado_motivo ?? ""}>Anulado</span> : "Pagado"}</td>
                  <td>{!p.anulado_at && esAdministrador() && <button type="button" disabled={busy} onClick={() => anularPago(p)}>Anular</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}

      {previewScope && (
        <div className="modalOverlay" onClick={() => !busy && setPreviewScope(null)}>
          <div className="modalCard semana-modal" onClick={(e) => e.stopPropagation()}>
            <div className="nomMatriz__barra"><div><h3 style={{ margin: 0 }}>Revisar pago de nómina</h3><p className="muted" style={{ margin: "3px 0 0" }}>{rango.from.split("-").reverse().join("/")} → {rango.to.split("-").reverse().join("/")}</p></div><button type="button" className="btnGhost" disabled={busy} onClick={() => setPreviewScope(null)}>✕</button></div>
            <div className="semana-detalle">
              {lotePreview.map(({ f, c }) => <div className="semana-fila" key={f.clave}><span><strong>{f.operador}</strong><small style={{ display: "block" }}>{f.sueldo_semanal_principal ? "Sueldo semanal" : f.activo_nombre ?? "Adicional"}</small></span><b>{money(c.total)}</b></div>)}
            </div>
            <div className="semana-total"><span>Total a pagar</span><b>{money(totalPreview)}</b></div>
            <p className="semana-aviso semana-aviso--info">Se registrará desde <strong>{cuentas.find((c) => c.id === cuentaId)?.nombre ?? "la cuenta seleccionada"}</strong>. Los partes quedarán pagados y los vales incluidos quedarán rendidos.</p>
            <div className="buttonRow" style={{ marginTop: 12 }}><button type="button" className="semana-pagar" disabled={busy} onClick={procesarConfirmado}>{busy ? "Procesando…" : `Confirmar pago · ${money(totalPreview)}`}</button><button type="button" disabled={busy} onClick={() => setPreviewScope(null)}>Volver</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
