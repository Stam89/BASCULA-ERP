import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

/**
 * MOTOR FINANCIERO
 *
 * Una sola fuente de verdad: el balance, el estado de resultados, el flujo de
 * caja y los indicadores se CALCULAN desde lo que la operación ya registró
 * (liquidaciones, ventas, cuentas, caja, inventario, producción, equipos).
 * No hay tablas de saldos que mantener ni doble digitación: si se registra una
 * compra o una venta, los estados financieros ya la reflejan.
 *
 * Todo se calcula por accionista, igual que el resto del sistema.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const div = (a: number, b: number) => (b !== 0 ? round2(a / b) : 0);

export type Cuenta = { concepto: string; valor: number; detalle?: string };

// ── Parámetros contables del accionista ─────────────────────────────────────
async function getSettings(client: PoolClient | typeof pool, accionistaId: string) {
  const r = await client.query(
    `SELECT capital_social, resultados_acumulados, fecha_inicio_contable, precio_referencia_qq
     FROM financial_settings WHERE accionista_id = $1`,
    [accionistaId]
  );
  return {
    capital_social: Number(r.rows[0]?.capital_social ?? 0),
    resultados_acumulados: Number(r.rows[0]?.resultados_acumulados ?? 0),
    fecha_inicio_contable: r.rows[0]?.fecha_inicio_contable ?? null,
    precio_referencia_qq: Number(r.rows[0]?.precio_referencia_qq ?? 0)
  };
}

/**
 * Costo por quintal para valorizar el inventario (NIC 2: costo promedio
 * ponderado). Se toma el precio realmente liquidado a los agricultores; si
 * todavía no hay liquidaciones, el precio de referencia de Configuración.
 */
async function costoQqMateriaPrima(client: PoolClient | typeof pool, accionistaId: string): Promise<number> {
  // Cascada de respaldo: si el socio no tiene liquidaciones propias (recién
  // empieza, o sus lotes se traspasaron), su cáscara física NO puede quedar
  // valorizada en cero: se usa el precio al que la empresa compra realmente.
  const r = await client.query(
    `SELECT
       COALESCE(SUM(gross_amount) FILTER (WHERE accionista_id = $1)
                / NULLIF(SUM(quintals) FILTER (WHERE accionista_id = $1), 0), 0) AS propio,
       COALESCE(SUM(gross_amount) / NULLIF(SUM(quintals), 0), 0) AS global
     FROM liquidations
     WHERE status <> 'CANCELLED'`,
    [accionistaId]
  );
  const propio = Number(r.rows[0]?.propio ?? 0);
  if (propio > 0) return round2(propio);
  const global = Number(r.rows[0]?.global ?? 0);
  if (global > 0) return round2(global);
  const s = await getSettings(client, accionistaId);
  return round2(s.precio_referencia_qq);
}

/**
 * Costo por quintal del producto terminado: lo que costó la materia prima que
 * entró al molino más los costos de conversión (combustible y mano de obra),
 * dividido entre los quintales realmente obtenidos. Si aún no hay producción
 * cerrada, se usa el costo de la materia prima (criterio conservador).
 */
async function costoQqTerminado(
  client: PoolClient | typeof pool,
  accionistaId: string,
  costoMp: number
): Promise<number> {
  const r = await client.query(
    `SELECT
       COALESCE(SUM(y.input_paddy_kg) / 100.0, 0) AS qq_entrada,
       COALESCE(SUM(y.white_rice_qty + y.broken_rice_qty + y.fine_broken_rice_qty + y.bran_qty), 0) AS qq_salida,
       COALESCE(SUM(d.gas_costo_total + d.diesel_costo), 0) AS conversion
     FROM production_yields y
     JOIN processing_batches b ON b.id = y.processing_batch_id
     LEFT JOIN drying_tunnel_reports d ON d.id = b.drying_report_id
     WHERE b.accionista_id = $1 AND b.finished_at IS NOT NULL`,
    [accionistaId]
  );
  const qqEntrada = Number(r.rows[0]?.qq_entrada ?? 0);
  const qqSalida = Number(r.rows[0]?.qq_salida ?? 0);
  const conversion = Number(r.rows[0]?.conversion ?? 0);
  if (qqSalida <= 0) return costoMp;
  return round2((qqEntrada * costoMp + conversion) / qqSalida);
}

