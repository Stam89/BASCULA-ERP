// Fechas «de hoy» en hora de ECUADOR. `new Date().toISOString().slice(0, 10)` da la fecha de Greenwich (UTC): después
// de las 19:00 en Ecuador ya es «mañana» y los registros de la noche quedaban con el día siguiente (auditoría
// 2026-10-20). Usar estas funciones para cualquier fecha por defecto.
const ZONA = "America/Guayaquil";

/** YYYY-MM-DD de un instante, en hora de Ecuador. */
export function fechaEc(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: ZONA });
}

/** YYYY-MM-DD de hoy en Ecuador. */
export function hoyEc(): string {
  return fechaEc(new Date());
}
