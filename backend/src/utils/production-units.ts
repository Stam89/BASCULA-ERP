export const KG_PER_QUINTAL = 45.359237;

function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/**
 * processing_batches.input_quantity se conserva en kg para los reportes de
 * rendimiento, mientras que inventory_movements se expresa en QQ.
 */
export function kilogramsToQuintals(kilograms: number): number {
  if (!Number.isFinite(kilograms) || kilograms <= 0) return 0;
  return round3(kilograms / KG_PER_QUINTAL);
}
