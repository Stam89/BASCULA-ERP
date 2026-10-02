// SESIÓN DE VENTAS (cabecera de Ventas): el socio que VENDE el pedido = de quién
// es el inventario que lo respalda. Cambiarlo es instantáneo (no recarga la app ni
// cambia el accionista activo de los demás módulos): App conserva el cliente,
// vacía los productos del pedido y trae el inventario del nuevo socio.
export type SocioVenta = { id: string; name: string; tipo?: string | null };

export function SalesSessionSwitcher({ socios, valor, activoGlobalId, onCambio, bloqueado, cargando }: {
  /** Accionistas para los que el usuario puede vender. */
  socios: SocioVenta[];
  valor: string;
  /** Accionista activo del resto de la app (se marca como «principal»). */
  activoGlobalId: string | null;
  onCambio: (id: string) => void;
  /** Motivo por el que no se puede cambiar ahora (p. ej. editando un pedido). */
  bloqueado?: string | null;
  cargando?: boolean;
}) {
  if (socios.length < 2) return null;
  return (
    <div className="ventaSesion" role="radiogroup" aria-label="Socio que vende">
      <span className="ventaSesion__label">🧾 Vendiendo como{cargando ? " …" : ":"}</span>
      {socios.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={valor === s.id}
          className={`ventaSesion__chip ${valor === s.id ? "is-activo" : ""}`}
          disabled={!!bloqueado && valor !== s.id}
          title={bloqueado && valor !== s.id ? bloqueado : `Inventario y pedido de ${s.name}${s.id === activoGlobalId ? " (accionista activo)" : ""}`}
          onClick={() => onCambio(s.id)}>
          {s.tipo === "MATRIZ" ? "🏭" : "🤝"} {s.name}
        </button>
      ))}
    </div>
  );
}
