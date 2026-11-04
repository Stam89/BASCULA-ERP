// Los cortes (saldos iniciales, cierres) son a FIN DE MES.
// Excepción única: el ARRANQUE con datos reales, que puede caer a mitad de mes: los saldos iniciales van al cierre del
// día anterior. Lo fija «Borrar datos de prueba» (app_settings.corte_arranque); sin borrado vale el primer arranque.
export const CORTE_ARRANQUE = "2026-10-14";

/** ¿Se puede cargar saldos iniciales a esta fecha? Fin de mes o el día del arranque. */
export function esCorteValido(fecha: string, arranque: string = CORTE_ARRANQUE): boolean {
  return fecha === arranque || esFinDeMes(fecha);
}

/** Corte del arranque vigente (la Configuración general lo guarda; si no, el primer arranque). */
export async function leerCorteArranque(db: { query: (sql: string) => Promise<{ rows: Array<{ corte?: string | null }> }> }): Promise<string> {
  const r = await db.query("SELECT corte_arranque::text AS corte FROM app_settings WHERE socio_id IS NULL AND corte_arranque IS NOT NULL LIMIT 1");
  return r.rows[0]?.corte ?? CORTE_ARRANQUE;
}

/** ¿La fecha AAAA-MM-DD es el último día de su mes? */
export function esFinDeMes(fecha: string): boolean {
  const [y, m, d] = fecha.split("-").map(Number);
  if (!y || !m || !d) return false;
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
}
