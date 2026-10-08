// Alertas de Transporte y Cosechadora: lo que hay que atender HOY dentro del módulo.
//  · construirAlertas(): PURA (datos ya contados → alertas ordenadas). Con pruebas.
//  · reunirAlertas(): solo SELECT; cada bloque falla por separado (un error no tumba el resto).
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

type Db = Pick<PoolClient, "query">;

export type AlertaCampo = {
  key: string;
  nivel: "atencion" | "info";
  icono: string;
  titulo: string;
  detalle: string;
  /** Sección de Campo donde se resuelve (la interpreta el frontend). */
  seccion: "vales" | "partes" | "nomina" | "cxc" | "config";
};

export type DatosAlertasCampo = {
  vales: { n: number; monto: number; diasMasViejo: number };
  mantenimientos: { vencidos: Array<{ maquina: string; tipo: string; fecha: string }>; proximos: Array<{ maquina: string; tipo: string; fecha: string }> };
  partesPorCobrar: { n: number; qq: number; diasMasViejo: number };
  operadoresSinPagar: { operadores: number; partes: number; diasMasViejo: number };
  cartera: { monto: number; clientes: number; montoMas30: number };
};

/** Un vale sin rendir más de estos días pasa a «atención». */
export const DIAS_VALE_LARGO = 7;
/** Partes sin cobrar / sin pagar al operador más de estos días pasan a «atención». */
export const DIAS_PARTE_LARGO = 15;

