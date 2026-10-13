/**
 * La nómina del secador se genera únicamente de lunes a viernes.
 * Se interpreta YYYY-MM-DD directamente para evitar desplazamientos por zona
 * horaria que puedan cambiar el día de la semana.
 */
export function esDiaPagableSecador(value: string | Date): boolean {
  const dateOnly = value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return false;
  const [year, month, day] = dateOnly.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

/** Devuelve los cinco días laborables de una semana cuyo inicio debe ser lunes. */
export function fechasLaborablesDesdeLunes(weekStart: string): string[] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null;
  const [year, month, day] = weekStart.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(start.getTime()) || start.getUTCDay() !== 1) return null;
  return Array.from({ length: 5 }, (_, i) => {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + i);
    return current.toISOString().slice(0, 10);
  });
}
