import type { PoolClient } from "pg";
import type { pool as Pool } from "../db/pool.js";

/**
 * RESULTADO MENSUAL DE CEYRO (la hoja "COSTO <MES>" del usuario):
 *  1) Base: QQ de cáscara COMPRADA en el mes por las 3 operaciones (CEYRO,
 *     ROVINSON, STALYN) = liquidaciones no anuladas.
 *  2) Costos: egresos de las cajas de la MATRIZ del mes, repartidos en rubros
 *     (Gas, Diesel, Cuadrilla…) por sus CLAVES. Costo real = gasto / QQ cáscara;
 *     alerta si supera el costo estimado del rubro.
 *  3) Ingresos adicionales (NO ventas directas): báscula, tamo, servicios de
 *     pilada (terceros y a cada socio), secado y sacos a clientes, cobros de
 *     maquila a socios, interés de fomentos de las 3 operaciones + manuales.
 *     (La ganancia "Gana" por lote pilado la agrega el reporte con el mismo
 *     cálculo del módulo Gana.)
 *  4) Resultado neto = ingresos adicionales − costos − gastos financieros.
 * Solo LECTURA sobre los módulos existentes.
 */
type Db = PoolClient | typeof Pool;

/** Minúsculas, sin tildes y solo letras/números/_ separados por un espacio. */
export function normalizar(t: string | null | undefined): string {
  return String(t ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9_]+/g, " ")
    .trim();
}

/**
 * Rubro de un egreso por NIVELES de prioridad: primero lo que escribió el
 * usuario (subcategoría), luego la descripción/máquina/área, luego el origen
 * (p. ej. pago de sueldos) y al final la categoría de Caja. En cada nivel gana
 * la CLAVE más específica (más larga) que aparece como palabra/frase completa:
 * "gas" no confunde "gasolina" ni "gastos"; "cuadrilla guayaquil" gana sobre
 * "cuadrilla". Acepta un solo nivel (lista plana). null = sin clasificar.
 */
export function clasificarEgreso(
  niveles: Array<string | null | undefined> | Array<Array<string | null | undefined>>,
  rubros: Array<{ id: string; claves: string[] }>
): string | null {
  const lista = (Array.isArray(niveles[0]) ? niveles : [niveles]) as Array<Array<string | null | undefined>>;
  for (const textos of lista) {
    const blob = ` ${normalizar(textos.filter(Boolean).join(" "))} `;
    if (!blob.trim()) continue;
    let mejor: string | null = null;
    let largo = 0;
    for (const r of rubros) {
      for (const k of r.claves ?? []) {
        const kn = normalizar(k);
        if (kn && kn.length > largo && blob.includes(` ${kn} `)) { mejor = r.id; largo = kn.length; }
      }
    }
    if (mejor) return mejor;
  }
  return null;
}

/** Tipos de pago de nómina (todos salen de Caja con la categoría PAGO_MANO_OBRA). */
export const TIPOS_NOMINA = ["SUELDO_ADMIN", "CUADRILLA", "PILADOR", "ESTIBADOR", "SECADOR", "POLVILLO"] as const;
export type TipoNomina = (typeof TIPOS_NOMINA)[number];

/** Tipo de pago de nómina de un egreso (null si no es nómina o no se reconoce). */
export function tipoNomina(e: { category?: string | null; reference_type?: string | null; description?: string | null }): TipoNomina | null {
  if (String(e.category ?? "").toUpperCase() !== "PAGO_MANO_OBRA") return null;
  const ref = String(e.reference_type ?? "");
  if (ref === "admin_salary_payments") return "SUELDO_ADMIN";
  if (ref === "cuadrilla_entries") return "CUADRILLA";
  const rol = normalizar(e.description).match(/\b(pilador|estibador|secador|polvillo)\b/);
  return rol ? (rol[1].toUpperCase() as TipoNomina) : null;
}

export type RubroRegla = { id: string; claves: string[]; categorias?: string[]; nomina?: string[] };
export type EgresoClasificable = {
  category: string; categoria_nombre?: string | null; subcategoria?: string | null; description?: string | null;
  reference_type?: string | null; maq_activo?: string | null; area?: string | null;
};

/**
 * Rubro de un egreso de Caja (regla del usuario: "el gasto entra al rubro de la
 * categoría que elegí en Caja"):
 *  · NÓMINA (PAGO_MANO_OBRA): por tipo de pago → el rubro que tenga ese tipo.
 *    Un sueldo administrativo cuyo cargo nombra otro rubro ("Sueldo Cocinera
 *    María") va a ese rubro.
 *  · Resto: el rubro enlazado a su CATEGORÍA de Caja.
 *  · Respaldo (egresos antiguos sin categoría propia): claves en subcategoría,
 *    descripción, origen y nombre de la categoría.
 */
