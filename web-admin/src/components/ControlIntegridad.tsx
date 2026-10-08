import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../api";

// 🩺 Configuración → Estado del sistema → «Control de integridad».
// Revisa que los módulos estén bien conectados entre sí (caja ↔ cuentas ↔ liquidaciones ↔ inventario ↔
// Transporte ↔ nómina ↔ banco). Solo LEE: nunca corrige nada. Si algo falla, muestra qué y un ejemplo.

type Hallazgo = { regla: string; modulo: string; total?: number; filas?: Array<Record<string, unknown>>; error?: string };
type Resultado = { reglas: number; hallazgos: Hallazgo[]; revisado_at: string; ms: number; ok: boolean };

export function ControlIntegridad({ avisar }: { avisar: (msg: string, tipo?: "success" | "error" | "warn") => void }) {
  const [r, setR] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);

  const revisar = useCallback(async (forzar: boolean) => {
    setCargando(true);
    try { setR(await apiGet<Resultado>(`/integridad${forzar ? "?forzar=1" : ""}`)); }
    catch (e) { avisar((e as Error).message || "No se pudo revisar la integridad", "error"); }
    finally { setCargando(false); }
  }, [avisar]);
  useEffect(() => { revisar(false); }, [revisar]);

  const fallas = (r?.hallazgos ?? []).filter((h) => !h.error);
  const sinCorrer = (r?.hallazgos ?? []).filter((h) => h.error);
  return (
    <div className="controlIntegridad" style={{ margin: "14px 0", padding: 14, borderRadius: 12, border: "1px solid var(--c-border, #e2e8f0)", background: "var(--c-surface, #fff)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>🩺 Control de integridad</h3>
        <button type="button" style={{ marginLeft: "auto" }} onClick={() => revisar(true)} disabled={cargando}>
          {cargando ? "Revisando…" : "↻ Revisar ahora"}
        </button>
      </div>
      <p className="muted" style={{ margin: "6px 0 10px", fontSize: 12.5 }}>
        Comprueba que caja, cuentas por cobrar y pagar, liquidaciones, inventario, Transporte, nómina y banco estén bien conectados entre sí. Solo lee: no cambia nada.
      </p>
      {!r && <p className="muted">{cargando ? "Revisando…" : "Sin resultado todavía."}</p>}
      {r && fallas.length === 0 && (
        <p style={{ margin: 0, padding: "8px 12px", borderRadius: 8, background: "#dcfce7", color: "#15803d", fontWeight: 600 }}>
          ✅ Todo conectado: {r.reglas} controles sin problemas
          <span style={{ fontWeight: 400 }}> · revisado {new Date(r.revisado_at).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })} ({r.ms} ms)</span>
        </p>
      )}
      {fallas.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, padding: "8px 12px", borderRadius: 8, background: "#fee2e2", color: "#b91c1c", fontWeight: 700 }}>
            ⚠️ {fallas.length} de {r!.reglas} controles fallan. Avisa a quien te da soporte con este detalle antes de seguir registrando lo relacionado.
          </p>
          {fallas.map((h) => (
            <details key={h.regla} style={{ border: "1px solid #fecaca", borderRadius: 8, padding: "6px 10px", background: "#fff7f7" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                <span className="chip" style={{ marginRight: 6 }}>{h.modulo}</span>{h.regla} <span className="muted">({h.total} caso{h.total === 1 ? "" : "s"})</span>
              </summary>
              <pre style={{ margin: "6px 0 0", fontSize: 11.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(h.filas, null, 1)}</pre>
            </details>
          ))}
        </div>
      )}
      {sinCorrer.length > 0 && (
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
          {sinCorrer.length} control(es) no pudieron correr (no cuentan como falla): {sinCorrer.map((h) => h.regla).join(" · ")}
        </p>
      )}
    </div>
  );
}
