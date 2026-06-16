export function nextCode(prefix: string): string {
  const now = new Date();
  const compact = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${compact}-${suffix}`;
}
