// «Hoy»: lista corta de lo que hay que hacer AHORA, armada con los datos del ERP.
// Cada tarea lleva a la pantalla donde se resuelve. Aquí hay dos partes:
//  · construirTareas(): función PURA (datos ya contados → tareas ordenadas). Con pruebas.
//  · reunirDatos(): consultas de solo lectura a la base (cada bloque falla por separado:
//    si una consulta se cae, el resto de «Hoy» sigue funcionando).
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { contarBajadasSinNombre, contarNombresPorRevisar } from "../routes/modules/cuadrilla.js";
import { resumenIntegridad } from "./consistencia.js";
import { documentosPorVencer } from "./campo-alertas.js";

type Db = Pick<PoolClient, "query">;

export type NivelTarea = "urgente" | "atencion" | "info";
export type TareaHoy = {
  key: string;
  nivel: NivelTarea;
  icono: string;
  titulo: string;
  detalle: string;
  /** Pestaña del menú donde se resuelve (clave interna). */
  tab: string;
  /** Sección dentro de la pestaña (la interpreta el frontend). */
  sub?: string;
  accion: string;
};

export type DatosHoy = {
  /** Día de la semana en Ecuador: 0=domingo … 5=viernes, 6=sábado. */
  dow: number;
  caja: { abierta: boolean; diasAbierta: number };
  tuneles: {
    enProceso: Array<{ tunel: number; motor: number | null; horas: number }>;
    motoresSinCombustible: number[];
  };
  nomina: { aplica: boolean; monto: number; personas: number; bajadasSinNombre: number; nombresPorRevisar: number };
  cxc: { n: number; monto: number };
  cxp: { n: number; monto: number };
  pedidos: { pendientes: number; paraHoy: number };
  puesta: { aplica: boolean; faltantes: string[] };
  /** Cuotas de préstamos del banco: vencidas y las que se cobran pronto (opcional). */
  prestamos?: {
    vencidas: Array<{ banco: string; fecha: string; monto: number }>;
    proximas: Array<{ banco: string; fecha: string; monto: number; dias: number }>;
  };
  /** Documentos de la flota de Transporte (solo la Matriz): vencidos y por vencer (opcional). */
  documentosFlota?: { vencidos: Array<{ maquina: string; documento: string; fecha: string; dias: number }>; proximos: Array<{ maquina: string; documento: string; fecha: string; dias: number }> };
  /** Solo administrador: controles de integridad entre módulos que fallan (opcional: sin dato no se muestra nada). */
  integridad?: { problemas: number; nombres: string[] };
};

/** Horas a partir de las cuales un túnel «lleva mucho»: los secados reales duran ~13–16 h. */
export const HORAS_TUNEL_LARGO = 18;

