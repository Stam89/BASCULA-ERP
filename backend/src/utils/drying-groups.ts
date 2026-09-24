export type DryingGroupEntry = {
  id: string;
  accionista_id: string | null;
  operation_type: string | null;
  is_maquila: boolean;
};

export function normalizeDryingOperationType(operationType: unknown, isMaquila: boolean): string {
  const normalized = String(operationType ?? (isMaquila ? "SECADO_PILADO" : "COMPRA")).toUpperCase();
  return normalized === "PILADO" ? "SECADO_PILADO" : normalized;
}

export function groupDryingEntries(entries: DryingGroupEntry[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const operationType = normalizeDryingOperationType(entry.operation_type, entry.is_maquila);
    const key = `${entry.accionista_id ?? "SIN_SOCIO"}|${operationType}`;
    groups.set(key, [...(groups.get(key) ?? []), entry.id]);
  }
  return [...groups.values()];
}
