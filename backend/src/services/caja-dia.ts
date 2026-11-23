import type { PoolClient } from "pg";
import { ApiError } from "../http/error-handler.js";
import { hoyEc } from "../utils/fechas.js";
import { round2 } from "../utils/rice-formulas.js";
import { REF_PAGADO_CON_BANCO } from "./pagado-con-banco.js";

// 📒 CAJA DEL DÍA: la hoja de un día como el Excel del dueño. Saldo anterior + ingresos − egresos de la piladora − egresos
// de Transporte = saldo disponible, SOLO efectivo de la gaveta. Lo que no la mueve (banco, fiado, a su fomento, a crédito, lo
// pagó un socio) se ve en su renglón pero no suma. El día siguiente arranca con el saldo de libros, no con el conteo.

type Db = { query: PoolClient["query"] };
export type Bloque = "INGRESO" | "EGRESO" | "TRANSPORTE";
export type SinGaveta = "" | "banco" | "credito" | "socio" | "cuenta";

export type FilaDia = {
  k: string;
  /** hoja = escrito aquí; otro = lo registró otro módulo. */
  origen: "hoja" | "otro";
  bloque: Bloque;
  quien: string;
  detalle: string;
  monto: number;
  /** Lo que movió la gaveta: + entró, − salió, 0 no la movió. */
  efecto: number;
  sin_gaveta: SinGaveta;
  flujo: string;
  /** Nombre de la categoría del movimiento. */
  categoria: string | null;
  datos: Record<string, unknown>;
  reportar: string | null;
  reportado_at: string | null;
  reportado_nota: string | null;
  anulado: boolean;
  anulado_motivo: string | null;
  hora: string;
  por: string | null;
  movimientos: string[];
  maquina: string | null;
  socio: string | null;
};

type Mov = {
  id: string; movement: "INCOME" | "EXPENSE"; category: string; categoria_nombre: string | null; amount: number; description: string | null; reference_type: string | null;
  reference_id: string | null; created_at: Date; reversal_of: string | null; reversed_at: Date | null; reversed_reason: string | null; medio: string; renglon_id: string | null;
  maq_activo: string | null; area: string | null; por: string | null; socio: string | null; original_dia: string | null; anulado_dia: string | null;
};

// Lo que otro módulo dejó en la caja, leído de su descripción: quién y qué se hizo.
const PATRONES: Array<[RegExp, (m: RegExpMatchArray) => [string, string]]> = [
  [/^Venta detalle por asignar: (.+) · (.+?)(?: \(abono.*\))?$/, (m) => [m[2], m[1]]],
  [/^Venta detalle de (.+?): (.+) · (.+?)(?: \(se lo debes\))?$/, (m) => [m[3], `${m[2]} (de ${m[1]})`]],
  [/^Venta detalle (.+) · (.+)$/, (m) => [m[2], m[1]]],
  [/^Cobro crédito: (.+)$/, (m) => [m[1], "cobro de cuenta"]],
  [/^Cobro de (.+?) para (.+?) \(se lo debes\)/, (m) => [m[1], `cobro para ${m[2]}`]],
  [/^Abono de (.+?) para (.+?): (.+?) \(se lo debes\)$/, (m) => [m[1], `abono ${m[3]} (de ${m[2]})`]],
  [/^Pago por (.+?): (.+)$/, (m) => [m[2], `pago por ${m[1]}`]],
  [/^Pago a (.+)$/, (m) => [m[1], "pago de cuenta"]],
  [/^Fomento de (.+?) entregado a ([^·]+?)(?: · (.+))?$/, (m) => [m[2], m[3] ?? "fomento"]],
  [/^Fomento entregado a ([^·]+?)(?: · (.+))?$/, (m) => [m[1], m[2] ?? "fomento"]],
  [/^Pago de fomento de (.+)$/, (m) => [m[1], "devuelve fomento"]],
  [/^Arroz de (.+?): (.+)$/, (m) => ["", `${m[2]} (de ${m[1]})`]],
  [/^Gasto de (.+?): (.+)$/, (m) => [m[1], m[2]]],
  [/^Transporte y Cosechadora · (.+)$/, (m) => ["", m[1]]],
  [/^Mantenimiento ([^/]+)\/([^:]+): (.+)$/, (m) => [m[2], m[3]]]
];

