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
