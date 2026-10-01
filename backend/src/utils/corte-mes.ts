// Los cortes (saldos iniciales, cierres) son a FIN DE MES.

/** ¿La fecha AAAA-MM-DD es el último día de su mes? */
export function esFinDeMes(fecha: string): boolean {
  const [y, m, d] = fecha.split("-").map(Number);
  if (!y || !m || !d) return false;
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
}
