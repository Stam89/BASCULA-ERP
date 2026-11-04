// Fechas «de hoy» en hora de ECUADOR. `new Date().toISOString().slice(0, 10)` da la fecha de Greenwich (UTC): después
// de las 19:00 en Ecuador ya es «mañana» y los registros de la noche quedaban con el día siguiente (auditoría
// 2026-10-20). Usar estas funciones para cualquier fecha por defecto.
const ZONA = "America/Guayaquil";

/** YYYY-MM-DD de un instante, en hora de Ecuador. */
export function fechaEc(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: ZONA });
}

/**
 * Día de un ticket de báscula: el que escribió la báscula («DD/MM/AAAA HH:MM») o, si falta, el de su creación en la app.
 * Sirve para fechar lo que nace de un ticket: se ingresa días después, pero el viaje fue ese día.
 */
export function fechaDeTicket(texto: unknown, creadoMs?: number | string | null): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(texto ?? "").trim());
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const ms = Number(creadoMs);
  return Number.isFinite(ms) && ms > 0 ? fechaEc(new Date(ms)) : null;
}

/** YYYY-MM-DD de hoy en Ecuador. */
export function hoyEc(): string {
  return fechaEc(new Date());
}
