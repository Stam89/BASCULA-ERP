import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "../api";

// 📊 PARÁMETROS CONTABLES (Configuración → Operación y Planta). Una fila por
// accionista en financial_settings (GET/PUT /finance/settings, ya existentes):
// alimentan el Balance General y el Estado de Resultados de «Estados Financieros».
// Hasta ahora no había pantalla para editarlos (quedaban en 0 / sin fecha).

type Ajustes = {
  capital_social: string;
  resultados_acumulados: string;
  fecha_inicio_contable: string;
  precio_referencia_qq: string;
};

const VACIO: Ajustes = { capital_social: "0", resultados_acumulados: "0", fecha_inicio_contable: "", precio_referencia_qq: "0" };

function desdeServidor(r: Record<string, unknown>): Ajustes {
  const n = (v: unknown) => String(Number(v ?? 0) || 0);
  return {
    capital_social: n(r.capital_social),
    resultados_acumulados: n(r.resultados_acumulados),
    fecha_inicio_contable: r.fecha_inicio_contable ? String(r.fecha_inicio_contable).slice(0, 10) : "",
    precio_referencia_qq: n(r.precio_referencia_qq)
  };
}

/** Día siguiente a una fecha YYYY-MM-DD (sin husos horarios). */
function diaSiguiente(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}
const ddmmyyyy = (f: string) => f.split("-").reverse().join("/");

export function ParametrosContables({ accionistaNombre, puedeEditar, avisar, onSucio, irAEstados }: {
  accionistaNombre: string;
  puedeEditar: boolean;
  avisar: (msg: string, tipo?: "success" | "error" | "warn") => void;
  /** Avisa a Configuración si hay cambios sin guardar. */
  onSucio: (sucio: boolean) => void;
  /** Abre «Estados Financieros» (undefined si el usuario no lo ve). */
  irAEstados?: () => void;
}) {
  const [guardado, setGuardado] = useState<Ajustes | null>(null);
  const [form, setForm] = useState<Ajustes>(VACIO);
  const [corte, setCorte] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    apiGet<Record<string, unknown>>("/finance/settings")
      .then((r) => { if (!vivo) return; const a = desdeServidor(r); setGuardado(a); setForm(a); })
      .catch((e) => avisar(`No se pudieron leer los parámetros contables: ${e instanceof Error ? e.message : "error"}`, "error"));
    // Último corte de Saldos iniciales (para sugerir la fecha de inicio contable).
    apiGet<{ registros?: Array<{ corte: string; anulado_at?: string | null }> }>("/saldos-iniciales")
      .then((r) => {
        if (!vivo) return;
        const cortes = (r.registros ?? []).filter((x) => !x.anulado_at).map((x) => x.corte).sort();
        setCorte(cortes.length ? cortes[cortes.length - 1] : null);
      })
      .catch(() => undefined);
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sucio = useMemo(() => guardado != null && JSON.stringify(form) !== JSON.stringify(guardado), [form, guardado]);
  useEffect(() => { onSucio(sucio); }, [sucio, onSucio]);
  useEffect(() => () => onSucio(false), [onSucio]);

  const set = (k: keyof Ajustes) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const sugerida = corte ? diaSiguiente(corte) : null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const capital = Number(form.capital_social || 0);
    const acumulados = Number(form.resultados_acumulados || 0);
    const precio = Number(form.precio_referencia_qq || 0);
    if (!Number.isFinite(capital) || capital < 0) { avisar("El capital social no puede ser negativo", "error"); return; }
    if (!Number.isFinite(acumulados)) { avisar("Resultados acumulados no es un número válido", "error"); return; }
    if (!Number.isFinite(precio) || precio < 0) { avisar("El precio de referencia no puede ser negativo", "error"); return; }
    setGuardando(true);
    try {
      const r = await apiPut<Record<string, unknown>>("/finance/settings", {
        capital_social: capital,
        resultados_acumulados: acumulados,
        fecha_inicio_contable: form.fecha_inicio_contable || undefined,
        precio_referencia_qq: precio
      });
      const a = desdeServidor(r);
      setGuardado(a);
      setForm(a);
      avisar(`Parámetros contables de ${accionistaNombre} guardados`, "success");
    } catch (err) {
      avisar(`No se pudo guardar: ${err instanceof Error ? err.message : "error"}`, "error");
    } finally {
      setGuardando(false);
    }
  }

  if (!guardado) return <p className="muted" style={{ marginTop: 8 }}>Cargando…</p>;
  return (
    <form onSubmit={guardar} className="paramContables">
      <p className="muted" style={{ margin: "6px 0 10px" }}>
        Datos de apertura para los <strong>Estados Financieros de {accionistaNombre}</strong> (Balance General y
        Estado de Resultados). Cada accionista tiene los suyos.
        {irAEstados && <> <button type="button" className="vdTarifaLink" onClick={irAEstados}>📈 Ver Estados Financieros</button></>}
      </p>
      <div className="paramContables__grid">
        <label>
          <span>Capital social ($)</span>
          <input type="number" step="0.01" min="0" value={form.capital_social} onChange={set("capital_social")} disabled={!puedeEditar} />
          <small className="muted">Lo que los socios aportaron al negocio.</small>
        </label>
        <label>
          <span>Resultados acumulados ($)</span>
          <input type="number" step="0.01" value={form.resultados_acumulados} onChange={set("resultados_acumulados")} disabled={!puedeEditar} />
          <small className="muted">Utilidades de antes de usar el sistema (pérdidas en negativo).</small>
        </label>
        <label>
          <span>Fecha de inicio contable</span>
          <input type="date" value={form.fecha_inicio_contable} onChange={set("fecha_inicio_contable")} disabled={!puedeEditar} />
          <small className="muted">
            Desde este día el sistema es la fuente contable: el resultado del ejercicio se cuenta desde aquí.
            {sugerida && form.fecha_inicio_contable !== sugerida && puedeEditar && (
              <> <button type="button" className="vdTarifaLink" onClick={() => setForm((f) => ({ ...f, fecha_inicio_contable: sugerida }))}>
                Usar {ddmmyyyy(sugerida)} (día siguiente al corte de Saldos iniciales {ddmmyyyy(corte!)})
              </button></>
            )}
          </small>
        </label>
        <label>
          <span>Precio de referencia por QQ ($)</span>
          <input type="number" step="0.01" min="0" value={form.precio_referencia_qq} onChange={set("precio_referencia_qq")} disabled={!puedeEditar} />
          <small className="muted">Valoriza la cáscara en bodega mientras aún no hay liquidaciones con precio real.</small>
        </label>
      </div>
      <div className="buttonRow" style={{ marginTop: 10 }}>
        <button className="primary" disabled={!puedeEditar || !sucio || guardando}>{guardando ? "Guardando…" : "Guardar parámetros contables"}</button>
        {sucio && <button type="button" onClick={() => setForm(guardado)} disabled={guardando}>Descartar cambios</button>}
      </div>
      {!puedeEditar && <p className="muted">Solo un administrador puede cambiar estos datos.</p>}
    </form>
  );
}