/** Quién y qué se hizo, leído de la descripción que escribió otro módulo. Lógica pura. */
export function quienYQue(descripcion: string | null, categoria: string | null): [string, string] {
  const d = (descripcion ?? "").trim();
  if (!d) return ["", categoria ?? ""];
  for (const [re, f] of PATRONES) {
    const m = d.match(re);
    if (m) { const [q, x] = f(m); return [q.trim(), x.trim()]; }
  }
  const corte = d.indexOf(" · ");
  return corte > 0 && corte <= 40 ? [d.slice(0, corte).trim(), d.slice(corte + 3).trim()] : ["", d];
}

/** Qué es un movimiento que no se escribió en la hoja (mismos nombres que usa la pantalla). Lógica pura. */
export function flujoDeMovimiento(m: { category: string; reference_type: string | null; maq_activo?: string | null }): string {
  const c = m.category;
  const r = m.reference_type ?? "";
  if (r === "campo_cxp" || c === "GASTO_DE_TRANSPORTE") return "transporte";
  if (r === "fomento_entregas" || c === "FOMENTO_ENTREGA") return "fomento";
  if (r === "fomento_pagos" || c === "PAGO_FOMENTO") return "fomento_dev";
  if (r === "sales" || r === "venta_detalle_por_asignar" || c === "VENTA" || c === "VENTA_DETALLE_POR_ASIGNAR") return "venta";
  if (c === "COBRO_CREDITO" || c === "COBRO_POR_SOCIO") return "cobro";
  if (c === "PAGO_MANO_OBRA") return "nomina";
  if (r === "equipment_maintenance" || r === "repuesto_compra" || m.maq_activo) return "maquina";
  if (r === "farmer_advances" || c === "ANTICIPO_AGRICULTOR" || c === "PAGO_AGRICULTOR" || c === "LIQUIDACION_AGRICULTOR") return "agricultor";
  if (c === "GASTO_POR_SOCIO") return "socio";
  if (c === "PAGO_POR_SOCIO" || r === "accounts_payable") return "pago";
  if (c === "TRASPASO_INTERNO" || c === "RETIRO_BANCO") return "banco";
  if (r === "prestamo_persona") return "prestamo";
  if (c === "FALTANTE_CAJA" || c === "SOBRANTE_CAJA") return "arqueo";
  return "otro";
}

/** «13*20», «50+20», «3*0,25»: lo que suma una línea del conteo (sin eval). Lógica pura. */
export function cuentaLinea(texto: unknown): number {
  const t = String(texto ?? "").replace(/,/g, ".").replace(/[^\d.+*]/g, "");
  if (!t) return 0;
  return round2(t.split("+").reduce((s, parte) => s + (parte ? parte.split("*").reduce((m, x) => m * (Number(x) || 0), 1) : 0), 0));
}

const DIA = (col: string) => `(${col} AT TIME ZONE 'America/Guayaquil')::date`;

export type CajaHoja = { id: string; name: string; accionista_id: string; tipo: string; status: string; abierta: string; es_matriz: boolean };

export async function cajaDeLaHoja(db: Db, cajaId: string, accionistaId: string | null | undefined): Promise<CajaHoja> {
  const c = (await db.query(
    `SELECT r.id, r.name, r.accionista_id, r.tipo, r.status, ${DIA("r.opened_at")}::text AS abierta, a.tipo = 'MATRIZ' AS es_matriz
       FROM cash_registers r JOIN accionistas a ON a.id = r.accionista_id WHERE r.id = $1 AND r.accionista_id = $2`,
    [cajaId, accionistaId ?? null]
  )).rows[0] as CajaHoja | undefined;
  if (!c) throw new ApiError(404, "Caja no disponible para el accionista activo");
  return c;
}

/** Efectivo de la gaveta al empezar un día (todo lo de antes de las 00:00 de ese día en Ecuador). */
export async function saldoGavetaAntesDe(db: Db, cajaId: string, fecha: string): Promise<number> {
  const r = (await db.query(
    `SELECT COALESCE(cr.opening_balance_cash, CASE WHEN cr.tipo = 'BANCO' THEN 0 ELSE cr.opening_balance END, 0)::float AS apertura,
            COALESCE((SELECT sum(CASE WHEN m.movement = 'INCOME' THEN m.amount ELSE -m.amount END) FROM cash_movements m
                       WHERE m.cash_register_id = cr.id AND COALESCE(m.medio, 'EFECTIVO') = 'EFECTIVO' AND ${DIA("m.created_at")} < $2::date), 0)::float AS antes
       FROM cash_registers cr WHERE cr.id = $1`,
    [cajaId, fecha]
  )).rows[0] as { apertura: number; antes: number } | undefined;
  return r ? round2(r.apertura + r.antes) : 0;
}

