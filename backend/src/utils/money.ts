import { round2 } from "./rice-formulas.js";

/**
 * Pago base del estibador. Cobra POR TULAS: $ por cada 3 tulas, proporcional.
 * Ej: 3 tulas = 1×tarifa, 6 = 2×tarifa, 4 = 1.33×tarifa.
 */
export function estibadorBaseFromTulas(tulas: number, ratePor3Tulas: number): number {
  const t = Number(tulas) || 0;
  const rate = Number(ratePor3Tulas) || 0;
  return round2((t / 3) * rate);
}

/**
 * Reparte un monto total entre varias partes proporcionalmente a sus pesos
 * (p.ej. los QQ de cada secado). La ÚLTIMA parte se lleva el residuo del
 * redondeo para que la suma de las partes sea EXACTAMENTE el total (no se
 * pierde ni se inventa un centavo). Devuelve un arreglo alineado con `pesos`.
 */
export function repartirPorPeso(total: number, pesos: number[]): number[] {
  const totalPeso = pesos.reduce((a, p) => a + (Number(p) || 0), 0);
  if (totalPeso <= 0) return pesos.map(() => 0);
  const partes: number[] = [];
  let asignado = 0;
  pesos.forEach((peso, i) => {
    const esUltimo = i === pesos.length - 1;
    const parte = esUltimo
      ? round2(total - asignado)
      : round2(total * ((Number(peso) || 0) / totalPeso));
    asignado = round2(asignado + parte);
    partes.push(parte);
  });
  return partes;
}
