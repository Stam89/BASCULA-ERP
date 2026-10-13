export type CampoTipoServicio = "cosecha" | "flete";
export type CampoUnidadNomina = "QQ" | "VIAJE" | "DIA";

export function tipoServicioPorActivo(tipoActivo: string | null | undefined): CampoTipoServicio {
  return String(tipoActivo ?? "").toLowerCase() === "cosechadora" ? "cosecha" : "flete";
}

export function calcularNominaCampo(input: {
  unidad: CampoUnidadNomina;
  qq: number;
  viajes: number;
  dias: number;
  tarifa: number;
}) {
  const base = input.unidad === "QQ"
    ? input.qq
    : input.unidad === "DIA"
      ? input.dias
      : input.viajes;
  return {
    base,
    total: Math.round(base * input.tarifa * 100) / 100
  };
}

/** Total a pagar de una fila de la matriz de nómina: base + extras − descuentos (2 decimales). */
export function totalFilaNomina(f: { base: number; extras: number; descuentos: number }): number {
  return Math.round(((Number(f.base) || 0) + (Number(f.extras) || 0) - (Number(f.descuentos) || 0)) * 100) / 100;
}

/** Periodo semanal de nomina: lunes a domingo, ambos inclusive. */
export function esSemanaLunesDomingo(desde: string | undefined, hasta: string | undefined): boolean {
  if (!desde || !hasta) return false;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(desde);
  const hm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hasta);
  if (!dm || !hm) return false;
  const ini = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
  const fin = Date.UTC(Number(hm[1]), Number(hm[2]) - 1, Number(hm[3]));
  return new Date(ini).getUTCDay() === 1 && fin - ini === 6 * 24 * 60 * 60 * 1000;
}

const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

/**
 * ¿El concepto de un vale por rendir es de este operador? Palabra completa, sin
 * tildes ni mayúsculas («Anticipo Leonel diésel» → LEONEL). Los vales no guardan
 * a la persona: se reconocen por su nombre en el concepto.
 */
export function valeEsDeOperador(concepto: string | null | undefined, operador: string): boolean {
  const nombre = sinTildes(operador.trim());
  if (nombre.length < 3 || nombre === "OTROS") return false;
  const escapado = nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Z0-9])${escapado}([^A-Z0-9]|$)`).test(sinTildes(concepto ?? ""));
}
