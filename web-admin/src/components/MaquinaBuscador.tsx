// Buscador de EQUIPO / MÁQUINA de la planta (secciones del catálogo de
// mantenimiento: PILADORA › DESCASCARADOR). Elegida, queda como tarjeta con
// «Cambiar». Lo usan las categorías de Caja que cargan el gasto a una máquina
// (Compra de repuestos, Materiales consumibles). Envía el id de la sección
// (maquina_id).
import { BuscadorCombo } from "./BuscadorCombo";

export type MaquinaOpcion = { id: string; area: string; section: string };

export function MaquinaBuscador({ id, maquinas, valor, onCambio, placeholder = "🔍 Buscar equipo, área o máquina…" }: {
  id: string;
  maquinas: MaquinaOpcion[];
  valor: string;
  onCambio: (maquinaId: string) => void;
  placeholder?: string;
}) {
  const sel = maquinas.find((m) => m.id === valor);
  if (sel) {
    return (
      <div className="mantEquipoSel">
        <span className="mantEquipoSel__ico" aria-hidden="true">🔧</span>
        <span className="mantEquipoSel__txt"><strong>{sel.section}</strong><small>{sel.area}</small></span>
        <button type="button" className="mantLink" onClick={() => onCambio("")}>Cambiar</button>
      </div>
    );
  }
  return (
    <BuscadorCombo id={id} placeholder={placeholder} max={10}
      opciones={maquinas.map((m) => ({ key: m.id, titulo: m.section, detalle: m.area }))}
      onElegir={onCambio}
      vacio={maquinas.length ? "Sin coincidencias" : "No hay máquinas: créalas en Configuración → Categorías de Mantenimiento"} />
  );
}

/** «PILADORA › DESCASCARADOR» para mostrar en listas. */
export const etiquetaMaquina = (m?: MaquinaOpcion) => (m ? `${m.area} › ${m.section}` : "");