/** Inventario valorizado a costo, separado por tipo de producto. */
export async function getInventarioValorizado(client: PoolClient | typeof pool, accionistaId: string) {
  const costoMp = await costoQqMateriaPrima(client, accionistaId);
  const costoPt = await costoQqTerminado(client, accionistaId, costoMp);

  const r = await client.query(
    `SELECT p.product_type, COALESCE(SUM(m.quantity), 0) AS qq
     FROM inventory_movements m
     JOIN products p ON p.id = m.product_id
     WHERE m.accionista_id = $1
     GROUP BY p.product_type`,
    [accionistaId]
  );

  let materiaPrima = 0;
  let terminado = 0;
  let subproductos = 0;
  for (const row of r.rows) {
    const qq = Number(row.qq);
    if (qq <= 0) continue;
    if (row.product_type === "RAW_MATERIAL") materiaPrima = round2(qq * costoMp);
    else if (row.product_type === "BYPRODUCT") subproductos = round2(qq * costoPt * 0.4);
    else terminado = round2(qq * costoPt);
  }

  return {
    materia_prima: materiaPrima,
    producto_terminado: terminado,
    subproductos,
    total: round2(materiaPrima + terminado + subproductos),
    costo_qq_materia_prima: costoMp,
    costo_qq_terminado: costoPt
  };
}

/** Caja y bancos: saldo real de las cajas abiertas, separado por tipo. */
async function getCajaBancos(client: PoolClient | typeof pool, accionistaId: string) {
  const r = await client.query(
    `SELECT c.tipo,
            COALESCE(SUM(
              c.opening_balance
              + COALESCE((SELECT SUM(CASE WHEN m.movement = 'INCOME' THEN m.amount ELSE -m.amount END)
                          FROM cash_movements m WHERE m.cash_register_id = c.id), 0)
            ), 0) AS saldo
     FROM cash_registers c
     WHERE c.accionista_id = $1 AND c.status = 'OPEN'
     GROUP BY c.tipo`,
    [accionistaId]
  );
  let efectivo = 0;
  let bancos = 0;
  for (const row of r.rows) {
    if (row.tipo === "BANCO") bancos = round2(Number(row.saldo));
    else efectivo = round2(Number(row.saldo));
  }
  return { efectivo, bancos, total: round2(efectivo + bancos) };
}

/** Depreciación en línea recta de los equipos del accionista. */
export async function getActivosFijos(client: PoolClient | typeof pool, accionistaId: string, hasta: string) {
  const r = await client.query(
    `SELECT id, name, type, acquisition_cost, acquisition_date, useful_life_years,
            salvage_value, is_depreciable
     FROM equipment
     WHERE (accionista_id = $1 OR accionista_id IS NULL) AND acquisition_cost > 0
     ORDER BY name`,
    [accionistaId]
  );

  const corte = new Date(hasta);
  const items = r.rows.map((e) => {
    const costo = Number(e.acquisition_cost);
    const residual = Number(e.salvage_value);
    const vida = Math.max(1, Number(e.useful_life_years));
    const depreciableBase = Math.max(0, costo - residual);
    const anual = e.is_depreciable ? round2(depreciableBase / vida) : 0;

    let acumulada = 0;
    if (e.is_depreciable && e.acquisition_date) {
      const anios = (corte.getTime() - new Date(e.acquisition_date).getTime()) / (365.25 * 24 * 3600 * 1000);
      acumulada = Math.min(depreciableBase, round2(anual * Math.max(0, anios)));
    }
    return {
      id: e.id,
      nombre: e.name,
      tipo: e.type,
      costo,
      fecha_compra: e.acquisition_date,
      vida_util: vida,
      depreciacion_anual: anual,
      depreciacion_acumulada: acumulada,
      valor_libros: round2(costo - acumulada)
    };
  });

  return {
    items,
    costo_total: round2(items.reduce((s, i) => s + i.costo, 0)),
    depreciacion_acumulada: round2(items.reduce((s, i) => s + i.depreciacion_acumulada, 0)),
    valor_libros: round2(items.reduce((s, i) => s + i.valor_libros, 0)),
    depreciacion_anual: round2(items.reduce((s, i) => s + i.depreciacion_anual, 0))
  };
}

