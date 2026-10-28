import { money } from "../format";

// 🧮 Contar billetes y monedas (mejora 5 de la caja, 2026-10-28): cuántos de cada uno y el total. Lo usan el cuadre del
// día y el cierre de caja. Las claves son las mismas del servidor (POST /cash/registers/:id/cuadre); «1m» = moneda de $1.

export const BILLETES = ["100", "50", "20", "10", "5", "1"] as const;
export const MONEDAS = ["1m", "0.50", "0.25", "0.10", "0.05", "0.01"] as const;
export type Conteo = Record<string, string>;

const valor = (d: string) => (d === "1m" ? 1 : Number(d));
const etiqueta = (d: string) => (d === "1m" ? "$1" : Number(d) >= 1 ? `$${Number(d)}` : `${Math.round(Number(d) * 100)}¢`);

/** Total del conteo, redondeado a centavos. */
export function totalDeConteo(c: Conteo): number {
  return Math.round(Object.entries(c).reduce((s, [d, n]) => s + valor(d) * (Number(n) || 0), 0) * 100) / 100;
}
/** El conteo en números enteros, como lo pide el servidor (sin los vacíos). */
export function conteoParaEnviar(c: Conteo): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [d, n] of Object.entries(c)) { const v = Math.floor(Number(n)); if (v > 0) out[d] = v; }
  return out;
}

export function ContarBilletes({ conteo, onCambiar, disabled }: { conteo: Conteo; onCambiar: (c: Conteo) => void; disabled?: boolean }) {
  const fila = (d: string) => {
    const n = Number(conteo[d]) || 0;
    return (
      <label key={d} className="contar__fila">
        <span className="contar__den">{etiqueta(d)}</span>
        <span aria-hidden="true">×</span>
        <input type="number" min="0" step="1" inputMode="numeric" placeholder="0" disabled={disabled} aria-label={`Cantidad de ${etiqueta(d)}`}
          value={conteo[d] ?? ""} onChange={(e) => onCambiar({ ...conteo, [d]: e.target.value })} />
        <span className="contar__sub">{n > 0 ? money(valor(d) * n) : ""}</span>
      </label>
    );
  };
  return (
    <div className="contar">
      <div className="contar__col"><small>💵 Billetes</small>{BILLETES.map(fila)}</div>
      <div className="contar__col"><small>🪙 Monedas</small>{MONEDAS.map(fila)}</div>
      <div className="contar__total"><span>Contado</span><b>{money(totalDeConteo(conteo))}</b></div>
    </div>
  );
}
