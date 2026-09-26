import { round2 } from "./rice-formulas.js";

const RAW_BACKING_BY_FINISHED_CODE: Record<string, string> = {
  "ARROZ-PILADO-011": "CASCARA-011",
  "ARROZ-PILADO-CORRIENTE": "CASCARA-CORRIENTE"
};

export function rawBackingCode(finishedProductCode: string): string | null {
  return RAW_BACKING_BY_FINISHED_CODE[finishedProductCode] ?? null;
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
