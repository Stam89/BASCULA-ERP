import { duracionTexto, type ResultadoRevision } from "./revisarFinalizacion";

// Ventana «Confirmar finalización» de un túnel de secado: dice en grande QUÉ túnel se
// cierra (motor, lotes, quintales, horas) y muestra los avisos de la revisión previa.
// Si hay algo raro exige marcar «confirmo»; si algo es imposible, no deja finalizar.

const ICONO = { bloqueo: "⛔", confirmar: "⚠️", info: "ℹ️" } as const;

const fechaHora = (v: string) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString("es-EC", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";
};

export function ConfirmarFinalizacion({ tunel, motor, lotes, quintales, partidas, inicio, fin, revision, tick, onTick, ocupado, onCancelar, onConfirmar }: {
  tunel: number;
  motor: number;
  lotes: string[];
  quintales: number;
  /** Cuántas partidas (propio + servicio) se cierran juntas en este túnel. */
  partidas: number;
  /** Horas tal cual están en el formulario (datetime-local). */
  inicio: string;
  fin: string;
  revision: ResultadoRevision;
  tick: boolean;
  onTick: (v: boolean) => void;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const puede = !ocupado && !revision.bloqueado && (!revision.requiereConfirmar || tick);
  return (
    <div className="modalOverlay" onClick={() => { if (!ocupado) onCancelar(); }}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540, width: "100%" }} role="dialog" aria-modal="true" aria-labelledby="drying-finalize-title">
        <h3 id="drying-finalize-title" style={{ marginTop: 0, marginBottom: 8 }}>Confirmar finalización</h3>
        <div className="finConf-id" aria-live="polite">
          <span className="finConf-tunel">TÚNEL {tunel}</span>
          <span className="finConf-motor">Motor {motor}</span>
        </div>
        <dl className="finConf-datos">
          <div><dt>Lote{lotes.length === 1 ? "" : "s"}</dt><dd>{lotes.length ? lotes.join(", ") : "—"}</dd></div>
          <div><dt>Quintales</dt><dd>{quintales.enReal()} QQ</dd></div>
          <div><dt>Entró a secar</dt><dd>{fechaHora(inicio)}</dd></div>
          <div><dt>Terminó</dt><dd>{fechaHora(fin)}</dd></div>
          <div className="finConf-dur"><dt>Duración</dt><dd>{revision.horas != null && revision.horas > 0 ? duracionTexto(revision.horas) : "—"}</dd></div>
        </dl>
        <ul className="finConf-avisos">
          {revision.avisos.map((a, i) => (
            <li key={i} className={`finConf-aviso finConf-aviso--${a.nivel}`}><span aria-hidden="true">{ICONO[a.nivel]}</span><span>{a.texto}</span></li>
          ))}
        </ul>
        {revision.requiereConfirmar && !revision.bloqueado && (
          <label className="finConf-tick">
            <input type="checkbox" checked={tick} onChange={(e) => onTick(e.target.checked)} />
            <span>Sí, confirmo que el <strong>Túnel {tunel}</strong> es el que terminó y que las horas son correctas.</span>
          </label>
        )}
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, margin: "10px 0 0" }}>
          {partidas > 1
            ? `Se cerrarán sus ${partidas} partidas al mismo tiempo: el arroz propio pasará a inventario/Producción y el servicio a su cobro.`
            : "Los quintales pasarán a inventario o facturación."}{" "}
          Si te equivocas, el administrador puede reabrir el túnel.
        </p>
        <div className="buttonRow" style={{ marginTop: 14 }}>
          <button type="button" onClick={onCancelar} disabled={ocupado}>{revision.bloqueado ? "Volver y corregir" : "Cancelar"}</button>
          <button type="button" className="primary" style={{ background: puede ? "var(--c-success)" : "#9ca3af", fontWeight: 800 }} disabled={!puede} onClick={onConfirmar}>
            {ocupado ? "Finalizando…" : `Sí, finalizar el Túnel ${tunel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
