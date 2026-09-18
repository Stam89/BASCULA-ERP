// Nómina de Operadores de Campo (cosechadoras y transporte/fletes) y el
// mantenedor de Tarifas por operador+máquina que la alimenta.
import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiGet, apiPost } from "../api";
import { money } from "../format";

const hoy = () => new Date().toISOString().slice(0, 10);
const primeroDeMes = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
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
type Tarifa = { id: string; operador: string; activo_id: string; tarifa: number; unidad: "QQ" | "VIAJE"; activo: boolean; activo_nombre: string; activo_tipo: string };
type NominaGrupo = {
  operador: string; activo_id: string; activo_nombre: string; activo_tipo: string;
  viajes: number; qq: number; desde: string; hasta: string;
  unidad: "QQ" | "VIAJE"; tarifa: number | null; sin_tarifa: boolean; total: number | null; parte_ids: string[];
};

// ── Mantenedor de Tarifas de Operadores (usado en Configuración) ─────────────
export function TarifasOperadorCatalogo({ activos, operadores, onError, onChanged }: {
  activos: Activo[]; operadores: Operador[]; onError: (m: string) => void; onChanged?: (m: string) => void;
}) {
  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [f, setF] = useState({ operador: "", activo_id: "", tarifa: "", unidad: "QQ" as "QQ" | "VIAJE" });
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
    const val = window.prompt(`Nueva tarifa para ${t.operador} · ${t.activo_nombre} ($ por ${t.unidad === "QQ" ? "QQ" : "viaje"}):`, String(t.tarifa));
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
          <select value={f.unidad} onChange={(e) => setF({ ...f, unidad: e.target.value as "QQ" | "VIAJE" })}>
            <option value="QQ">$ / QQ</option>
            <option value="VIAJE">$ / Viaje</option>
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
              <td>{t.unidad === "QQ" ? "$ / QQ" : "$ / Viaje"}</td>
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

// ── Vista principal: Nómina de Operadores ────────────────────────────────────
export default function NominaOperadores() {
  const [rango, setRango] = useState({ from: primeroDeMes(), to: hoy() });
  const [grupos, setGrupos] = useState<NominaGrupo[]>([]);
  const [totalGeneral, setTotalGeneral] = useState(0);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const notify = (text: string, kind: "ok" | "err" = "ok") => { setFlash({ text, kind }); setTimeout(() => setFlash(null), 3000); };

  const cargar = useCallback(async () => {
    try {
      setBusy(true);
      const qs = new URLSearchParams();
      if (rango.from) qs.set("from", rango.from);
      if (rango.to) qs.set("to", rango.to);
      const data = await apiGet<{ grupos: NominaGrupo[]; total_general: number }>(`/campo/nomina-operadores?${qs.toString()}`);
      setGrupos(data.grupos); setTotalGeneral(data.total_general);
    } catch (e) { notify((e as Error).message, "err"); } finally { setBusy(false); }
  }, [rango.from, rango.to]);
  useEffect(() => { cargar(); }, [cargar]);

  async function liquidar(g: NominaGrupo) {
    if (g.sin_tarifa) { notify(`Asigna una tarifa a ${g.operador} · ${g.activo_nombre} en Configuración antes de liquidar.`, "err"); return; }
    const base = g.unidad === "QQ" ? `${qqFmt(g.qq)} QQ` : `${g.viajes} viaje(s)`;
    if (!window.confirm(`¿Liquidar a ${g.operador} (${g.activo_nombre}) por ${base} = ${money(g.total ?? 0)}?\n\nSe marcarán ${g.parte_ids.length} parte(s) como pagados al operador.`)) return;
    try {
      setBusy(true);
      await apiPost("/campo/nomina-operadores/liquidar", { parte_ids: g.parte_ids, monto: g.total ?? undefined });
      notify(`Liquidado ${g.operador}: ${money(g.total ?? 0)} ✓`);
      await cargar();
    } catch (e) { notify((e as Error).message, "err"); } finally { setBusy(false); }
  }

  return (
    <section className="panelGrid">
      {flash && <div className={`tablePanel`} style={{ gridColumn: "1 / -1", background: flash.kind === "ok" ? "#dcfce7" : "#fee2e2", color: flash.kind === "ok" ? "#15803d" : "#b91c1c", fontWeight: 600 }}>{flash.text}</div>}
      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>💵 Nómina de Operadores</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <label style={{ fontSize: 12 }}>Desde<br /><input type="date" value={rango.from} onChange={(e) => setRango({ ...rango, from: e.target.value })} /></label>
            <label style={{ fontSize: 12 }}>Hasta<br /><input type="date" value={rango.to} onChange={(e) => setRango({ ...rango, to: e.target.value })} /></label>
            <button type="button" onClick={cargar} disabled={busy}>↻ Actualizar</button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Agrupa los partes NO pagados al operador en el rango. Total = (QQ o viajes) × tarifa. Liquidar los marca como pagados para que no se repitan.</p>
      </div>

      <div className="tablePanel" style={{ gridColumn: "1 / -1" }}>
        <table className="cajaTable">
          <thead><tr>
            <th>Operador</th><th>Máquina</th><th style={{ textAlign: "right" }}>QQ</th><th style={{ textAlign: "right" }}>Viajes</th>
            <th style={{ textAlign: "right" }}>Tarifa</th><th style={{ textAlign: "right" }}>Total a pagar</th><th></th>
          </tr></thead>
          <tbody>
            {grupos.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 16 }}>Sin partes pendientes de pago en el rango.</td></tr>}
            {grupos.map((g) => (
              <tr key={`${g.operador}::${g.activo_id}`}>
                <td style={{ fontWeight: 600 }}>{g.operador}</td>
                <td>{g.activo_nombre} <span className="muted" style={{ fontSize: 11 }}>({g.activo_tipo})</span></td>
                <td style={{ textAlign: "right" }}>{qqFmt(g.qq)}</td>
                <td style={{ textAlign: "right" }}>{g.viajes}</td>
                <td style={{ textAlign: "right" }}>
                  {g.sin_tarifa
                    ? <span style={{ color: "#b91c1c", fontWeight: 700, fontSize: 12 }}>⚠️ sin tarifa</span>
                    : <>{money(g.tarifa ?? 0)} <span className="muted" style={{ fontSize: 11 }}>/ {g.unidad === "QQ" ? "QQ" : "viaje"}</span></>}
                </td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{g.total != null ? money(g.total) : "—"}</td>
                <td>
                  <button type="button" className="primary" disabled={busy || g.sin_tarifa} onClick={() => liquidar(g)}>✅ Liquidar / Pagar</button>
                </td>
              </tr>
            ))}
          </tbody>
          {grupos.length > 0 && (
            <tfoot><tr style={{ fontWeight: 800, borderTop: "2px solid var(--c-border)" }}>
              <td colSpan={5} style={{ textAlign: "right" }}>TOTAL GENERAL</td>
              <td style={{ textAlign: "right" }}>{money(totalGeneral)}</td><td></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