const dinero = (n: number) => `$${n.toFixed(2)}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const horasTxt = (h: number) => (h < 1 ? "menos de 1 h" : `${Math.round(h)} h`);
const ORDEN: Record<NivelTarea, number> = { urgente: 0, atencion: 1, info: 2 };
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (iso: string) => `${Number(iso.slice(8, 10))} ${MESES_CORTOS[Number(iso.slice(5, 7)) - 1] ?? ""}`;

export function construirTareas(d: DatosHoy): TareaHoy[] {
  const t: TareaHoy[] = [];

  // ── Secadoras ────────────────────────────────────────────────────────────
  for (const motor of d.tuneles.motoresSinCombustible) {
    t.push({
      key: `combustible-motor-${motor}`, nivel: "urgente", icono: "⛽",
      titulo: `Falta el combustible del Motor ${motor}`,
      detalle: "Su secado ya terminó pero el gas/diésel no está registrado: sin eso el costo del secado queda incompleto.",
      tab: "Secadoras", accion: "Registrar combustible"
    });
  }
  const largos = d.tuneles.enProceso.filter((x) => x.horas > HORAS_TUNEL_LARGO);
  if (largos.length > 0) {
    t.push({
      key: "tuneles-largos", nivel: "atencion", icono: "🔥",
      titulo: largos.length === 1 ? `El Túnel ${largos[0].tunel} lleva ${horasTxt(largos[0].horas)} secando` : `${largos.length} túneles llevan mucho tiempo secando`,
      detalle: `${largos.map((x) => `Túnel ${x.tunel}${x.motor ? ` (Motor ${x.motor})` : ""}: ${horasTxt(x.horas)}`).join(" · ")}. ¿Ya terminó? Fíjate y finalízalo.`,
      tab: "Secadoras", accion: "Ver secadoras"
    });
  } else if (d.tuneles.enProceso.length > 0) {
    t.push({
      key: "tuneles-en-proceso", nivel: "info", icono: "🔥",
      titulo: d.tuneles.enProceso.length === 1 ? "1 túnel secando" : `${d.tuneles.enProceso.length} túneles secando`,
      detalle: d.tuneles.enProceso.map((x) => `Túnel ${x.tunel}${x.motor ? ` (Motor ${x.motor})` : ""}: ${horasTxt(x.horas)}`).join(" · "),
      tab: "Secadoras", accion: "Ver secadoras"
    });
  }

  // ── Nómina ───────────────────────────────────────────────────────────────
  if (d.nomina.aplica) {
    if (d.nomina.bajadasSinNombre > 0) {
      t.push({
        key: "bajadas-sin-nombre", nivel: "atencion", icono: "🚚",
        titulo: `${plural(d.nomina.bajadasSinNombre, "ticket sin", "tickets sin")} quién bajó el carro`,
        detalle: "Sin nombre no se les puede pagar la bajada de carro. Ponles el nombre o márcalos «no se paga».",
        tab: "Nomina", sub: "bajada", accion: "Completar nombres"
      });
    }
    if (d.nomina.nombresPorRevisar > 0) {
      t.push({
        key: "bajadas-nombre-dudoso", nivel: "atencion", icono: "🔎",
        titulo: `${plural(d.nomina.nombresPorRevisar, "ticket con un nombre por revisar", "tickets con un nombre por revisar")} en bajada de carro`,
        detalle: "La báscula los trae con varias personas («JOSE/ROBERTO»), mal escritos o con un nombre poco usual. Confírmalos antes de pagar: un clic y listo.",
        tab: "Nomina", sub: "bajada", accion: "Revisar nombres"
      });
    }
    if (d.nomina.monto > 0.004) {
      const viernesOSabado = d.dow === 5 || d.dow === 6;
      t.push({
        key: "nomina-pendiente", nivel: viernesOSabado ? "atencion" : "info", icono: "💵",
        titulo: `Por pagar en Nómina: ${dinero(d.nomina.monto)}`,
        detalle: `${plural(d.nomina.personas, "persona", "personas")} con pago pendiente${viernesOSabado ? " · hoy toca pagar la semana (sábado → viernes)" : ""}.`,
        tab: "Nomina", sub: "pagos", accion: "Ir a pagos"
      });
    }
  }

  // ── Caja ─────────────────────────────────────────────────────────────────
  if (!d.caja.abierta) {
    t.push({
      key: "caja-cerrada", nivel: "atencion", icono: "💰",
      titulo: "No hay caja abierta",
      detalle: "Ábrela para poder registrar ingresos, egresos y pagos en efectivo.",
      tab: "Caja", accion: "Abrir caja"
    });
  } else if (d.caja.diasAbierta >= 1) {
    t.push({
      key: "caja-vieja", nivel: "atencion", icono: "🔒",
      titulo: d.caja.diasAbierta === 1 ? "La caja sigue abierta desde ayer" : `La caja lleva ${d.caja.diasAbierta} días abierta`,
      detalle: "Haz el cierre y el arqueo del día para que los saldos queden bien cortados.",
      tab: "Caja", accion: "Cerrar caja"
    });
  }

  // ── Cuentas ──────────────────────────────────────────────────────────────
  if (d.cxc.n > 0) {
    t.push({
      key: "cxc-vencidas", nivel: "atencion", icono: "📥",
      titulo: `${plural(d.cxc.n, "cobro vencido", "cobros vencidos")} por ${dinero(d.cxc.monto)}`,
      detalle: "Clientes que ya pasaron su fecha de pago.",
      tab: "Por Cobrar", accion: "Ver cobros"
    });
  }
  if (d.cxp.n > 0) {
    t.push({
      key: "cxp-vencidas", nivel: "atencion", icono: "📤",
      titulo: `${plural(d.cxp.n, "pago vencido", "pagos vencidos")} por ${dinero(d.cxp.monto)}`,
      detalle: "Cuentas por pagar que ya pasaron su fecha.",
      tab: "Por Pagar", accion: "Ver pagos"
    });
  }

  // ── Préstamos del banco ──────────────────────────────────────────────────
  if (d.prestamos && d.prestamos.vencidas.length > 0) {
    const v = d.prestamos.vencidas;
    const total = v.reduce((s, x) => s + x.monto, 0);
    t.push({
      key: "prestamo-vencido", nivel: "urgente", icono: "🏦",
      titulo: v.length === 1 ? `Cuota del préstamo ${v[0].banco} vencida (${dinero(v[0].monto)})` : `${v.length} cuotas de préstamos vencidas por ${dinero(total)}`,
      detalle: `${v.slice(0, 2).map((x) => `${x.banco}: venció el ${fechaCorta(x.fecha)}`).join(" · ")}${v.length > 2 ? ` · y ${v.length - 2} más` : ""}. Si el banco ya la cobró, regístrala para que la caja cuadre.`,
      tab: "Por Pagar", sub: "prestamos", accion: "Pagar cuota"
    });
  }
  if (d.prestamos && d.prestamos.proximas.length > 0) {
    const p = d.prestamos.proximas;
    t.push({
      key: "prestamo-proximo", nivel: p.some((x) => x.dias <= 1) ? "atencion" : "info", icono: "🏦",
      titulo: p.length === 1
        ? `${p[0].dias === 0 ? "Hoy" : p[0].dias === 1 ? "Mañana" : `En ${p[0].dias} días`} cobra el banco la cuota del préstamo ${p[0].banco} (${dinero(p[0].monto)})`
        : `${p.length} cuotas de préstamos se cobran esta semana`,
      detalle: `${p.slice(0, 3).map((x) => `${x.banco}: ${fechaCorta(x.fecha)} · ${dinero(x.monto)}`).join(" · ")}. Ten el dinero en el banco.`,
      tab: "Por Pagar", sub: "prestamos", accion: "Ver préstamos"
    });
  }

  // ── Documentos de la flota (Transporte y Cosechadora) ────────────────────
  if (d.documentosFlota && d.documentosFlota.vencidos.length > 0) {
    const v = d.documentosFlota.vencidos;
    t.push({
      key: "documento-flota-vencido", nivel: "urgente", icono: "📄",
      titulo: v.length === 1 ? `${v[0].documento} de ${v[0].maquina} está vencido` : `${v.length} documentos de vehículos vencidos`,
      detalle: `${v.slice(0, 3).map((x) => `${x.maquina}: ${x.documento} venció el ${fechaCorta(x.fecha)}`).join(" · ")}${v.length > 3 ? ` · y ${v.length - 3} más` : ""}. Renuévalo y actualiza la fecha.`,
      tab: "Caja de Campo", sub: "config", accion: "Ver documentos"
    });
  }
  if (d.documentosFlota && d.documentosFlota.proximos.length > 0) {
    const p = d.documentosFlota.proximos;
    t.push({
      key: "documento-flota-proximo", nivel: p.some((x) => x.dias <= 7) ? "atencion" : "info", icono: "📄",
      titulo: p.length === 1
        ? `${p[0].documento} de ${p[0].maquina} vence ${p[0].dias === 0 ? "hoy" : p[0].dias === 1 ? "mañana" : `en ${p[0].dias} días`}`
        : `${p.length} documentos de vehículos vencen pronto`,
      detalle: `${p.slice(0, 3).map((x) => `${x.maquina}: ${x.documento} ${fechaCorta(x.fecha)}`).join(" · ")}${p.length > 3 ? ` · y ${p.length - 3} más` : ""}.`,
      tab: "Caja de Campo", sub: "config", accion: "Ver documentos"
    });
  }

  // ── Ventas ───────────────────────────────────────────────────────────────
  if (d.pedidos.pendientes > 0) {
    const hoy = d.pedidos.paraHoy;
    t.push({
      key: "pedidos-pendientes", nivel: hoy > 0 ? "atencion" : "info", icono: "📦",
      titulo: `${plural(d.pedidos.pendientes, "pedido por entregar", "pedidos por entregar")}`,
      detalle: hoy > 0 ? `${plural(hoy, "es para hoy o está atrasado", "son para hoy o están atrasados")}.` : "Ninguno vence hoy.",
      tab: "Ventas", accion: "Ver pedidos"
    });
  }

  // ── Integridad entre módulos (solo administrador) ────────────────────────
  if (d.integridad && d.integridad.problemas > 0) {
    const n = d.integridad.problemas;
    t.push({
      key: "integridad", nivel: "urgente", icono: "🩺",
      titulo: `${plural(n, "control de integridad falla", "controles de integridad fallan")}`,
      detalle: `${d.integridad.nombres.slice(0, 2).join(" · ")}${n > 2 ? ` · y ${n - 2} más` : ""}. Algo no cuadra entre módulos: revísalo antes de seguir.`,
      tab: "Configuracion", sub: "integridad", accion: "Ver controles"
    });
  }

  // ── Puesta en marcha (solo administrador) ────────────────────────────────
  if (d.puesta.aplica && d.puesta.faltantes.length > 0) {
    const f = d.puesta.faltantes;
    t.push({
      key: "puesta-en-marcha", nivel: "atencion", icono: "🧭",
      titulo: `Faltan ${plural(f.length, "paso", "pasos")} de la puesta en marcha`,
      detalle: `${f.slice(0, 3).join(" · ")}${f.length > 3 ? ` · y ${f.length - 3} más` : ""}.`,
      tab: "Configuracion", sub: "puesta", accion: "Ver pasos"
    });
  }

  // Orden estable: urgente → atención → info (dentro de cada nivel, el orden de arriba).
  return t.map((x, i) => ({ x, i })).sort((a, b) => ORDEN[a.x.nivel] - ORDEN[b.x.nivel] || a.i - b.i).map(({ x }) => x);
}

// ── Lectura de datos (solo SELECT) ──────────────────────────────────────────
async function seguro<T>(nombre: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { console.error(`[hoy] «${nombre}» falló: ${(e as Error).message}`); return fallback; }
}

export async function reunirDatos(
  db: Db,
  ctx: { accionistaId: string; esMatriz: boolean; esAdmin: boolean; faltantesPuesta: () => Promise<string[]> }
): Promise<DatosHoy> {
  const acc = ctx.accionistaId;

  const dow = await seguro("dia", 0, async () =>
    Number((await db.query("SELECT extract(dow FROM (now() AT TIME ZONE 'America/Guayaquil'))::int AS d")).rows[0].d));

  const caja = await seguro("caja", { abierta: true, diasAbierta: 0 }, async () => {
    const r = (await db.query(
      `SELECT ((now() AT TIME ZONE 'America/Guayaquil')::date - (opened_at AT TIME ZONE 'America/Guayaquil')::date)::int AS dias
         FROM cash_registers WHERE status = 'OPEN' AND accionista_id = $1
        ORDER BY opened_at ASC LIMIT 1`,
      [acc]
    )).rows[0];
    return r ? { abierta: true, diasAbierta: Math.max(0, Number(r.dias)) } : { abierta: false, diasAbierta: 0 };
  });

  const tuneles = await seguro("tuneles", { enProceso: [], motoresSinCombustible: [] }, async () => {
    const filtroLote = ctx.esMatriz ? "" : "AND l.accionista_id = $1";
    const params = ctx.esMatriz ? [] : [acc];
    const enProceso = (await db.query(
      `SELECT d.tunnel_number AS tunel, d.motor_number AS motor,
              MAX(EXTRACT(EPOCH FROM (now() - COALESCE(d.dry_start_at, d.created_at))) / 3600)::float AS horas
         FROM drying_tunnel_reports d LEFT JOIN lots l ON l.id = d.lot_id
        WHERE d.status = 'IN_PROGRESS' AND COALESCE(d.dry_method, 'TUNEL') <> 'TENDAL' ${filtroLote}
        GROUP BY d.tunnel_number, d.motor_number ORDER BY d.tunnel_number`,
      params
    )).rows.map((r) => ({ tunel: Number(r.tunel), motor: r.motor == null ? null : Number(r.motor), horas: Math.max(0, Number(r.horas)) }));
    const sinComb = (await db.query(
      `SELECT DISTINCT d.motor_number AS motor
         FROM drying_tunnel_reports d LEFT JOIN lots l ON l.id = d.lot_id
        WHERE d.status = 'COMPLETED' AND d.motor_number IN (1, 2)
          AND (d.motor_fuel_id IS NULL OR d.motor_fuel_id IN (SELECT id FROM motor_fuel_records WHERE pendiente))
          AND COALESCE(d.dry_method, 'TUNEL') <> 'TENDAL' ${filtroLote} ORDER BY 1`,
      params
    )).rows.map((r) => Number(r.motor));
    return { enProceso, motoresSinCombustible: sinComb };
  });

  const nomina = await seguro("nomina", { aplica: false, monto: 0, personas: 0, bajadasSinNombre: 0, nombresPorRevisar: 0 }, async () => {
    if (!ctx.esMatriz) return { aplica: false, monto: 0, personas: 0, bajadasSinNombre: 0, nombresPorRevisar: 0 };
    const r = (await db.query(
      `WITH p AS (
         SELECT worker_name AS n, net_amount::float AS m FROM worker_payments WHERE status = 'PENDING'
         UNION ALL
         SELECT worker_name, subtotal::float FROM cuadrilla_entries WHERE paid_at IS NULL
       )
       SELECT COALESCE(SUM(m), 0)::float AS monto, COUNT(DISTINCT n)::int AS personas FROM p WHERE m > 0`
    )).rows[0];
    const sin = await contarBajadasSinNombre(db);
    const porRevisar = await contarNombresPorRevisar(db);
    return { aplica: true, monto: Number(r.monto), personas: Number(r.personas), bajadasSinNombre: sin, nombresPorRevisar: porRevisar };
  });

  const vencidas = (tabla: "accounts_receivable" | "accounts_payable") => seguro(tabla, { n: 0, monto: 0 }, async () => {
    const r = (await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(balance), 0)::float AS monto FROM ${tabla}
        WHERE accionista_id = $1 AND balance > 0.005 AND status IN ('CONFIRMED', 'PARTIAL')
          AND due_date IS NOT NULL AND due_date < (now() AT TIME ZONE 'America/Guayaquil')::date`,
      [acc]
    )).rows[0];
    return { n: Number(r.n), monto: Number(r.monto) };
  });
  const [cxc, cxp] = await Promise.all([vencidas("accounts_receivable"), vencidas("accounts_payable")]);

  const pedidos = await seguro("pedidos", { pendientes: 0, paraHoy: 0 }, async () => {
    const r = (await db.query(
      `SELECT COUNT(*)::int AS pendientes,
              COUNT(*) FILTER (WHERE delivery_date IS NOT NULL AND delivery_date <= (now() AT TIME ZONE 'America/Guayaquil')::date)::int AS para_hoy
         FROM sales_orders WHERE accionista_id = $1 AND status = 'PENDING'`,
      [acc]
    )).rows[0];
    return { pendientes: Number(r.pendientes), paraHoy: Number(r.para_hoy) };
  });

  const prestamos = await seguro("prestamos", { vencidas: [], proximas: [] } as NonNullable<DatosHoy["prestamos"]>, async () => {
    const filas = (await db.query(
      `SELECT p.banco, to_char(q.fecha_vencimiento, 'YYYY-MM-DD') AS fecha, (q.capital + q.interes + q.otros)::float AS monto,
              (q.fecha_vencimiento - (now() AT TIME ZONE 'America/Guayaquil')::date)::int AS dias
         FROM prestamo_cuotas q JOIN prestamos_bancarios p ON p.id = q.prestamo_id
        WHERE p.accionista_id = $1 AND p.estado = 'VIGENTE' AND q.estado = 'PENDIENTE'
          AND q.fecha_vencimiento <= (now() AT TIME ZONE 'America/Guayaquil')::date + 5
        ORDER BY q.fecha_vencimiento`,
      [acc]
    )).rows as Array<{ banco: string; fecha: string; monto: number; dias: number }>;
    return {
      vencidas: filas.filter((f) => f.dias < 0).map(({ banco, fecha, monto }) => ({ banco, fecha, monto: Number(monto) })),
      proximas: filas.filter((f) => f.dias >= 0).map((f) => ({ ...f, monto: Number(f.monto), dias: Number(f.dias) }))
    };
  });

  // Documentos de la flota: solo cuando el accionista activo es la Matriz (ahí vive Transporte).
  const documentosFlota = await seguro("documentos-flota", { vencidos: [], proximos: [] } as NonNullable<DatosHoy["documentosFlota"]>, async () => {
    return ctx.esMatriz ? await documentosPorVencer(db) : { vencidos: [], proximos: [] };
  });

  const puesta = ctx.esAdmin
    ? await seguro("puesta", { aplica: true, faltantes: [] as string[] }, async () => ({ aplica: true, faltantes: await ctx.faltantesPuesta() }))
    : { aplica: false, faltantes: [] as string[] };

  const integridad = ctx.esAdmin
    ? await seguro<{ problemas: number; nombres: string[] } | undefined>("integridad", undefined, async () => {
      const r = await resumenIntegridad();
      return { problemas: r.problemas, nombres: r.nombres };
    })
    : undefined;

  return { dow, caja, tuneles, nomina, cxc, cxp, pedidos, prestamos, documentosFlota, puesta, ...(integridad ? { integridad } : {}) };
}

export async function tareasDeHoy(ctx: Parameters<typeof reunirDatos>[1]): Promise<TareaHoy[]> {
  return construirTareas(await reunirDatos(pool, ctx));
}
