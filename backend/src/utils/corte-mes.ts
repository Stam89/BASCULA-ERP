// Los cortes (saldos iniciales, cierres) son a FIN DE MES.
// Excepción única: el ARRANQUE con datos reales. Los dueños empezaron el jueves 15/10/2026, así que los
// saldos iniciales van al cierre del 14/10/2026. Los cortes siguientes vuelven a ser a fin de mes.
export const CORTE_ARRANQUE = "2026-10-14";

/** ¿Se puede cargar saldos iniciales a esta fecha? Fin de mes o el día del arranque. */
export function esCorteValido(fecha: string): boolean {
  return fecha === CORTE_ARRANQUE || esFinDeMes(fecha);
}

/** ¿La fecha AAAA-MM-DD es el último día de su mes? */
export function esFinDeMes(fecha: string): boolean {
  const [y, m, d] = fecha.split("-").map(Number);
  if (!y || !m || !d) return false;
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
}