export function clasificarMovimiento(e: EgresoClasificable, rubros: RubroRegla[]): string | null {
  const tipo = tipoNomina(e);
  if (String(e.category ?? "").toUpperCase() === "PAGO_MANO_OBRA") {
    if (tipo === "SUELDO_ADMIN") {
      const porCargo = clasificarEgreso([[e.description]], rubros.filter((r) => !(r.nomina ?? []).includes("SUELDO_ADMIN")));
      if (porCargo) return porCargo;
    }
    if (tipo) {
      const r = rubros.find((x) => (x.nomina ?? []).includes(tipo));
      if (r) return r.id;
    }
    return clasificarEgreso([[e.subcategoria], [e.description]], rubros);
  }
  const codigo = String(e.category ?? "").toUpperCase();
  const porCategoria = rubros.find((x) => (x.categorias ?? []).some((c) => c.toUpperCase() === codigo));
  if (porCategoria) return porCategoria.id;
  return clasificarEgreso(
    [[e.subcategoria], [e.description, e.maq_activo, e.area], [e.reference_type], [e.categoria_nombre, e.category]], rubros
  );
}

/** Categorías de Caja que NO son costo operativo (compra de cáscara, fomentos,
 *  pagos entre socios, activos fijos, servicios que se pagan a otros…). */
export const CATEGORIAS_NO_OPERATIVAS = [
  "PAGO_AGRICULTOR", "LIQUIDACION_AGRICULTOR", "ANTICIPO_AGRICULTOR",
  "FOMENTO_ENTREGA", "FOMENTOS", "PAGO_FOMENTO",
  "COMPRA_ACTIVO_FIJO", "PAGO_ENTRE_SOCIOS",
  "PAGO_SERVICIO_PILADO", "PAGO_SERVICIO_MAQUILA", "PAGO_SELECCION", "REVERSA_COMPRA"
];

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type Movimiento = {
  fecha: string; descripcion: string; monto: number; categoria: string; subcategoria: string | null;
  /** Para clasificar desde el reporte: código de la categoría de Caja y tipo de nómina. */
  categoria_codigo: string; tipo_nomina: TipoNomina | null;
};

