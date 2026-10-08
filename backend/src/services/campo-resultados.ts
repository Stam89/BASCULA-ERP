// ── Transporte y Cosechadora · ESTADO DE RESULTADOS del período ─────────────
// Base DEVENGADA (como lo pide la contabilidad, no solo lo que pasó por caja):
//  · INGRESOS: servicios de cosecha y flete por su FECHA de servicio (aunque aún
//    no los cobren) + otros ingresos sueltos de caja (fletes fuera de báscula…)
//    + sobrantes de caja. Los cobros/abonos de servicios NO son ingreso (ya se
//    contó el servicio): se informan aparte como «cobrado».
//  · COSTOS Y GASTOS: egresos de caja por categoría (combustible, reparaciones…),
//    compras A CRÉDITO por la fecha de la compra (su pago posterior no se vuelve
//    a contar), nómina de operadores (pagos + vales descontados en la nómina),
//    ajustes de vales rendidos, reversiones y faltantes de caja.
//  · Los VALES POR RENDIR (anticipos) no son gasto hasta rendirse: van aparte.
//  · Con máquina asignada = COSTO DIRECTO de operación; sin máquina = GASTO GENERAL.
//  · No incluye depreciación de la maquinaria (no hay costo/vida útil registrados).
import type { PoolClient } from "pg";

type Db = { query: PoolClient["query"] };

