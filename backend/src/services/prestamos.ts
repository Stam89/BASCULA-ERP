// PRÉSTAMOS BANCARIOS: armado de la tabla de cuotas (función PURA, con pruebas).
// Sistema francés (cuota fija): cada cuota paga el interés del saldo y el resto abona al capital. Si se sabe la cuota
// que cobra el banco pero no la tasa, la tasa se despeja de la cuota. Sin tasa (0 %), el capital se reparte igual.

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type FilaCuota = { numero: number; fecha: string; capital: number; interes: number; otros: number; total: number };

export type DatosTabla = {
  /** Capital: lo prestado o lo que falta pagar. */
  capital: number;
  /** Número de cuotas que faltan. */
  cuotas: number;
  /** Fecha de la primera (o próxima) cuota: su día es el día de cobro. */
  primeraFecha: string;
  /** Cada cuántos meses cobra (1 = mensual). */
  frecuenciaMeses?: number;
  /** Tasa de interés ANUAL en %. */
  tasaAnual?: number | null;
  /** Cuota fija que cobra el banco (capital + interés, sin otros cargos): sirve para despejar la tasa. */
  cuota?: number | null;
  /** Seguro u otros cargos fijos en cada cuota. */
  otrosPorCuota?: number;
};

/** Día `dia` del mes `meses` después de `fechaIso` (si el mes es más corto, el último día). */
export function fechaMasMeses(fechaIso: string, meses: number, dia: number): string {
  const [y, m] = fechaIso.slice(0, 10).split("-").map(Number);
  const total = (m - 1) + meses;
  const anio = y + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12; // 0-11
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const d = Math.min(dia, ultimo);
  return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Cuota fija del sistema francés para tasa por período `i`. */
function cuotaFrancesa(capital: number, i: number, n: number): number {
  return i <= 0 ? capital / n : (capital * i) / (1 - Math.pow(1 + i, -n));
}

/** Tasa por período que hace que la cuota francesa sea `cuota` (búsqueda por bisección). */
export function tasaDesdeCuota(capital: number, cuota: number, n: number): number {
  if (cuota * n <= capital + 0.005) return 0;
  let lo = 0, hi = 1; // 0 % … 100 % por período
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (cuotaFrancesa(capital, mid, n) > cuota) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export function generarTablaCuotas(d: DatosTabla): { tasa_anual: number; cuota: number; filas: FilaCuota[] } {
  const capital = r2(d.capital);
  const n = Math.trunc(d.cuotas);
  const freq = d.frecuenciaMeses ?? 1;
  if (!(capital > 0)) throw new Error("El capital debe ser mayor a 0.");
  if (!(n >= 1 && n <= 600)) throw new Error("El número de cuotas debe estar entre 1 y 600.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.primeraFecha)) throw new Error("Falta la fecha de la primera cuota.");
  if (d.cuota != null && d.cuota > 0 && (d.tasaAnual == null || d.tasaAnual <= 0) && d.cuota * n < capital - 0.05) {
    throw new Error(`Con ${n} cuotas de $${d.cuota.toFixed(2)} no se alcanza a pagar $${capital.toFixed(2)}: revisa la cuota o el número de cuotas.`);
  }
  const i = d.tasaAnual != null && d.tasaAnual > 0
    ? (d.tasaAnual / 100) * (freq / 12)
    : d.cuota != null && d.cuota > 0 ? tasaDesdeCuota(capital, d.cuota, n) : 0;
  const cuota = r2(cuotaFrancesa(capital, i, n));
  const otros = r2(Math.max(0, d.otrosPorCuota ?? 0));
  const dia = Number(d.primeraFecha.slice(8, 10));
  const filas: FilaCuota[] = [];
  let saldo = capital;
  for (let k = 0; k < n; k++) {
    const interes = r2(saldo * i);
    const cap = k === n - 1 ? r2(saldo) : r2(Math.min(saldo, cuota - interes));
    saldo = r2(saldo - cap);
    filas.push({ numero: k + 1, fecha: fechaMasMeses(d.primeraFecha, k * freq, dia), capital: cap, interes, otros, total: r2(cap + interes + otros) });
  }
  return { tasa_anual: Math.round(i * (12 / freq) * 100 * 10000) / 10000, cuota, filas };
}
