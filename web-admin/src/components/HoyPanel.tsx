// 📌 «Hoy»: lista corta de lo que hay que hacer ahora (arriba del Dashboard).
// El servidor decide las tareas (GET /dashboard/hoy); aquí solo se muestran y cada
// botón lleva a la pantalla donde se resuelve. Las tareas de pestañas a las que el
// usuario no tiene permiso se ocultan en App.tsx antes de llegar aquí.

export type TareaHoy = {
  key: string;
  nivel: "urgente" | "atencion" | "info";
  icono: string;
  titulo: string;
  detalle: string;
  tab: string;
  sub?: string;
  accion: string;
};

const ETIQUETA: Record<TareaHoy["nivel"], string> = { urgente: "Urgente", atencion: "Atención", info: "Para saber" };

export function HoyPanel({ tareas, cargando, error, onIr, onRefrescar }: {
  /** null = aún no se ha cargado. */
  tareas: TareaHoy[] | null;
  cargando: boolean;
  error: boolean;
  onIr: (t: TareaHoy) => void;
  onRefrescar: () => void;
}) {
  const fecha = new Date().toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long" }).replace(/^./, (c) => c.toUpperCase());
  const pendientes = tareas?.filter((t) => t.nivel !== "info").length ?? 0;
  return (
    <section className="hoy" aria-label="Qué hacer hoy">
      <header className="hoy-head">
        <div>
          <h2 className="hoy-title">📌 Hoy</h2>
          <p className="hoy-sub">
            <span className="hoy-fecha">{fecha}</span>
            {tareas && (pendientes > 0
              ? <> · <strong>{pendientes}</strong> {pendientes === 1 ? "cosa por atender" : "cosas por atender"}</>
              : tareas.length === 0 ? <> · todo al día</> : <> · nada urgente</>)}
          </p>
        </div>
        <button type="button" className="hoy-refresh" onClick={onRefrescar} disabled={cargando} aria-label="Actualizar la lista de hoy" title="Actualizar">
          <span className={cargando ? "hoy-spin" : undefined} aria-hidden="true">↻</span>
        </button>
      </header>

      {tareas === null && !error && <p className="hoy-vacio" role="status">Cargando…</p>}
      {error && tareas === null && (
        <p className="hoy-vacio hoy-vacio--error" role="alert">No se pudo cargar la lista. <button type="button" className="hoy-link" onClick={onRefrescar}>Reintentar</button></p>
      )}
      {tareas && tareas.length === 0 && (
        <p className="hoy-vacio hoy-vacio--ok" role="status">✅ No hay nada pendiente. Buen trabajo.</p>
      )}
      {tareas && tareas.length > 0 && (
        <ul className="hoy-lista">
          {tareas.map((t) => (
            <li key={t.key} className={`hoy-item hoy-item--${t.nivel}`}>
              <span className="hoy-ico" aria-hidden="true">{t.icono}</span>
              <div className="hoy-texto">
                <div className="hoy-titulo">
                  {t.titulo}
                  <span className={`hoy-chip hoy-chip--${t.nivel}`}>{ETIQUETA[t.nivel]}</span>
                </div>
                <div className="hoy-detalle">{t.detalle}</div>
              </div>
              <button type="button" className="hoy-btn" onClick={() => onIr(t)}>{t.accion} <span aria-hidden="true">›</span></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