export async function calcularResultadoMensual(db: Db, opts: { year: number; month: number; matrizId: string; qqManual?: number | null }) {
  const periodo = `${opts.year}-${String(opts.month).padStart(2, "0")}`;
  const ini = `${periodo}-01`;
  const fin = opts.month === 12 ? `${opts.year + 1}-01-01` : `${opts.year}-${String(opts.month + 1).padStart(2, "0")}-01`;
  // Fechas en hora de Ecuador (el día contable del usuario).
  const enMes = (col: string) => `(${col} AT TIME ZONE 'America/Guayaquil')::date >= $1::date AND (${col} AT TIME ZONE 'America/Guayaquil')::date < $2::date`;

  // 1) Cáscara comprada por operación.
  const cascara = (await db.query(
    `SELECT a.name AS operacion, a.tipo, COALESCE(SUM(l.quintals), 0)::float AS qq, COUNT(l.id)::int AS liquidaciones
       FROM accionistas a
       LEFT JOIN liquidations l ON l.accionista_id = a.id AND l.status <> 'CANCELLED' AND ${enMes("l.created_at")}
      WHERE a.is_active = true
      GROUP BY a.id, a.name, a.tipo
      ORDER BY (a.tipo = 'MATRIZ') DESC, a.name`,
    [ini, fin]
  )).rows as Array<{ operacion: string; tipo: string; qq: number; liquidaciones: number }>;
  const qqAuto = r2(cascara.reduce((s, c) => s + Number(c.qq), 0));
  const qq = opts.qqManual && opts.qqManual > 0 ? opts.qqManual : qqAuto;

  // 2) Egresos de la Matriz del mes.
  const rubros = (await db.query(
    "SELECT id, nombre, costo_estimado_qq::float AS estimado, claves, categorias, nomina, orden FROM costo_rubros WHERE activo ORDER BY orden, nombre"
  )).rows as Array<{ id: string; nombre: string; estimado: number; claves: string[]; categorias: string[]; nomina: string[]; orden: number }>;
  const egresos = (await db.query(
    `SELECT m.id, to_char(m.created_at AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD') AS fecha, m.amount::float AS monto,
            m.category, cc.nombre AS categoria_nombre, m.subcategoria, m.description, m.reference_type, m.maq_activo, m.area
       FROM cash_movements m
       JOIN cash_registers r ON r.id = m.cash_register_id
       LEFT JOIN cash_categories cc ON cc.codigo = m.category
      WHERE r.accionista_id = $3 AND m.movement = 'EXPENSE'
        AND m.reversal_of IS NULL AND m.reversed_at IS NULL
        AND ${enMes("m.created_at")}
      ORDER BY m.created_at`,
    [ini, fin, opts.matrizId]
  )).rows as Array<{ id: string; fecha: string; monto: number; category: string; categoria_nombre: string | null; subcategoria: string | null; description: string | null; reference_type: string | null; maq_activo: string | null; area: string | null }>;

  const porRubro = new Map<string, { monto: number; detalle: Movimiento[] }>();
  const sinClasificar: Movimiento[] = [];
  const excluidos = new Map<string, number>();
  for (const e of egresos) {
    const mov: Movimiento = {
      fecha: e.fecha, monto: r2(e.monto), categoria: e.categoria_nombre ?? e.category, subcategoria: e.subcategoria,
      descripcion: e.description || e.subcategoria || e.categoria_nombre || e.category,
      categoria_codigo: e.category, tipo_nomina: tipoNomina(e)
    };
    if (CATEGORIAS_NO_OPERATIVAS.includes(String(e.category).toUpperCase())) {
      const k = e.categoria_nombre ?? e.category;
      excluidos.set(k, r2((excluidos.get(k) ?? 0) + mov.monto));
      continue;
    }
    const rubroId = clasificarMovimiento(e, rubros);
    if (!rubroId) { sinClasificar.push(mov); continue; }
    const acc = porRubro.get(rubroId) ?? { monto: 0, detalle: [] };
    acc.monto = r2(acc.monto + mov.monto);
    acc.detalle.push(mov);
    porRubro.set(rubroId, acc);
  }
  const filasRubros = rubros.map((r) => {
    const g = porRubro.get(r.id);
    const gasto = g?.monto ?? 0;
    const real = qq > 0 ? gasto / qq : 0;
    return {
      id: r.id, nombre: r.nombre, claves: r.claves, categorias: r.categorias, nomina: r.nomina, costo_estimado_qq: Number(r.estimado) || 0,
      gasto_total: gasto, costo_real_qq: Math.round(real * 10000) / 10000,
      alerta: Number(r.estimado) > 0 ? real > Number(r.estimado) + 1e-9 : gasto > 0,
      detalle: g?.detalle ?? []
    };
  });
  const montoSinClasificar = r2(sinClasificar.reduce((s, m) => s + m.monto, 0));
  const totalCostos = r2(filasRubros.reduce((s, r) => s + r.gasto_total, 0) + montoSinClasificar);
  const costoEstimadoQq = r2(filasRubros.reduce((s, r) => s + r.costo_estimado_qq, 0) * 100) / 100;

  // 3) Ingresos adicionales automáticos.
  const ingresos: Array<{ concepto: string; monto: number; origen: "auto" | "manual"; id?: string; nota?: string | null }> = [];
  const add = (concepto: string, monto: number) => { if (Math.abs(monto) > 0.004) ingresos.push({ concepto, monto: r2(monto), origen: "auto" }); };

  const ingresosCaja = (await db.query(
    `SELECT m.amount::float AS monto, m.category, cc.nombre AS categoria_nombre, m.subcategoria, m.description
       FROM cash_movements m
       JOIN cash_registers r ON r.id = m.cash_register_id
       LEFT JOIN cash_categories cc ON cc.codigo = m.category
      WHERE r.accionista_id = $3 AND m.movement = 'INCOME'
        AND m.reversal_of IS NULL AND m.reversed_at IS NULL AND ${enMes("m.created_at")}`,
    [ini, fin, opts.matrizId]
  )).rows as Array<{ monto: number; category: string; categoria_nombre: string | null; subcategoria: string | null; description: string | null }>;
  const ingresoCajaPor = (claves: string[]) => ingresosCaja
    .filter((m) => clasificarEgreso([[m.subcategoria], [m.description], [m.categoria_nombre, m.category]], [{ id: "x", claves }]))
    .reduce((s, m) => s + Number(m.monto), 0);

  const bascula = Number((await db.query(
    `SELECT COALESCE(SUM(amount), 0)::float AS t FROM accounts_receivable
      WHERE accionista_id = $3 AND reference_type = 'retencion_matriz' AND status <> 'CANCELLED' AND ${enMes("created_at")}`,
    [ini, fin, opts.matrizId]
  )).rows[0].t);
  add("Báscula", bascula + ingresoCajaPor(["bascula"]));
  add("Tamo", ingresoCajaPor(["tamo"]));

  const pilada = (await db.query(
    `SELECT COALESCE(a.name, 'Terceros (público)') AS cliente, SUM(ps.total)::float AS total
       FROM pilado_services ps
       LEFT JOIN accionistas a ON a.id = ps.client_accionista_id
      WHERE ps.provider_accionista_id = $3 AND ps.service_date >= $1::date AND ps.service_date < $2::date
      GROUP BY a.name ORDER BY (a.name IS NULL) DESC, a.name`,
    [ini, fin, opts.matrizId]
  )).rows as Array<{ cliente: string; total: number }>;
  for (const p of pilada) add(`Servicio de pilada · ${p.cliente}`, Number(p.total));

  const maquila = (await db.query(
    `SELECT a.name AS cliente, SUM(msc.monto)::float AS total
       FROM matriz_service_charges msc JOIN accionistas a ON a.id = msc.client_accionista_id
      WHERE msc.provider_accionista_id = $3 AND ${enMes("msc.created_at")}
      GROUP BY a.name ORDER BY a.name`,
    [ini, fin, opts.matrizId]
  )).rows as Array<{ cliente: string; total: number }>;
  for (const m of maquila) add(`Servicios cobrados a socio · ${m.cliente}`, Number(m.total));

  const arServ = (await db.query(
    `SELECT reference_type, COALESCE(SUM(amount), 0)::float AS t FROM accounts_receivable
      WHERE accionista_id = $3 AND reference_type IN ('secado_service', 'sacos_servicio') AND status <> 'CANCELLED'
        AND ${enMes("created_at")}
      GROUP BY reference_type`,
    [ini, fin, opts.matrizId]
  )).rows as Array<{ reference_type: string; t: number }>;
  add("Servicio de secado a clientes", Number(arServ.find((x) => x.reference_type === "secado_service")?.t ?? 0));
  add("Sacos vendidos en servicios de pilada", Number(arServ.find((x) => x.reference_type === "sacos_servicio")?.t ?? 0));

  // Interés de fomentos (gasto administrativo cobrado) de los fomentos cerrados
  // en el mes, por operación (misma fórmula del módulo Fomentos).
  const fomentos = (await db.query(
    `SELECT a.name AS operacion,
            SUM(CASE WHEN fe.es_saldo_anterior THEN fe.valor * f.renta * COALESCE(fe.meses_interes_fijo, 0)
                     ELSE fe.valor * f.renta / 30.0 * GREATEST(f.liquidado_at::date - fe.fecha, 0) END)::float AS interes
       FROM fomentos f
       JOIN fomento_entregas fe ON fe.fomento_id = f.id
       JOIN accionistas a ON a.id = f.accionista_id
      WHERE f.liquidado_at IS NOT NULL AND ${enMes("f.liquidado_at")}
      GROUP BY a.name ORDER BY a.name`,
    [ini, fin]
  )).rows as Array<{ operacion: string; interes: number }>;
  for (const f of fomentos) add(`Interés de fomentos · ${f.operacion}`, Number(f.interes));

  // Manuales del mes.
  const manuales = (await db.query(
    "SELECT id, seccion, concepto, monto::float AS monto, nota FROM resultado_mensual_manual WHERE periodo = $1 ORDER BY created_at",
    [periodo]
  )).rows as Array<{ id: string; seccion: string; concepto: string; monto: number; nota: string | null }>;
  for (const m of manuales.filter((x) => x.seccion === "INGRESO")) {
    ingresos.push({ concepto: m.concepto, monto: r2(m.monto), origen: "manual", id: m.id, nota: m.nota });
  }
  const financieros = manuales.filter((x) => x.seccion === "FINANCIERO").map((m) => ({ id: m.id, concepto: m.concepto, monto: r2(m.monto), nota: m.nota }));

  const totalIngresos = r2(ingresos.reduce((s, i) => s + i.monto, 0));
  const totalFinancieros = r2(financieros.reduce((s, f) => s + f.monto, 0));

  return {
    periodo,
    cascara: { operaciones: cascara, total_auto: qqAuto, total: qq, manual: Boolean(opts.qqManual && opts.qqManual > 0) },
    rubros: filasRubros,
    sin_clasificar: { monto: montoSinClasificar, detalle: sinClasificar },
    excluidos: [...excluidos.entries()].map(([categoria, monto]) => ({ categoria, monto })),
    total_costos: totalCostos,
    costo_real_qq: qq > 0 ? Math.round((totalCostos / qq) * 10000) / 10000 : 0,
    costo_estimado_qq: costoEstimadoQq,
    ingresos, total_ingresos: totalIngresos,
    financieros, total_financieros: totalFinancieros,
    // Sin la ganancia "Gana" (la suma el reporte con el cálculo del módulo Gana).
    resultado_neto_sin_gana: r2(totalIngresos - totalCostos - totalFinancieros)
  };
}
