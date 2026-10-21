// 💲 Precio por quintal que se escribe en la app de BÁSCULA (campo «valorPagar» del ticket). Liquidaciones lo usa
// como precio SUGERIDO, que se puede cambiar (pedido del dueño 2026-10-21). Llega como texto: "42", "42.5", "42,50",
// "$ 42"… Devuelve el número, o null si viene vacío o no es un precio razonable por quintal.
export function precioDeBascula(valor: unknown): number | null {
  if (valor == null) return null;
  let t = String(valor).trim().replace(/\$/g, "").replace(/\s+/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) {
    // "1.234,56" → 1234.56 · "1,234.56" → 1234.56
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (t.includes(",")) {
    t = t.replace(",", ".");
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n >= 1000) return null;
  return Math.round(n * 10000) / 10000;
}