const efectoDe = (m: Mov): number => (m.medio === "EFECTIVO" ? (m.movement === "INCOME" ? m.amount : -m.amount) : 0);
const maquinaDe = (m: Mov): string => [m.area, m.maq_activo].filter(Boolean).join(" · ");

type RenglonFila = {
  id: string; bloque: Bloque; quien: string; detalle: string; monto: number; sin_gaveta: SinGaveta; flujo: string; datos: Record<string, unknown> | null; reportar: string | null;
  reportado_at: Date | null; reportado_nota: string | null; anulado_at: Date | null; anulado_motivo: string | null; created_at: Date; por: string | null;
};

/** Arma las filas de un día con lo que hay en la base. Lógica pura (probada aparte). */
export function armarFilas(fecha: string, movs: Mov[], renglones: RenglonFila[]): { filas: FilaDia[]; anulados: FilaDia[] } {
  const filas: FilaDia[] = [];
  const anulados: FilaDia[] = [];
  const usados = new Set<string>();

  // 1 · Lo escrito en la hoja.
  for (const r of renglones) {
    const suyos = movs.filter((m) => m.renglon_id === r.id && !m.reversal_of);
    const ids = new Set(suyos.map((m) => m.id));
    for (const m of movs) if (ids.has(m.id) || (m.reversal_of && ids.has(m.reversal_of))) usados.add(m.id);
    const vigentes = suyos.filter((m) => !(m.reversed_at && m.anulado_dia === fecha));
    const anulado = !!r.anulado_at || (suyos.length > 0 && vigentes.length === 0);
    (anulado ? anulados : filas).push({
      k: `r:${r.id}`, origen: "hoja", bloque: r.bloque, quien: r.quien, detalle: r.detalle, monto: r.monto,
      efecto: anulado ? 0 : round2(vigentes.reduce((s, m) => s + efectoDe(m), 0)), sin_gaveta: r.sin_gaveta, flujo: r.flujo, categoria: suyos[0]?.categoria_nombre ?? null,
      datos: r.datos ?? {}, reportar: r.reportar, reportado_at: r.reportado_at?.toISOString() ?? null, reportado_nota: r.reportado_nota,
      anulado, anulado_motivo: r.anulado_motivo ?? suyos.find((m) => m.reversed_reason)?.reversed_reason ?? null, hora: r.created_at.toISOString(), por: r.por,
      movimientos: suyos.filter((m) => !m.reversed_at).map((m) => m.id), maquina: suyos.map(maquinaDe).find(Boolean) ?? null, socio: suyos.map((m) => m.socio).find(Boolean) ?? null
    });
  }

  // 2 · Lo que registró otro módulo.
  const libres = movs.filter((m) => !usados.has(m.id));
  // Líneas espejo que no son otro renglón: «lo pagó el socio» y «salió del banco / llegó al banco».
  const espejo = new Set<string>();
  const sinGaveta = new Map<string, SinGaveta>();
  for (const m of libres) {
    if (m.reversal_of || !m.reference_id) continue;
    if (m.reference_type === "pagado_por_socio" && m.movement === "INCOME") { espejo.add(m.id); sinGaveta.set(m.reference_id, "socio"); }
    if (m.reference_type === REF_PAGADO_CON_BANCO) { espejo.add(m.id); sinGaveta.set(m.reference_id, "banco"); }
  }
  for (const m of libres) {
    if (espejo.has(m.id)) continue;
    // Traspaso efectivo ↔ banco: solo se ve la línea de la gaveta.
    if (m.reference_type === "traspaso_interno" && m.medio !== "EFECTIVO") continue;
    // Anulado en el mismo día: ni el movimiento ni su contra-asiento.
    if (m.reversal_of && m.original_dia === fecha) continue;
    const anuladoHoy = !!m.reversed_at && m.anulado_dia === fecha;
    const sin: SinGaveta = sinGaveta.get(m.id) ?? (m.medio === "EFECTIVO" ? "" : "banco");
    const [quien, detalle] = m.reversal_of ? ["", m.description ?? "Anulación"] : quienYQue(m.description, m.categoria_nombre);
    const flujo = m.reversal_of ? "anulacion" : flujoDeMovimiento(m);
    (anuladoHoy ? anulados : filas).push({
      k: `m:${m.id}`, origen: "otro", bloque: m.movement === "INCOME" ? "INGRESO" : flujo === "transporte" ? "TRANSPORTE" : "EGRESO",
      quien, detalle, monto: m.amount, efecto: anuladoHoy || sin ? 0 : efectoDe(m), sin_gaveta: sin, flujo, categoria: m.categoria_nombre, datos: {},
      reportar: null, reportado_at: null, reportado_nota: null, anulado: anuladoHoy, anulado_motivo: m.reversed_reason, hora: m.created_at.toISOString(), por: m.por,
      movimientos: m.reversal_of || m.reversed_at ? [] : [m.id], maquina: maquinaDe(m) || null, socio: m.socio
    });
  }
  const porHora = (a: FilaDia, b: FilaDia) => (a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0);
  return { filas: filas.sort(porHora), anulados: anulados.sort(porHora) };
}

