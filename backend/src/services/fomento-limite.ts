const dinero = (valor: number): number => Math.round((valor + Number.EPSILON) * 100) / 100;

export type EstadoLimiteFomento = {
  limite: number;
  totalActual: number;
  nuevaEntrega: number;
  totalResultante: number;
  disponibleAntes: number;
  excesoResultante: number;
  superaLimite: boolean;
};

/**
 * Calcula el estado del cupo antes de registrar una entrega. Centralizar este
 * cálculo evita que Caja y Fomentos apliquen reglas monetarias distintas.
 */
export function calcularLimiteFomento(limite: number, totalActual: number, nuevaEntrega: number): EstadoLimiteFomento {
  const limiteSeguro = dinero(Math.max(0, Number(limite) || 0));
  const totalSeguro = dinero(Math.max(0, Number(totalActual) || 0));
  const entregaSegura = dinero(Math.max(0, Number(nuevaEntrega) || 0));
  const totalResultante = dinero(totalSeguro + entregaSegura);
  const disponibleAntes = dinero(Math.max(0, limiteSeguro - totalSeguro));
  const excesoResultante = dinero(Math.max(0, totalResultante - limiteSeguro));

  return {
    limite: limiteSeguro,
    totalActual: totalSeguro,
    nuevaEntrega: entregaSegura,
    totalResultante,
    disponibleAntes,
    excesoResultante,
    superaLimite: excesoResultante > 0
  };
}