const dinero = (n: number) => `$${n.toFixed(2)}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const tipoTxt = (t: string) => t.toLowerCase().replace(/_/g, " ");
const fechaCorta = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export function construirAlertas(d: DatosAlertasCampo): AlertaCampo[] {
  const a: AlertaCampo[] = [];

  if (d.mantenimientos.vencidos.length > 0) {
    const v = d.mantenimientos.vencidos;
    a.push({
      key: "mantenimiento-vencido", nivel: "atencion", icono: "🛠️",
      titulo: v.length === 1 ? `Mantenimiento vencido: ${v[0].maquina}` : `${v.length} mantenimientos vencidos`,
      detalle: v.slice(0, 3).map((x) => `${x.maquina} · ${tipoTxt(x.tipo)} (era para el ${fechaCorta(x.fecha)})`).join(" · ") + (v.length > 3 ? ` · y ${v.length - 3} más` : "") + ".",
      seccion: "config"
    });
  }
  if (d.mantenimientos.proximos.length > 0) {
    const p = d.mantenimientos.proximos;
    a.push({
      key: "mantenimiento-proximo", nivel: "info", icono: "🔧",
      titulo: p.length === 1 ? `Mantenimiento próximo: ${p[0].maquina}` : `${p.length} mantenimientos en los próximos 30 días`,
      detalle: p.slice(0, 3).map((x) => `${x.maquina} · ${tipoTxt(x.tipo)} (${fechaCorta(x.fecha)})`).join(" · ") + ".",
      seccion: "config"
    });
  }
  if (d.vales.n > 0) {
    const largo = d.vales.diasMasViejo > DIAS_VALE_LARGO;
    a.push({
      key: "vales-sin-rendir", nivel: largo ? "atencion" : "info", icono: "🧾",
      titulo: `${plural(d.vales.n, "vale sin rendir", "vales sin rendir")} por ${dinero(d.vales.monto)}`,
      detalle: largo ? `El más antiguo lleva ${d.vales.diasMasViejo} días: pide la rendición (lo gastado y el vuelto).` : "Anota lo realmente gastado cuando lo devuelvan.",
      seccion: "vales"
    });
  }
  if (d.operadoresSinPagar.partes > 0) {
    const largo = d.operadoresSinPagar.diasMasViejo > DIAS_PARTE_LARGO;
    a.push({
      key: "operadores-sin-pagar", nivel: largo ? "atencion" : "info", icono: "💵",
      titulo: `${plural(d.operadoresSinPagar.operadores, "operador", "operadores")} con ${plural(d.operadoresSinPagar.partes, "parte", "partes")} sin pagar`,
      detalle: largo ? `El más antiguo lleva ${d.operadoresSinPagar.diasMasViejo} días sin pagarse.` : "Se pagan desde Nómina Operadores.",
      seccion: "nomina"
    });
  }
  if (d.partesPorCobrar.n > 0) {
    const largo = d.partesPorCobrar.diasMasViejo > DIAS_PARTE_LARGO;
    a.push({
      key: "partes-por-cobrar", nivel: largo ? "atencion" : "info", icono: "📝",
      titulo: `${plural(d.partesPorCobrar.n, "parte por cobrar", "partes por cobrar")} (${d.partesPorCobrar.qq.toFixed(2)} QQ)`,
      detalle: largo ? `El más antiguo lleva ${d.partesPorCobrar.diasMasViejo} días sin cobrarse: genera el cobro.` : "Genera el cobro desde Partes Diarios.",
      seccion: "partes"
    });
  }
  if (d.cartera.monto > 0.004) {
    const viejo = d.cartera.montoMas30 > 0.004;
    a.push({
      key: "cartera", nivel: viejo ? "atencion" : "info", icono: "📥",
      titulo: `Por cobrar a ${plural(d.cartera.clientes, "cliente", "clientes")}: ${dinero(d.cartera.monto)}`,
      detalle: viejo ? `${dinero(d.cartera.montoMas30)} tienen más de 30 días.` : "Nada con más de 30 días.",
      seccion: "cxc"
    });
  }
  const orden = { atencion: 0, info: 1 } as const;
  return a.map((x, i) => ({ x, i })).sort((p, q) => orden[p.x.nivel] - orden[q.x.nivel] || p.i - q.i).map(({ x }) => x);
}

async function seguro<T>(nombre: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { console.error(`[campo-alertas] «${nombre}» falló: ${(e as Error).message}`); return fallback; }
}
const HOY = "(now() AT TIME ZONE 'America/Guayaquil')::date";

export async function reunirAlertas(db: Db = pool): Promise<DatosAlertasCampo> {
  const vales = await seguro("vales", { n: 0, monto: 0, diasMasViejo: 0 }, async () => {
    const r = (await db.query(
      `SELECT COUNT(*)::int n, COALESCE(SUM(monto), 0)::float monto, COALESCE(MAX(${HOY} - fecha), 0)::int dias
         FROM campo_movimientos WHERE signo = 'salida' AND estado = 'PENDIENTE_RENDICION' AND reversado_at IS NULL`
    )).rows[0];
    return { n: Number(r.n), monto: Number(r.monto), diasMasViejo: Number(r.dias) };
  });

  const mantenimientos = await seguro("mantenimientos", { vencidos: [], proximos: [] }, async () => {
    const rows = (await db.query(
      `SELECT a.nombre AS maquina, mt.tipo, mt.proxima_fecha::text AS fecha, (mt.proxima_fecha < ${HOY}) AS vencido
         FROM campo_mantenimientos mt JOIN campo_activos a ON a.id = mt.activo_id
        WHERE mt.anulado_at IS NULL AND mt.proxima_fecha IS NOT NULL AND mt.proxima_fecha <= ${HOY} + 30 AND a.activo = true
          -- si después se volvió a hacer el mismo tipo en esa máquina, la fecha vieja ya no cuenta
          AND NOT EXISTS (
            SELECT 1 FROM campo_mantenimientos m2
             WHERE m2.activo_id = mt.activo_id AND m2.tipo = mt.tipo AND m2.anulado_at IS NULL AND m2.id <> mt.id
               AND (m2.fecha > mt.fecha OR (m2.fecha = mt.fecha AND m2.created_at > mt.created_at)))
        ORDER BY mt.proxima_fecha LIMIT 20`
    )).rows as Array<{ maquina: string; tipo: string; fecha: string; vencido: boolean }>;
    return {
      vencidos: rows.filter((x) => x.vencido).map(({ maquina, tipo, fecha }) => ({ maquina, tipo, fecha })),
      proximos: rows.filter((x) => !x.vencido).map(({ maquina, tipo, fecha }) => ({ maquina, tipo, fecha }))
    };
  });

  const partesPorCobrar = await seguro("partes-por-cobrar", { n: 0, qq: 0, diasMasViejo: 0 }, async () => {
    const r = (await db.query(
      `SELECT COUNT(*)::int n, COALESCE(SUM(qq), 0)::float qq, COALESCE(MAX(${HOY} - fecha), 0)::int dias
         FROM campo_partes p
        WHERE p.estado = 'por_cobrar'
          AND NOT EXISTS (SELECT 1 FROM liquidation_harvest_details d JOIN liquidations l ON l.id = d.liquidation_id
                           WHERE d.campo_parte_id = p.id AND l.status <> 'CANCELLED')`
    )).rows[0];
    return { n: Number(r.n), qq: Number(r.qq), diasMasViejo: Number(r.dias) };
  });

  const operadoresSinPagar = await seguro("operadores", { operadores: 0, partes: 0, diasMasViejo: 0 }, async () => {
    const r = (await db.query(
      `SELECT COUNT(DISTINCT lower(trim(operador)))::int operadores, COUNT(*)::int partes, COALESCE(MAX(${HOY} - fecha), 0)::int dias
         FROM campo_partes WHERE operador IS NOT NULL AND trim(operador) <> '' AND operador_pagado_at IS NULL`
    )).rows[0];
    return { operadores: Number(r.operadores), partes: Number(r.partes), diasMasViejo: Number(r.dias) };
  });

  const cartera = await seguro("cartera", { monto: 0, clientes: 0, montoMas30: 0 }, async () => {
    const r = (await db.query(
      `SELECT COALESCE(SUM(v.saldo_pendiente), 0)::float monto, COUNT(DISTINCT s.cliente_id)::int clientes,
              COALESCE(SUM(v.saldo_pendiente) FILTER (WHERE s.fecha < ${HOY} - 30), 0)::float mas30
         FROM campo_servicios s JOIN campo_servicios_saldo v ON v.id = s.id WHERE v.saldo_pendiente > 0.005`
    )).rows[0];
    return { monto: Number(r.monto), clientes: Number(r.clientes), montoMas30: Number(r.mas30) };
  });

  return { vales, mantenimientos, partesPorCobrar, operadoresSinPagar, cartera };
}

export async function alertasDeCampo(): Promise<AlertaCampo[]> {
  return construirAlertas(await reunirAlertas(pool));
}
