// ── Venta Detalle (Caja): cálculo puro del cobro por Libra o por QQ ──────────
// La tarifa de cada producto se configura POR LIBRA (products.price_per_pound).
// El precio base del quintal es esa tarifa × 100 lb y, cuando se vende por QQ, se
// le resta exactamente DESCUENTO_QQ (un centavo) por quintal. El inventario se
// sigue descontando en QQ y la caja recibe el total; aquí solo se calcula.

export type ModoVentaDetalle = "LIBRA" | "QQ";

export const LIBRAS_POR_QQ = 100;
/** Descuento automático, en dólares, sobre el precio base de cada quintal. */
export const DESCUENTO_QQ = 0.01;

export type VentaDetalleCalculo = {
  /** Cantidad digitada, en la unidad del modo (libras o QQ). */
  cantidad: number;
  /** Peso equivalente en libras (3 decimales). */
  libras: number;
  /** Peso equivalente en QQ (5 decimales): es lo que sale del inventario. */
  qq: number;
  /** Tarifa configurada por libra. */
  precioLibra: number;
  /** Precio base de la unidad del modo: $/lb, o $/lb × 100 para el QQ. */
  precioBase: number;
  /** Precio que se cobra por unidad: el base, menos DESCUENTO_QQ en modo QQ. */
  precioAplicado: number;
  /** Descuento por unidad (0 por libra, DESCUENTO_QQ por quintal). */
  descuento: number;
  /** Total = Cantidad × PrecioAplicado, a centavos. */
  total: number;
};

/** Redondeo decimal sin el ruido binario de JS (1.365 → 1.37, no 1.36). */
export function redondear(n: number, decimales: number): number {
  if (!Number.isFinite(n)) return NaN;
  const limpio = Number(n.toPrecision(12));
  const f = 10 ** decimales;
  return Math.round(limpio * f + Math.sign(limpio) * 1e-9) / f;
}

/** Precio por unidad que se cobra según el modo, o null si no hay tarifa válida. */
export function precioAplicadoDetalle(precioLibra: number, modo: ModoVentaDetalle): number | null {
  if (!Number.isFinite(precioLibra) || !(precioLibra > 0)) return null;
  if (modo === "LIBRA") return precioLibra;
  const aplicado = redondear(redondear(precioLibra * LIBRAS_POR_QQ, 2) - DESCUENTO_QQ, 2);
  return aplicado > 0 ? aplicado : null;
}

/**
 * Cobro de una venta al detalle. Devuelve null si falta la tarifa o la cantidad
 * no es un número válido (vacía cuenta como 0 → total 0).
 */
export function calcularVentaDetalle({ cantidad, precioLibra, modo }: {
  cantidad: number; precioLibra: number; modo: ModoVentaDetalle;
}): VentaDetalleCalculo | null {
  const precioAplicado = precioAplicadoDetalle(precioLibra, modo);
  if (precioAplicado == null || !Number.isFinite(cantidad) || cantidad < 0) return null;
  const enQQ = modo === "QQ";
  const libras = redondear(enQQ ? cantidad * LIBRAS_POR_QQ : cantidad, 3);
  const qq = redondear(enQQ ? cantidad : libras / LIBRAS_POR_QQ, 5);
  const precioBase = enQQ ? redondear(precioLibra * LIBRAS_POR_QQ, 2) : precioLibra;
  return {
    cantidad,
    libras,
    qq,
    precioLibra,
    precioBase,
    precioAplicado,
    descuento: enQQ ? DESCUENTO_QQ : 0,
    total: redondear(cantidad * precioAplicado, 2)
  };
}

/** Cantidad legible sin ceros de sobra: 2 → "2", 1.5 → "1.5", 0.125 → "0.125". */
export function formatoCantidad(n: number, maxDecimales = 5): string {
  return String(redondear(n, maxDecimales));
}

/** Precio unitario con 2 a 4 decimales (las tarifas por libra pueden tener 4): $0.45, $0.455. */
export function formatoPrecio(n: number): string {
  return `$${redondear(n, 4).toFixed(4).replace(/0{1,2}$/, "")}`;
}
