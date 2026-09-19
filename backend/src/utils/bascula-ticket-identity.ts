export function canonicalBasculaTicketNumber(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  try {
    return BigInt(digits).toString();
  } catch {
    return "";
  }
}

export function canonicalBasculaMode(value: unknown): "principal" | "particular" {
  return String(value ?? "").trim().toLowerCase() === "particular"
    ? "particular"
    : "principal";
}

export function basculaTicketStableKey(
  ticketNumber: unknown,
  mode: unknown,
  scope?: string
): string {
  const number = canonicalBasculaTicketNumber(ticketNumber);
  const normalizedMode = canonicalBasculaMode(mode);
  const normalizedScope = scope?.trim();
  const padded = number.padStart(6, "0");
  const displayNumber = padded.length > 3
    ? `${padded.slice(0, -3)} ${padded.slice(-3)}`
    : padded;
  return normalizedScope
    ? `${normalizedScope}_${normalizedMode}_${displayNumber}`
    : `${normalizedMode}_${displayNumber}`;
}