export async function leerDia(db: Db, caja: CajaHoja, fecha: string) {
  const anterior = await saldoGavetaAntesDe(db, caja.id, fecha);
  const movs = (await db.query(
    `SELECT m.id, m.movement, m.category, k.nombre AS categoria_nombre, m.amount::float AS amount, m.description, m.reference_type, m.reference_id, m.created_at,
            m.reversal_of, m.reversed_at, m.reversed_reason, COALESCE(m.medio, 'EFECTIVO') AS medio, m.renglon_id, m.maq_activo, m.area, u.name AS por, s.name AS socio,
            ${DIA("o.created_at")}::text AS original_dia,
            (SELECT ${DIA("x.created_at")}::text FROM cash_movements x WHERE x.reversal_of = m.id ORDER BY x.created_at LIMIT 1) AS anulado_dia
       FROM cash_movements m
       LEFT JOIN cash_categories k ON k.codigo = COALESCE(m.categoria_por_cuenta, m.category)
       LEFT JOIN users u ON u.id = m.created_by
       LEFT JOIN accionistas s ON s.id = m.por_cuenta_de
       LEFT JOIN cash_movements o ON o.id = m.reversal_of
      WHERE m.cash_register_id = $1 AND ${DIA("m.created_at")} = $2::date
      ORDER BY m.created_at, m.id`,
    [caja.id, fecha]
  )).rows as Mov[];
  const renglones = (await db.query(
    `SELECT r.id, r.bloque, r.quien, r.detalle, r.monto::float AS monto, r.sin_gaveta, r.flujo, r.datos, r.reportar, r.reportado_at, r.reportado_nota,
            r.anulado_at, r.anulado_motivo, r.created_at, u.name AS por
       FROM caja_renglones r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.cash_register_id = $1 AND r.fecha = $2::date ORDER BY r.created_at, r.id`,
    [caja.id, fecha]
  )).rows as RenglonFila[];
  const { filas, anulados } = armarFilas(fecha, movs, renglones);
  const suma = (b: Bloque, signo: 1 | -1) => round2(filas.filter((f) => f.bloque === b && f.efecto * signo > 0).reduce((s, f) => s + Math.abs(f.efecto), 0));
  const entro = round2(filas.filter((f) => f.efecto > 0).reduce((s, f) => s + f.efecto, 0));
  const salio = round2(filas.filter((f) => f.efecto < 0).reduce((s, f) => s - f.efecto, 0));
  // La verdad es la suma de los movimientos en efectivo del día; las filas solo la explican (descuadre debe ser 0).
  const neto = round2(movs.reduce((s, m) => s + efectoDe(m), 0));
  const disponible = round2(anterior + neto);
  const conteo = (await db.query(
    "SELECT lineas, apartado, contado::float AS contado, disponible::float AS disponible, diferencia::float AS diferencia, nota, updated_at FROM caja_conteos WHERE cash_register_id = $1 AND fecha = $2",
    [caja.id, fecha]
  )).rows[0] ?? null;
  const porReportar = (await db.query(
    `SELECT id, fecha::text AS fecha, quien, detalle, monto::float AS monto, reportar, flujo FROM caja_renglones
      WHERE cash_register_id = $1 AND reportar IS NOT NULL AND reportado_at IS NULL AND anulado_at IS NULL AND fecha <= $2::date ORDER BY fecha, created_at`,
    [caja.id, fecha]
  )).rows;
  return {
    caja: { id: caja.id, nombre: caja.name, tipo: caja.tipo, abierta: caja.abierta, estado: caja.status, es_matriz: caja.es_matriz },
    fecha, hoy: hoyEc(), anterior, filas, anulados,
    totales: { entro, salio, ingresos: suma("INGRESO", 1), piladora: suma("EGRESO", -1), transporte: suma("TRANSPORTE", -1), disponible, descuadre: round2(neto - (entro - salio)) },
    conteo, por_reportar: porReportar
  };
}