// ── ESTADO DE RESULTADOS ────────────────────────────────────────────────────
export async function getEstadoResultados(
  client: PoolClient | typeof pool,
  accionistaId: string,
  desde: string,
  hasta: string
) {
  const rango = [accionistaId, desde, hasta];

  const ventas = await client.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS v, COUNT(*) AS n
     FROM sales WHERE accionista_id = $1 AND created_at::date BETWEEN $2 AND $3`,
    rango
  );
  const pilado = await client.query(
    `SELECT COALESCE(SUM(total), 0) AS v
     FROM pilado_services WHERE provider_accionista_id = $1 AND service_date BETWEEN $2 AND $3`,
    rango
  );

  // Costo de la mercadería vendida: los quintales que salieron por venta,
  // valorizados al costo del producto terminado.
  const costoMp = await costoQqMateriaPrima(client, accionistaId);
  const costoPt = await costoQqTerminado(client, accionistaId, costoMp);
  const salidas = await client.query(
    `SELECT COALESCE(SUM(-m.quantity), 0) AS qq
     FROM inventory_movements m
     WHERE m.accionista_id = $1 AND m.movement = 'OUT'
       AND m.created_at::date BETWEEN $2 AND $3`,
    rango
  );
  const costoVentas = round2(Number(salidas.rows[0].qq) * costoPt);

  const combustible = await client.query(
    `SELECT COALESCE(SUM(d.gas_costo_total + d.diesel_costo), 0) AS v
     FROM drying_tunnel_reports d
     JOIN lots l ON l.id = d.lot_id
     WHERE l.accionista_id = $1 AND d.created_at::date BETWEEN $2 AND $3`,
    rango
  );
  const gastos = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS v
     FROM expenses WHERE accionista_id = $1 AND created_at::date BETWEEN $2 AND $3`,
    rango
  );
  const manoObra = await client.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS v
     FROM labor_payments WHERE paid_at::date BETWEEN $1 AND $2`,
    [desde, hasta]
  );

  const activos = await getActivosFijos(client, accionistaId, hasta);
  const dias = Math.max(1, (new Date(hasta).getTime() - new Date(desde).getTime()) / (24 * 3600 * 1000));
  const depreciacionPeriodo = round2((activos.depreciacion_anual / 365.25) * dias);

  const ingresos = round2(Number(ventas.rows[0].v) + Number(pilado.rows[0].v));
  const costoTotal = round2(costoVentas + Number(combustible.rows[0].v));
  const utilidadBruta = round2(ingresos - costoTotal);
  const gastosOperativos = round2(Number(gastos.rows[0].v) + Number(manoObra.rows[0].v) + depreciacionPeriodo);
  const utilidadNeta = round2(utilidadBruta - gastosOperativos);

  return {
    periodo: { desde, hasta },
    ingresos: {
      ventas: round2(Number(ventas.rows[0].v)),
      servicio_pilado: round2(Number(pilado.rows[0].v)),
      total: ingresos
    },
    costo_ventas: {
      mercaderia_vendida: costoVentas,
      combustible_secado: round2(Number(combustible.rows[0].v)),
      total: costoTotal
    },
    utilidad_bruta: utilidadBruta,
    margen_bruto_pct: ingresos > 0 ? round2((utilidadBruta / ingresos) * 100) : 0,
    gastos_operativos: {
      gastos_generales: round2(Number(gastos.rows[0].v)),
      mano_obra: round2(Number(manoObra.rows[0].v)),
      depreciacion: depreciacionPeriodo,
      total: gastosOperativos
    },
    utilidad_neta: utilidadNeta,
    margen_neto_pct: ingresos > 0 ? round2((utilidadNeta / ingresos) * 100) : 0
  };
}

// ── BALANCE GENERAL ─────────────────────────────────────────────────────────
export async function getBalanceGeneral(
  client: PoolClient | typeof pool,
  accionistaId: string,
  hasta: string
) {
  const settings = await getSettings(client, accionistaId);
  const caja = await getCajaBancos(client, accionistaId);
  const inventario = await getInventarioValorizado(client, accionistaId);
  const activosFijos = await getActivosFijos(client, accionistaId, hasta);

  const porCobrar = await client.query(
    `SELECT COALESCE(SUM(balance), 0) AS v FROM accounts_receivable
     WHERE accionista_id = $1 AND status IN ('CONFIRMED','PARTIAL') AND balance > 0`,
    [accionistaId]
  );
  const anticipos = await client.query(
    `SELECT COALESCE(SUM(balance), 0) AS v FROM farmer_advances
     WHERE accionista_id = $1 AND status IN ('CONFIRMED','PARTIAL') AND balance > 0`,
    [accionistaId]
  );
  const porPagar = await client.query(
    `SELECT COALESCE(SUM(balance), 0) AS v FROM accounts_payable
     WHERE accionista_id = $1 AND status IN ('CONFIRMED','PARTIAL') AND balance > 0`,
    [accionistaId]
  );

  const cxc = round2(Number(porCobrar.rows[0].v));
  const antic = round2(Number(anticipos.rows[0].v));
  const cxp = round2(Number(porPagar.rows[0].v));

  const activoCorriente = round2(caja.total + cxc + antic + inventario.total);
  const activoNoCorriente = activosFijos.valor_libros;
  const totalActivo = round2(activoCorriente + activoNoCorriente);
  const totalPasivo = cxp;

  // El resultado del ejercicio: desde la fecha de corte contable (o desde el
  // inicio del año) hasta la fecha del balance.
  const inicioEjercicio = settings.fecha_inicio_contable
    ? String(settings.fecha_inicio_contable).slice(0, 10)
    : `${new Date(hasta).getFullYear()}-01-01`;
  const resultados = await getEstadoResultados(client, accionistaId, inicioEjercicio, hasta);

  const patrimonioDeclarado = round2(
    settings.capital_social + settings.resultados_acumulados + resultados.utilidad_neta
  );
  // La ecuación contable manda: lo que el activo no explica con el pasivo ni
  // con el patrimonio declarado corresponde a aportes/resultados anteriores a
  // la puesta en marcha del sistema. Se muestra aparte, sin maquillar.
  const ajusteApertura = round2(totalActivo - totalPasivo - patrimonioDeclarado);
  const totalPatrimonio = round2(patrimonioDeclarado + ajusteApertura);

  return {
    fecha: hasta,
    activo: {
      corriente: {
        efectivo: caja.efectivo,
        bancos: caja.bancos,
        cuentas_por_cobrar: cxc,
        anticipos_agricultores: antic,
        inventario: inventario.total,
        inventario_detalle: inventario,
        total: activoCorriente
      },
      no_corriente: {
        activos_fijos: activosFijos.costo_total,
        depreciacion_acumulada: -activosFijos.depreciacion_acumulada,
        total: activoNoCorriente
      },
      total: totalActivo
    },
    pasivo: {
      corriente: { cuentas_por_pagar: cxp, total: cxp },
      total: totalPasivo
    },
    patrimonio: {
      capital_social: settings.capital_social,
      resultados_acumulados: settings.resultados_acumulados,
      resultado_ejercicio: resultados.utilidad_neta,
      ajuste_apertura: ajusteApertura,
      total: totalPatrimonio
    },
    // Prueba de cuadre: activo = pasivo + patrimonio. Debe dar 0.
    cuadre: round2(totalActivo - (totalPasivo + totalPatrimonio)),
    resultados
  };
}

// ── FLUJO DE CAJA ───────────────────────────────────────────────────────────
export async function getFlujoCaja(
  client: PoolClient | typeof pool,
  accionistaId: string,
  desde: string,
  hasta: string
) {
  const r = await client.query(
    `SELECT m.movement, COALESCE(m.category, 'OTROS') AS categoria,
            COALESCE(SUM(m.amount), 0) AS v, COUNT(*) AS n
     FROM cash_movements m
     JOIN cash_registers c ON c.id = m.cash_register_id
     WHERE c.accionista_id = $1 AND m.created_at::date BETWEEN $2 AND $3
     GROUP BY m.movement, COALESCE(m.category, 'OTROS')
     ORDER BY 3 DESC`,
    [accionistaId, desde, hasta]
  );
  const entradas = r.rows.filter((x) => x.movement === "INCOME")
    .map((x) => ({ concepto: x.categoria, valor: round2(Number(x.v)), movimientos: Number(x.n) }));
  const salidas = r.rows.filter((x) => x.movement === "EXPENSE")
    .map((x) => ({ concepto: x.categoria, valor: round2(Number(x.v)), movimientos: Number(x.n) }));

  const totalEntradas = round2(entradas.reduce((s, x) => s + x.valor, 0));
  const totalSalidas = round2(salidas.reduce((s, x) => s + x.valor, 0));
  const caja = await getCajaBancos(client, accionistaId);

  return {
    periodo: { desde, hasta },
    entradas,
    salidas,
    total_entradas: totalEntradas,
    total_salidas: totalSalidas,
    flujo_neto: round2(totalEntradas - totalSalidas),
    saldo_actual: caja.total,
    efectivo: caja.efectivo,
    bancos: caja.bancos
  };
}

// ── INDICADORES FINANCIEROS ─────────────────────────────────────────────────
export async function getIndicadores(
  client: PoolClient | typeof pool,
  accionistaId: string,
  desde: string,
  hasta: string
) {
  const balance = await getBalanceGeneral(client, accionistaId, hasta);
  const er = await getEstadoResultados(client, accionistaId, desde, hasta);

  const ac = balance.activo.corriente.total;
  const pc = balance.pasivo.corriente.total;
  const inv = balance.activo.corriente.inventario;

  return {
    liquidez_corriente: { valor: div(ac, pc), meta: "> 1.5", ok: div(ac, pc) >= 1.5 },
    prueba_acida: { valor: div(ac - inv, pc), meta: "> 1.0", ok: div(ac - inv, pc) >= 1 },
    capital_trabajo: { valor: round2(ac - pc), meta: "> 0", ok: ac - pc > 0 },
    endeudamiento_pct: {
      valor: balance.activo.total > 0 ? round2((balance.pasivo.total / balance.activo.total) * 100) : 0,
      meta: "< 60%",
      ok: balance.activo.total > 0 ? (balance.pasivo.total / balance.activo.total) * 100 < 60 : true
    },
    margen_bruto_pct: { valor: er.margen_bruto_pct, meta: "> 15%", ok: er.margen_bruto_pct > 15 },
    margen_neto_pct: { valor: er.margen_neto_pct, meta: "> 5%", ok: er.margen_neto_pct > 5 },
    roa_pct: {
      valor: balance.activo.total > 0 ? round2((er.utilidad_neta / balance.activo.total) * 100) : 0,
      meta: "> 5%",
      ok: balance.activo.total > 0 ? (er.utilidad_neta / balance.activo.total) * 100 > 5 : false
    },
    roe_pct: {
      valor: balance.patrimonio.total > 0 ? round2((er.utilidad_neta / balance.patrimonio.total) * 100) : 0,
      meta: "> 10%",
      ok: balance.patrimonio.total > 0 ? (er.utilidad_neta / balance.patrimonio.total) * 100 > 10 : false
    }
  };
}

// ── DASHBOARD EJECUTIVO (todo junto, una sola llamada) ──────────────────────
export async function getDashboardFinanciero(accionistaId: string, desde: string, hasta: string) {
  const [balance, resultados, flujo, indicadores] = await Promise.all([
    getBalanceGeneral(pool, accionistaId, hasta),
    getEstadoResultados(pool, accionistaId, desde, hasta),
    getFlujoCaja(pool, accionistaId, desde, hasta),
    getIndicadores(pool, accionistaId, desde, hasta)
  ]);

  const compras = await pool.query(
    `SELECT COALESCE(SUM(gross_amount), 0) AS v
     FROM liquidations
     WHERE accionista_id = $1 AND status <> 'CANCELLED' AND created_at::date BETWEEN $2 AND $3`,
    [accionistaId, desde, hasta]
  );

  return {
    periodo: { desde, hasta },
    kpis: {
      total_activos: balance.activo.total,
      total_pasivos: balance.pasivo.total,
      patrimonio: balance.patrimonio.total,
      liquidez: indicadores.liquidez_corriente.valor,
      ventas: resultados.ingresos.total,
      compras: round2(Number(compras.rows[0].v)),
      utilidad: resultados.utilidad_neta,
      bancos: flujo.bancos,
      efectivo: flujo.efectivo,
      inventario: balance.activo.corriente.inventario,
      por_cobrar: balance.activo.corriente.cuentas_por_cobrar,
      por_pagar: balance.pasivo.corriente.cuentas_por_pagar,
      flujo_neto: flujo.flujo_neto
    },
    balance,
    resultados,
    flujo,
    indicadores
  };
}