export type LineaCruda = {
  clase: "ingreso" | "gasto";
  clave: string;            // concepto (ingreso) o categoría (gasto)
  activo_id: string | null;
  monto: number;
  grupo?: boolean | null;   // ingreso de un cliente del grupo (piladora/socios)
};
export type Activo = { id: string; nombre: string; tipo: string | null };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Nombre legible de una categoría de gasto de Campo. */
export function etiquetaGasto(clave: string): string {
  const k = clave.trim().toUpperCase();
  const fijas: Record<string, string> = {
    DIESEL: "Combustible · diésel",
    GASOLINA: "Combustible · gasolina",
    REPARACION_MANT: "Reparaciones y mantenimiento",
    MANTENIMIENTO_FLOTA: "Reparaciones y mantenimiento",
    NOMINA: "Nómina de operadores",
    MATRICULACION: "Matriculación y permisos",
    VIATICOS: "Viáticos",
    TRASLADO: "Traslados",
    OPERA: "Operación",
    OTROS: "Otros gastos",
    FALTANTE: "Faltantes de caja",
    SIN_CATEGORIA: "Gastos sin categoría",
    COMPRA_CREDITO: "Compras a crédito sin categoría"
  };
  if (fijas[k]) return fijas[k];
  const t = clave.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Orden de presentación de los gastos (lo más importante arriba). */
const ORDEN_GASTO = ["Combustible · diésel", "Combustible · gasolina", "Reparaciones y mantenimiento", "Nómina de operadores"];

type Linea = { concepto: string; monto: number };
type Bloque = { total: number; lineas: Linea[] };

function bloque(lineas: Map<string, number>, orden: string[] = []): Bloque {
  const arr = [...lineas.entries()]
    .map(([concepto, monto]) => ({ concepto, monto: r2(monto) }))
    .filter((l) => Math.abs(l.monto) >= 0.005)
    .sort((a, b) => {
      const ia = orden.indexOf(a.concepto), ib = orden.indexOf(b.concepto);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return b.monto - a.monto;
    });
  return { total: r2(arr.reduce((s, l) => s + l.monto, 0)), lineas: arr };
}

export type ResultadoPeriodo = {
  ingresos: Bloque & { del_grupo: number; de_terceros: number };
  costos_directos: Bloque;
  gastos_generales: Bloque;
  utilidad_bruta: number;
  resultado: number;
  margen_pct: number | null;
  combustible: number;
  por_maquina: Array<{ activo_id: string; nombre: string; tipo: string | null; ingresos: number; costos: number; resultado: number; margen_pct: number | null; qq: number }>;
};

/** Arma el estado de resultados a partir de las líneas crudas (puro: sin BD). */
export function armarResultado(lineas: LineaCruda[], activos: Activo[], qqPorActivo: Map<string, number> = new Map()): ResultadoPeriodo {
  const ing = new Map<string, number>();
  const dir = new Map<string, number>();
  const gen = new Map<string, number>();
  let delGrupo = 0, deTerceros = 0;
  const porMaq = new Map<string, { ingresos: number; costos: number }>();
  const maq = (id: string) => { if (!porMaq.has(id)) porMaq.set(id, { ingresos: 0, costos: 0 }); return porMaq.get(id)!; };

  for (const l of lineas) {
    const monto = Number(l.monto) || 0;
    if (l.clase === "ingreso") {
      ing.set(l.clave, (ing.get(l.clave) ?? 0) + monto);
      if (l.grupo === true) delGrupo += monto; else deTerceros += monto;
      if (l.activo_id) maq(l.activo_id).ingresos += monto;
    } else {
      const et = etiquetaGasto(l.clave);
      const destino = l.activo_id ? dir : gen;
      destino.set(et, (destino.get(et) ?? 0) + monto);
      if (l.activo_id) maq(l.activo_id).costos += monto;
    }
  }
  const ingresos = bloque(ing);
  const costos_directos = bloque(dir, ORDEN_GASTO);
  const gastos_generales = bloque(gen, ORDEN_GASTO);
  const utilidad_bruta = r2(ingresos.total - costos_directos.total);
  const resultado = r2(utilidad_bruta - gastos_generales.total);
  const combustible = r2([...costos_directos.lineas, ...gastos_generales.lineas]
    .filter((x) => x.concepto.startsWith("Combustible")).reduce((s, x) => s + x.monto, 0));

  const ids = new Set<string>([...porMaq.keys(), ...qqPorActivo.keys()]);
  const por_maquina = [...ids].map((id) => {
    const a = activos.find((x) => x.id === id);
    const v = porMaq.get(id) ?? { ingresos: 0, costos: 0 };
    const res = r2(v.ingresos - v.costos);
    return {
      activo_id: id, nombre: a?.nombre ?? "Máquina eliminada", tipo: a?.tipo ?? null,
      ingresos: r2(v.ingresos), costos: r2(v.costos), resultado: res,
      margen_pct: v.ingresos > 0.005 ? Math.round((res / v.ingresos) * 1000) / 10 : null,
      qq: r2(qqPorActivo.get(id) ?? 0)
    };
  }).sort((a, b) => b.resultado - a.resultado);

  return {
    ingresos: { ...ingresos, del_grupo: r2(delGrupo), de_terceros: r2(deTerceros) },
    costos_directos, gastos_generales, utilidad_bruta, resultado,
    margen_pct: ingresos.total > 0.005 ? Math.round((resultado / ingresos.total) * 1000) / 10 : null,
    combustible, por_maquina
  };
}

/** Rango [desde, hasta] del mes YYYY-MM y del mes anterior. */
export function rangoMes(mes: string): { desde: string; hasta: string; anterior: { mes: string; desde: string; hasta: string } } {
  const [y, m] = mes.split("-").map(Number);
  const fin = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return {
    desde: `${mes}-01`, hasta: fin(y, m),
    anterior: { mes: `${py}-${pad(pm)}`, desde: `${py}-${pad(pm)}-01`, hasta: fin(py, pm) }
  };
}

/** Líneas crudas de ingresos y gastos del período (todo filtrado en SQL). */
export async function lineasDelPeriodo(db: Db, desde: string, hasta: string): Promise<LineaCruda[]> {
  const r = await db.query(
    `-- Servicios prestados (devengado), por su fecha.
     SELECT 'ingreso' AS clase,
            CASE WHEN s.tipo = 'cosecha' THEN 'Servicios de cosecha' ELSE 'Servicios de flete y transporte' END AS clave,
            s.activo_id, s.valor::float AS monto, (cl.tipo = 'piladora') AS grupo
       FROM campo_servicios s
       LEFT JOIN campo_clientes cl ON cl.id = s.cliente_id
      WHERE s.fecha BETWEEN $1 AND $2
     UNION ALL
     -- Otros ingresos sueltos de caja (no son cobros de servicios ni de clientes).
     SELECT 'ingreso', 'Otros ingresos de caja', m.activo_id,
            (CASE WHEN m.naturaleza = 'reversion_ingreso' THEN -m.monto ELSE m.monto END)::float, NULL
       FROM campo_movimientos m
      WHERE m.fecha BETWEEN $1 AND $2
        AND ((m.naturaleza = 'operativo' AND m.signo = 'entrada'
              AND m.servicio_id IS NULL AND m.cliente_id IS NULL AND m.cxp_id IS NULL
              AND m.vale_id IS NULL AND m.par_id IS NULL AND m.caja_sesion_id IS NULL)
             OR m.naturaleza = 'reversion_ingreso')
     UNION ALL
     -- Sobrantes al cerrar caja.
     SELECT 'ingreso', 'Sobrantes de caja', NULL, m.monto::float, NULL
       FROM campo_movimientos m
      WHERE m.fecha BETWEEN $1 AND $2 AND m.naturaleza = 'ajuste_caja' AND m.signo = 'entrada'
     UNION ALL
     -- Gastos pagados por caja/banco (sin pagos de créditos: esos ya cuentan como compra).
     SELECT 'gasto',
            CASE WHEN m.naturaleza IN ('pago_nomina_operador', 'reversion_nomina') THEN 'NOMINA'
                 WHEN m.naturaleza = 'ajuste_caja' THEN 'FALTANTE'
                 WHEN m.estado = 'LIQUIDADO' AND m.concepto LIKE '%Descontado en nómina%' THEN 'NOMINA'
                 WHEN cat.nombre IS NOT NULL THEN cat.nombre
                 WHEN m.naturaleza = 'mantenimiento_flota' THEN 'MANTENIMIENTO_FLOTA'
                 ELSE 'SIN_CATEGORIA' END,
            m.activo_id,
            (CASE WHEN m.signo = 'salida' THEN m.monto ELSE -m.monto END)::float, NULL
       FROM campo_movimientos m
       LEFT JOIN campo_categorias_gasto cat ON cat.id = m.categoria_id
      WHERE m.fecha BETWEEN $1 AND $2
        AND ((m.naturaleza IN ('operativo', 'mantenimiento_flota') AND m.signo = 'salida'
              AND m.cxp_id IS NULL AND COALESCE(m.estado, '') <> 'PENDIENTE_RENDICION')
             OR m.naturaleza IN ('ajuste_vale', 'reversion_gasto', 'pago_nomina_operador', 'reversion_nomina')
             OR (m.naturaleza = 'ajuste_caja' AND m.signo = 'salida'))
     UNION ALL
     -- Compras a crédito: gasto en la fecha de la compra.
     SELECT 'gasto', COALESCE(cat.nombre, 'COMPRA_CREDITO'), c.activo_id, c.monto::float, NULL
       FROM campo_cxp c
       LEFT JOIN campo_categorias_gasto cat ON cat.id = c.categoria_id
      WHERE c.fecha BETWEEN $1 AND $2`,
    [desde, hasta]
  );
  return r.rows as LineaCruda[];
}

/** Datos informativos del período (no entran al resultado). */
export async function informativo(db: Db, desde: string, hasta: string) {
  const r = (await db.query(
    `SELECT
       (SELECT COALESCE(SUM(m.monto), 0)::float FROM campo_movimientos m
         WHERE m.fecha BETWEEN $1 AND $2 AND m.signo = 'entrada' AND m.naturaleza = 'operativo'
           AND (m.servicio_id IS NOT NULL OR m.cliente_id IS NOT NULL)) AS cobrado,
       (SELECT COALESCE(SUM(m.monto), 0)::float FROM campo_movimientos m
         WHERE m.fecha <= $2 AND m.signo = 'salida' AND m.estado = 'PENDIENTE_RENDICION') AS vales_por_rendir,
       (SELECT COUNT(*)::int FROM campo_movimientos m
         WHERE m.fecha <= $2 AND m.signo = 'salida' AND m.estado = 'PENDIENTE_RENDICION') AS vales_cantidad,
       (SELECT COALESCE(SUM(c.monto), 0)::float FROM campo_cxp c WHERE c.fecha BETWEEN $1 AND $2) AS compras_credito,
       (SELECT COALESCE(SUM(p.qq), 0)::float FROM campo_partes p WHERE p.fecha BETWEEN $1 AND $2) AS qq_trabajados`,
    [desde, hasta]
  )).rows[0];
  return r as { cobrado: number; vales_por_rendir: number; vales_cantidad: number; compras_credito: number; qq_trabajados: number };
}

export async function qqPorActivo(db: Db, desde: string, hasta: string): Promise<Map<string, number>> {
  const r = await db.query(
    "SELECT activo_id, SUM(qq)::float AS qq FROM campo_partes WHERE fecha BETWEEN $1 AND $2 AND activo_id IS NOT NULL GROUP BY activo_id",
    [desde, hasta]
  );
  return new Map(r.rows.map((x: { activo_id: string; qq: number }) => [x.activo_id, Number(x.qq) || 0]));
}

type Info = { cobrado: number; vales_por_rendir: number; vales_cantidad: number; compras_credito: number; qq_trabajados: number };
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Lectura de experto del resultado: lo que conviene mirar y corregir (puro). */
export function notasDelPeriodo(a: ResultadoPeriodo, anterior: { resultado: number; ingresos: number } | null, info: Info): string[] {
  const notas: string[] = [];
  const gastosTot = r2(a.costos_directos.total + a.gastos_generales.total);
  if (a.ingresos.total <= 0.005 && gastosTot <= 0.005) return ["Sin movimientos en el período."];
  notas.push(a.resultado >= 0
    ? `El período cerró con GANANCIA de ${usd(a.resultado)}${a.margen_pct != null ? ` (margen ${a.margen_pct}%)` : ""}.`
    : `El período cerró con PÉRDIDA de ${usd(-a.resultado)}: los costos y gastos (${usd(gastosTot)}) superaron a los ingresos (${usd(a.ingresos.total)}).`);
  if (anterior && (anterior.ingresos > 0.005 || Math.abs(anterior.resultado) > 0.005)) {
    const dif = r2(a.resultado - anterior.resultado);
    if (Math.abs(dif) >= 0.01) notas.push(`Frente al mes anterior el resultado ${dif > 0 ? "mejoró" : "empeoró"} en ${usd(Math.abs(dif))} (antes: ${usd(anterior.resultado)}).`);
  }
  const enPerdida = a.por_maquina.filter((m) => m.resultado < -0.005 && (m.ingresos > 0.005 || m.costos > 0.005));
  if (enPerdida.length) notas.push(`Máquina(s) en pérdida: ${enPerdida.map((m) => `${m.nombre} (${usd(m.resultado)})`).join(", ")}. Revisa su costo frente a lo que facturó.`);
  if (gastosTot > 0.005 && a.gastos_generales.total / gastosTot > 0.15) {
    notas.push(`${Math.round((a.gastos_generales.total / gastosTot) * 100)}% de los gastos (${usd(a.gastos_generales.total)}) no tiene máquina asignada: asígnala al registrar el egreso para saber qué máquina rinde de verdad.`);
  }
  if (a.ingresos.total > 0.005 && a.combustible > 0.005) {
    notas.push(`El combustible se llevó el ${Math.round((a.combustible / a.ingresos.total) * 100)}% de los ingresos (${usd(a.combustible)}).`);
  }
  if (info.vales_por_rendir > 0.005) {
    notas.push(`Hay ${usd(info.vales_por_rendir)} en ${info.vales_cantidad} vale(s) por rendir que todavía NO cuentan como gasto: cuando se rindan (o se descuenten en la nómina) bajarán el resultado.`);
  }
  if (a.ingresos.total > 0.005) {
    notas.push(`Se facturó ${usd(a.ingresos.total)} y entró a caja por cobros ${usd(info.cobrado)} (puede incluir cobros de meses anteriores). Lo que falta cobrar está en Cuentas por Cobrar.`);
  }
  notas.push("No incluye la depreciación (desgaste) de las máquinas: la ganancia real es algo menor.");
  return notas;
}
