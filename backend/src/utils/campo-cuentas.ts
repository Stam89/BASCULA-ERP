export type SaldoPendiente = { id: string; saldo: number };
export type AplicacionSaldo = { id: string; monto: number };

const centavos = (n: number) => Math.round(Number(n) * 100) / 100;

// Reparte un valor FIFO sin exceder el saldo de ninguna linea. Trabaja en
// centavos para que ambos lados de una compensacion siempre sumen lo mismo.
export function repartirCompensacion(lineas: SaldoPendiente[], monto: number): AplicacionSaldo[] {
  let restante = centavos(monto);
  if (!(restante > 0)) return [];
  const aplicaciones: AplicacionSaldo[] = [];
  for (const linea of lineas) {
    if (restante <= 0.005) break;
    const saldo = centavos(linea.saldo);
    if (!(saldo > 0)) continue;
    const aplicado = centavos(Math.min(restante, saldo));
    aplicaciones.push({ id: linea.id, monto: aplicado });
    restante = centavos(restante - aplicado);
  }
  if (restante > 0.005) throw new Error("La compensacion supera los saldos disponibles");
  return aplicaciones;
}

export function saldoNeto(cxc: number, cxp: number) {
  const porCobrar = centavos(Math.max(0, Number(cxc) || 0));
  const porPagar = centavos(Math.max(0, Number(cxp) || 0));
  const compensable = centavos(Math.min(porCobrar, porPagar));
  return {
    por_cobrar: porCobrar,
    por_pagar: porPagar,
    compensable,
    saldo_neto: centavos(porCobrar - porPagar)
  };
}
