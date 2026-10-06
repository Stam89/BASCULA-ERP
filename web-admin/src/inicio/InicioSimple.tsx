import type { ReactNode } from "react";
import type { Tile, Tiles } from "./tiles";

// 🏠 Inicio simple: la pantalla de entrada de quien NO es administrador. Saluda, muestra
// «Hoy» (lo que hay que atender) y deja botones grandes para lo que se hace todos los días
// (abrir la caja, ingresar la materia prima, producir) y más pequeños para el resto. Los
// botones salen de los permisos que la persona ya tiene; aquí no se cambia nada.

export type Insignia = { texto: string; nivel: "ok" | "atencion" | "info" };

function primerNombre(nombre: string): string {
  const p = nombre.trim().split(/\s+/)[0] ?? "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

export function InicioSimple({ nombre, hoy, tiles, insignias, onIr, onVerCompleto, esVistaPrevia }: {
  nombre: string;
  /** El panel «📌 Hoy» ya armado (lo pone App.tsx). */
  hoy: ReactNode;
  tiles: Tiles;
  /** Un dato corto por pestaña (p. ej. «Cerrada · ábrela», «3 por ingresar»). */
  insignias: Record<string, Insignia | undefined>;
  onIr: (tab: string) => void;
  /** Volver al panel completo de siempre. */
  onVerCompleto: () => void;
  /** El administrador la está viendo como vista previa. */
  esVistaPrevia?: boolean;
}) {
  const saludo = new Date().getHours() < 12 ? "Buenos días" : new Date().getHours() < 19 ? "Buenas tardes" : "Buenas noches";
  const fecha = new Date().toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long" });
  const boton = (t: Tile, grande: boolean) => {
    const ins = insignias[t.tab];
    return (
      <button key={t.tab} type="button" className={`ini-tile${grande ? " ini-tile--grande" : ""}`} onClick={() => onIr(t.tab)}>
        <span className="ini-ico" aria-hidden="true">{t.icono}</span>
        <span className="ini-txt">
          <span className="ini-titulo">{t.titulo}</span>
          {grande && <span className="ini-ayuda">{t.ayuda}</span>}
          {ins && <span className={`ini-badge ini-badge--${ins.nivel}`}>{ins.texto}</span>}
        </span>
      </button>
    );
  };
  const sinNada = tiles.principales.length === 0 && tiles.otras.length === 0;

  return (
    <div className="ini">
      <header className="ini-head">
        <div>
          <h2 className="ini-hola">{saludo}{nombre ? `, ${primerNombre(nombre)}` : ""} 👋</h2>
          <p className="ini-fecha">{fecha}</p>
        </div>
        <button type="button" className="btnSecondary" onClick={onVerCompleto}>{esVistaPrevia ? "← Volver al panel completo" : "Ver panel completo"}</button>
      </header>
      {esVistaPrevia && <p className="ini-previa" role="note">👁 Así ve su inicio una persona que no es administradora (aquí con todas tus pantallas; a cada persona solo le salen las suyas).</p>}

      {hoy}

      {tiles.principales.length > 0 && (
        <section aria-label="Lo de todos los días">
          <h3 className="ini-sec">Lo de todos los días</h3>
          <div className="ini-grid ini-grid--grande">{tiles.principales.map((t) => boton(t, true))}</div>
        </section>
      )}
      {tiles.otras.length > 0 && (
        <section aria-label="Otras pantallas">
          <h3 className="ini-sec">Otras pantallas</h3>
          <div className="ini-grid">{tiles.otras.map((t) => boton(t, false))}</div>
        </section>
      )}
      {sinNada && <p className="ini-vacio">Todavía no tienes pantallas asignadas. Pídele al administrador que te dé acceso a lo que necesitas.</p>}
    </div>
  );
}
