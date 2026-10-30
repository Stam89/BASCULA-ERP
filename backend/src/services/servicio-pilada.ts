// ⚖️ SERVICIO DE PILADA A CLIENTES (maquila) — tarifa y cobro mínimo (pedido del dueño 2026-10-30).
//  · La tarifa base es la de Configuración › Parámetros de planta (app_settings.tarifa_pilado_qq del maestro): la que se
//    ve en pantalla. Los recargos por sacos < 100 lb siguen en labor_rates.
//  · Mínimo: se cobran los QQ que salieron, pero nunca menos de (kg de cáscara que entraron ÷ 100) + servicio_minimo_pct.
//    Ej.: 2,110 kg → 21.10 + 7% = 22.58 QQ. La diferencia va como una línea más del detalle («mínimo por rendimiento»).
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
const round2 = (n: number) => Math.round(n * 100) / 100;

export type LineaServicio = {
  presentacion: string; quintales: number; precio_base_qq: number; recargo_qq: number;
  concepto_recargo: string; precio_total_qq: number; subtotal: number;
};
export const PRESENTACION_MINIMO = "mínimo por rendimiento";

export async function parametrosServicioPilada(db: Db): Promise<{ tarifa: number | null; minimoPct: number }> {
  const r = (await db.query(
    "SELECT tarifa_pilado_qq::float AS tarifa, COALESCE(servicio_minimo_pct, 7)::float AS pct FROM app_settings WHERE socio_id IS NULL LIMIT 1"
  )).rows[0];
  const tarifa = r?.tarifa != null && Number(r.tarifa) > 0 ? Number(r.tarifa) : null;
  return { tarifa, minimoPct: r?.pct != null ? Number(r.pct) : 7 };
}

/** QQ mínimos a cobrar: (kg ÷ 100) + pct %. */
export function qqMinimoServicio(kgEntrada: number, pct: number): number {
  return round2((Number(kgEntrada) / 100) * (1 + Number(pct) / 100));
}

/**
 * Re-precia las líneas con la tarifa base (cada una conserva su recargo por saco) y, si los QQ quedan por debajo del
 * mínimo, agrega la línea «mínimo por rendimiento» por la diferencia. Las líneas de mínimo previas se descartan.
 */
export function aplicarMinimoServicio(lineas: LineaServicio[], opts: { base: number; kgEntrada: number; minimoPct: number }) {
  const reales = lineas.filter((l) => l.presentacion !== PRESENTACION_MINIMO).map((l) => {
    const precio = round2(opts.base + Number(l.recargo_qq || 0));
    return { ...l, precio_base_qq: opts.base, precio_total_qq: precio, subtotal: round2(Number(l.quintales) * precio) };
  });
  const qqReales = round2(reales.reduce((s, l) => s + Number(l.quintales), 0));
  const minimo = qqMinimoServicio(opts.kgEntrada, opts.minimoPct);
  const detalle: LineaServicio[] = [...reales];
  if (minimo - qqReales > 0.005) {
    const falta = round2(minimo - qqReales);
    detalle.push({
      presentacion: PRESENTACION_MINIMO, quintales: falta, precio_base_qq: opts.base, recargo_qq: 0,
      concepto_recargo: `mínimo ${opts.kgEntrada.toLocaleString("en-US")} kg ÷ 100 + ${opts.minimoPct}% = ${minimo} QQ (salieron ${qqReales})`,
      precio_total_qq: opts.base, subtotal: round2(falta * opts.base)
    });
  }
  const total = round2(detalle.reduce((s, l) => s + l.subtotal, 0));
  const quintales = round2(detalle.reduce((s, l) => s + Number(l.quintales), 0));
  return {
    detalle, total, quintales, qq_reales: qqReales, qq_minimo: minimo, aplico_minimo: minimo - qqReales > 0.005,
    precio_base_qq: opts.base,
    adicional_sacos: round2(detalle.reduce((s, l) => s + Number(l.quintales) * Number(l.recargo_qq || 0), 0)),
    tarifa_promedio_qq: quintales > 0 ? round2(total / quintales) : opts.base
  };
}
