import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";

// 💵 Préstamo al dueño de la selectora: se le descuenta de a poco, en el monto que se escriba cada vez, de lo que la Matriz
// le debe. No mueve la gaveta: el dinero salió cuando se le entregó. Sin cuentas (payableIds vacío) solo muestra el saldo.

type Prestamo = { proveedor: string; saldo: number; descuentos: Array<{ lote: string; fecha: string; monto: number }> };
type Props = {
  providerId: string;
  payableIds: string[];
  saldoCuentas: number;
  puedeEditar: boolean;
  esAdmin: boolean;
  avisar: (mensaje: string, tipo?: "success" | "error" | "warn") => void;
  confirmar: (texto: string) => Promise<boolean>;
  onCambio: () => void | Promise<unknown>;
};

const dolares = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mensaje = (e: unknown) => (e instanceof Error ? e.message : "No se pudo guardar");

export function PrestamoSelectora({ providerId, payableIds, saldoCuentas, puedeEditar, esAdmin, avisar, confirmar, onCambio }: Props) {
  const [prestamo, setPrestamo] = useState<Prestamo | null>(null);
  const [monto, setMonto] = useState("");

  async function cargar() {
    setPrestamo(await apiGet<Prestamo | null>(`/cash/payables/prestamo-selectora?provider_id=${providerId}`));
  }
  useEffect(() => { cargar().catch(() => undefined); }, [providerId]);

  if (!prestamo || (prestamo.saldo <= 0 && prestamo.descuentos.length === 0)) return null;
  const tope = Math.min(prestamo.saldo, saldoCuentas);
  const valor = Number(monto);

  async function descontar() {
    if (!(await confirmar(`Se descuentan ${dolares(valor)} del préstamo de ${prestamo?.proveedor}. No sale dinero de la caja.\n\n¿Guardar?`))) return;
    await apiPost("/cash/payables/prestamo-selectora/descontar", { payable_ids: payableIds, monto: valor });
    avisar("Descuento registrado", "success");
    setMonto("");
    await cargar();
    await onCambio();
  }

  async function anular(lote: string, cuanto: number) {
    if (!(await confirmar(`¿Anular el descuento de ${dolares(cuanto)}? La cuenta y el préstamo vuelven a como estaban.`))) return;
    await apiPost(`/cash/payables/prestamo-selectora/${lote}/anular`, {});
    avisar("Descuento anulado", "success");
    await cargar();
    await onCambio();
  }

  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 12, padding: 14, background: "var(--c-surface)", marginTop: 12 }}>
      <strong>💵 Préstamo pendiente de {prestamo.proveedor}: {dolares(prestamo.saldo)}</strong>
      {puedeEditar && payableIds.length > 0 && prestamo.saldo > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, alignItems: "end", marginTop: 10 }}>
          <label><span>¿Cuánto descontar esta vez?</span>
            <input type="number" step="0.01" min="0" max={tope} value={monto} onChange={(e) => setMonto(e.target.value)} />
          </label>
          <button type="button" className="primary" disabled={!(valor > 0) || valor > tope + 0.001}
            onClick={() => { descontar().catch((e) => avisar(mensaje(e), "error")); }}>Descontar</button>
        </div>
      )}
      {payableIds.length > 0 && <small className="muted">Baja lo que se le debe y lo que él debe. No sale dinero de la caja; lo que quede se le paga como siempre.</small>}
      {prestamo.descuentos.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {prestamo.descuentos.map((d) => (
            <li key={d.lote}>
              {d.fecha.split("-").reverse().join("/")} · descontado {dolares(d.monto)}
              {esAdmin && <button type="button" className="btnGhost" style={{ marginLeft: 8 }}
                onClick={() => { anular(d.lote, d.monto).catch((e) => avisar(mensaje(e), "error")); }}>Anular</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
