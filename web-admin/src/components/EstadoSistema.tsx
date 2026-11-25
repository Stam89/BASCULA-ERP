// 🩺 Configuración › Estado del sistema: lo que hay que atender primero, lo que está bien en tarjetas y la lista completa plegada.
import type { ReactNode } from "react";

export type Revision = { key: string; label: string; ok: boolean; detail: string };
export type AccionRevision = { label: string; run: () => void };
export type TarjetaEstado = { titulo: string; detalle: string; estado: "ok" | "warn" | "bad" };

const AREAS: Array<[string, (k: string) => boolean]> = [
  ["Negocio", (k) => ["business_name", "matriz", "contabilidad"].includes(k)],
  ["Usuarios", (k) => ["admin", "users", "correo_recuperacion"].includes(k)],
  ["Báscula", (k) => ["firebase", "device_key"].includes(k)],
  ["Transporte y cosechadora", (k) => k.startsWith("campo_")],
  ["Seguridad", (k) => ["app_mode", "respaldo_reciente", "disco"].includes(k)],
  ["Otros", () => true]
];

export function EstadoSistema({ tarjetas, avisos, revisiones, accion, ocupado, onActualizar, onRespaldar, respaldando, puedeRespaldar, carpetaRespaldos, children }: {
  tarjetas: TarjetaEstado[];
  /** Problemas del momento (sin conexión, respaldo viejo…). */
  avisos: string[];
  revisiones: Revision[] | null;
  accion: (key: string) => AccionRevision | null;
  ocupado: boolean; onActualizar: () => void;
  onRespaldar: () => void; respaldando: boolean; puedeRespaldar: boolean;
  carpetaRespaldos?: string | null;
  children?: ReactNode;
}) {
  // «Modo del sistema» es informativo: no es algo pendiente (igual que en «Hoy»).
  const exigibles = (revisiones ?? []).filter((r) => r.key !== "app_mode");
  const pendientes = exigibles.filter((r) => !r.ok);
  const total = pendientes.length + avisos.length;
  const grupos = AREAS.map(([nombre, cabe], i) => ({
    nombre, filas: (revisiones ?? []).filter((r) => cabe(r.key) && !AREAS.slice(0, i).some(([, antes]) => antes(r.key)))
  })).filter((g) => g.filas.length);

  return (
    <section className="estSis" style={{ order: 1 }}>
      <div className={`estSis__banda ${total ? "is-warn" : "is-ok"}`}>
        <span className="estSis__ico" aria-hidden="true">{total ? "⚠️" : "✅"}</span>
        <div className="estSis__txt">
          <strong>{total === 0 ? "Todo en orden" : total === 1 ? "Hay 1 cosa por revisar" : `Hay ${total} cosas por revisar`}</strong>
          <span>{revisiones ? `${exigibles.length - pendientes.length} de ${exigibles.length} puntos revisados están bien.` : "Revisando el sistema…"}</span>
        </div>
        <div className="estSis__acc">
          <button type="button" className="btnSecondary" onClick={onActualizar} disabled={ocupado}>{ocupado ? "Revisando…" : "↻ Revisar de nuevo"}</button>
          {puedeRespaldar && <button type="button" className="primary" onClick={onRespaldar} disabled={respaldando}>{respaldando ? "Respaldando…" : "💾 Crear respaldo"}</button>}
        </div>
      </div>

      {total > 0 && (
        <ul className="estSis__pend">
          {avisos.map((a) => <li key={a}><i aria-hidden="true" /><div><strong>{a}</strong></div></li>)}
          {pendientes.map((r) => {
            const acc = accion(r.key);
            return (
              <li key={r.key}><i aria-hidden="true" /><div><strong>{r.label}</strong><span>{r.detail}</span></div>
                {acc && <button type="button" className="btnSecondary" onClick={acc.run}>{acc.label}</button>}</li>
            );
          })}
        </ul>
      )}

      <div className="estSis__grid">
        {tarjetas.map((t) => (
          <div key={t.titulo} className={`estSis__card is-${t.estado}`}><i aria-hidden="true" /><div><strong>{t.titulo}</strong><span>{t.detalle}</span></div></div>
        ))}
      </div>

      {children}

      {grupos.length > 0 && (
        <details className="estSis__todo">
          <summary>Ver la lista completa de puntos revisados</summary>
          <div className="estSis__cols">
            {grupos.map((g) => (
              <section key={g.nombre}>
                <header><strong>{g.nombre}</strong><small>{g.filas.filter((f) => f.ok || f.key === "app_mode").length}/{g.filas.length}</small></header>
                <ul>{g.filas.map((f) => <li key={f.key} className={f.ok ? "is-ok" : f.key === "app_mode" ? "is-info" : "is-warn"}><i aria-hidden="true" /><div><strong>{f.label}</strong><span>{f.detail}</span></div></li>)}</ul>
              </section>
            ))}
          </div>
        </details>
      )}
      {carpetaRespaldos && <p className="estSis__pie">Los respaldos se guardan en <code>{carpetaRespaldos}</code></p>}
    </section>
  );
}
