// Reparto del combustible de UN motor entre sus túneles (lógica pura, probada).
//
// El quemador es uno solo y gasta mientras haya arroz secando. Por eso cada túnel paga el TIEMPO que
// usó el quemador: en las horas en que secan varios túneles a la vez, el gasto de esas horas se divide
// según los quintales de cada uno; cuando un túnel ya terminó, el que sigue secando paga solo esas horas.
// Si a algún túnel le faltan las horas (inicio/fin), se reparte solo por quintales (como antes).

export type TunelReparto = { qq: number; inicio: Date | string | null | undefined; fin: Date | string | null | undefined };
export type MetodoReparto = "TIEMPO" | "QQ";

const aMs = (v: Date | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * Pesos para repartir el combustible (se usan con `repartirPorPeso`). Con horas: «quintal-hora» compartido
 * (suma de las horas de cada tramo × su parte de los QQ que secaban en ese tramo). Sin horas: los QQ.
 */
export function pesosPorTiempoCompartido(tuneles: TunelReparto[]): { pesos: number[]; metodo: MetodoReparto } {
  const qq = tuneles.map((t) => Math.max(0, Number(t.qq) || 0));
  const tramos = tuneles.map((t) => ({ ini: aMs(t.inicio), fin: aMs(t.fin) }));
  const conHoras = tuneles.length > 0 && tramos.every((t) => t.ini != null && t.fin != null && (t.fin as number) > (t.ini as number));
  if (!conHoras) return { pesos: qq, metodo: "QQ" };

  const cortes = [...new Set(tramos.flatMap((t) => [t.ini as number, t.fin as number]))].sort((a, b) => a - b);
  const pesos = tuneles.map(() => 0);
  for (let k = 0; k < cortes.length - 1; k++) {
    const desde = cortes[k], hasta = cortes[k + 1];
    const horas = (hasta - desde) / 3_600_000;
    const activos = tramos.map((t, i) => ((t.ini as number) <= desde && (t.fin as number) >= hasta ? i : -1)).filter((i) => i >= 0);
    const qqActivos = activos.reduce((s, i) => s + qq[i], 0);
    if (horas <= 0 || qqActivos <= 0) continue; // quemador apagado (nadie secando) o túneles sin QQ
    for (const i of activos) pesos[i] += horas * (qq[i] / qqActivos);
  }
  // Si por algún motivo no hubo tramos útiles (todos sin QQ), se vuelve a los QQ.
  if (pesos.every((p) => p <= 0)) return { pesos: qq, metodo: "QQ" };
  return { pesos, metodo: "TIEMPO" };
}
