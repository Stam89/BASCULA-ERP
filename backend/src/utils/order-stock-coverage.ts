import { round2 } from "./rice-formulas.js";

const RAW_BACKING_BY_FINISHED_CODE: Record<string, string> = {
  "ARROZ-PILADO-011": "CASCARA-011",
  "ARROZ-PILADO-CORRIENTE": "CASCARA-CORRIENTE"
};

export function rawBackingCode(finishedProductCode: string): string | null {
  return RAW_BACKING_BY_FINISHED_CODE[finishedProductCode] ?? null;
}

/**
 * SUBPRODUCTOS respaldados por cáscara (pedido del dueño 2026-10-15: «si el socio tiene cáscara, va a haber una
 * producción con esa cáscara»). Cada QQ de cáscara (0.11 o corriente) que se pile da, en promedio, esta fracción del
 * subproducto. Los valores son los normales de una piladora; con historial real se usan los de las piladas
 * (rendimientoSubproductos en orders.ts).
 */
export const RENDIMIENTO_SUBPRODUCTO_DEFECTO: Record<string, number> = {
  "ARROCILLO-34": 0.06,
  "ARROCILLO-FINO": 0.02,
  "POLVILLO": 0.10,
  "RECHAZO": 0.01
};
export const CODIGOS_CASCARA = ["CASCARA-011", "CASCARA-CORRIENTE"];

/** QQ de subproducto que se espera sacar de `cascaraQq` QQ de cáscara. */
export function subproductoEsperadoQq(cascaraQq: number, rendimiento: number): number {
  return Math.max(0, round2((Number(cascaraQq) || 0) * (Number(rendimiento) || 0)));
}

export function calculateOrderStockCoverage(
  requestedQq: number,
  pendingQq: number,
  finishedStockQq: number,
  rawStockQq: number
): {
  requiredQq: number;
  availableQq: number;
  rawRequiredQq: number;
  shortageQq: number;
  covered: boolean;
} {
  const requiredQq = Math.max(0, round2(Number(requestedQq || 0) + Number(pendingQq || 0)));
  const finished = Math.max(0, round2(Number(finishedStockQq) || 0));
  const raw = Math.max(0, round2(Number(rawStockQq) || 0));
  const availableQq = round2(finished + raw);
  const rawRequiredQq = Math.min(raw, Math.max(0, round2(requiredQq - finished)));
  const shortageQq = Math.max(0, round2(requiredQq - availableQq));
  return { requiredQq, availableQq, rawRequiredQq, shortageQq, covered: shortageQq <= 0.001 };
}
