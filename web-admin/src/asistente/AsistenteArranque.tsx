import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../api";
import { TEXTO_DESTINO, evaluarPasos, type Chequeo, type Destino, type PasoEvaluado } from "./pasos";

// 🧭 Asistente de puesta en marcha: una guía paso a paso con lo que ya revisa el servidor
// (GET /settings/company-readiness). Marca solo lo que está listo, resalta el SIGUIENTE
// paso con su explicación y un botón que lleva a la tarjeta donde se hace. No cambia nada
// por sí mismo: solo lee y navega.

type Respuesta = { checks: Chequeo[]; extra?: Chequeo[] };
const ICONO = { listo: "✅", parcial: "🟡", pendiente: "🟠" } as const;
const ETIQUETA = { listo: "Listo", parcial: "En curso", pendiente: "Pendiente" } as const;

function ItemsDelPaso({ paso }: { paso: PasoEvaluado }) {
  return (
    <ul className="asist-items">
      {paso.items.map((c) => (
        <li key={c.key} className={c.ok ? "ok" : "falta"}>
          <span aria-hidden="true">{c.ok ? "✓" : "•"}</span>
          <span><strong>{c.label}</strong><small>{c.detail}</small></span>
        </li>
      ))}
    </ul>
  );
}

export function AsistenteArranque({ onIr }: {
  /** Lleva a la tarjeta de Configuración donde se hace ese paso (App.tsx). */
  onIr: (destino: Destino) => void;
}) {
  const [datos, setDatos] = useState<Chequeo[] | null>(null);
  const [error, setError] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiGet<Respuesta>("/settings/company-readiness");
      setDatos([...r.checks, ...(r.extra ?? [])]);
      setError(false);
    } catch { setError(true); }
    finally { setCargando(false); }
  }, []);

  // Al abrir y cada vez que se vuelve a esta ventana (después de hacer un paso en otra tarjeta).
  useEffect(() => {
    cargar().catch(() => undefined);
    const alVolver = () => { if (!document.hidden) cargar().catch(() => undefined); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [cargar]);

  if (error && !datos) {
    return <p className="asist-vacio" role="alert">No se pudo leer el estado de la puesta en marcha. <button type="button" className="hoy-link" onClick={() => { cargar().catch(() => undefined); }}>Reintentar</button></p>;
  }
  if (!datos) return <p className="asist-vacio" role="status">Revisando tu configuración…</p>;

  const av = evaluarPasos(datos);
  const sig = av.siguiente;

  return (
    <section className="asist" aria-label="Asistente de puesta en marcha">
      <header className="asist-head">
        <div>
          <span className="readinessEyebrow">Asistente</span>
          <h3 className="asist-title">{av.completo ? "¡Todo lo obligatorio está listo!" : "Te guío paso a paso"}</h3>
          <p className="asist-sub">{av.listos} de {av.total} pasos listos · {av.porcentaje} %</p>
        </div>
        <button type="button" className="btnSecondary" disabled={cargando} onClick={() => { cargar().catch(() => undefined); }}>{cargando ? "Revisando…" : "↻ Revisar de nuevo"}</button>
      </header>
      <div className="asist-barra" role="progressbar" aria-valuenow={av.porcentaje} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la puesta en marcha"><span style={{ width: `${av.porcentaje}%` }} /></div>

      {sig ? (
        <div className={`asist-siguiente${av.completo ? " asist-siguiente--opcional" : ""}`}>
          <div className="asist-sig-top">
            <span className="asist-sig-ico" aria-hidden="true">{sig.icono}</span>
            <div>
              <span className="asist-sig-etq">{av.completo ? "Si quieres, el siguiente (opcional)" : "Siguiente paso"}</span>
              <h4>{sig.titulo}</h4>
            </div>
          </div>
          <p className="asist-porque">{sig.porQue}</p>
          <ItemsDelPaso paso={sig} />
          <div className="asist-acciones">
            {sig.destinos.map((d, i) => (
              <button key={d} type="button" className={i === 0 ? "primary" : "btnSecondary"} onClick={() => onIr(d)}>{TEXTO_DESTINO[d]} ›</button>
            ))}
          </div>
        </div>
      ) : av.completo && (
        <div className="successBox"><strong>La empresa está lista para operar.</strong> Ya puedes trabajar con datos reales, crear respaldos y entregar usuarios.</div>
      )}

      <ol className="asist-lista">
        {av.pasos.map((p, i) => {
          const esSig = sig?.id === p.id;
          const estado = p.informativo ? "pendiente" : p.estado;
          return (
            <li key={p.id} className={`asist-paso asist-paso--${p.estado}${esSig ? " es-siguiente" : ""}`}>
              <button type="button" className="asist-paso-btn" aria-expanded={abierto === p.id} onClick={() => setAbierto(abierto === p.id ? null : p.id)}>
                <span className="asist-num" aria-hidden="true">{p.estado === "listo" ? "✓" : i + 1}</span>
                <span className="asist-paso-txt"><strong>{p.icono} {p.titulo}</strong></span>
                <span className={`asist-chip asist-chip--${p.informativo ? "info" : p.opcional && p.estado !== "listo" ? "opcional" : estado}`}>
                  {p.informativo ? "Al final" : p.opcional && p.estado !== "listo" ? "Opcional" : `${ICONO[estado]} ${ETIQUETA[estado]}`}
                </span>
              </button>
              {abierto === p.id && (
                <div className="asist-detalle">
                  <p className="asist-porque">{p.porQue}</p>
                  <ItemsDelPaso paso={p} />
                  {p.estado !== "listo" && p.destinos.length > 0 && (
                    <div className="asist-acciones">{p.destinos.map((d) => <button key={d} type="button" className="btnSecondary" onClick={() => onIr(d)}>{TEXTO_DESTINO[d]} ›</button>)}</div>
                  )}
                  {p.informativo && <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>Hoy el sistema está en modo prueba a propósito. Cuando quieras pasar a producción, se cambia con un ajuste en el servidor.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
