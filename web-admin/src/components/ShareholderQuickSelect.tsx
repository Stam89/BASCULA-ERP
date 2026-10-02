// Acceso rápido de ACCIONISTAS en «🛒 Nuevo Pedido»: un chip por socio / matriz
// (menos el que está vendiendo). Al tocarlo, el pedido queda a nombre de ese
// accionista sin pasar por el buscador de clientes (App resuelve su cliente).
export type AccionistaChip = { id: string; name: string; tipo?: string | null };

export function ShareholderQuickSelect({ accionistas, activoId, seleccionadoId, cargandoId, onElegir }: {
  accionistas: AccionistaChip[];
  /** Accionista que toma el pedido: no se vende a sí mismo. */
  activoId: string | null;
  seleccionadoId: string;
  cargandoId?: string;
  onElegir: (a: AccionistaChip) => void;
}) {
  const lista = accionistas.filter((a) => a.id !== activoId);
  if (!lista.length) return null;
  return (
    <div className="socioChips" role="group" aria-label="Pedido para un accionista">
      <span className="socioChips__label">Acceso rápido:</span>
      {lista.map((a) => (
        <button key={a.id} type="button" className={`socioChip ${seleccionadoId === a.id ? "is-activo" : ""}`}
          aria-pressed={seleccionadoId === a.id} disabled={!!cargandoId} onClick={() => onElegir(a)}
          title={`Pedido a nombre de ${a.name}`}>
          {a.tipo === "MATRIZ" ? "🏭" : "🤝"} {cargandoId === a.id ? "…" : a.name}
        </button>
      ))}
    </div>
  );
}
