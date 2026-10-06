// «Hoy»: lista corta de lo que hay que hacer AHORA, armada con los datos del ERP.
// Cada tarea lleva a la pantalla donde se resuelve. Aquí hay dos partes:
//  · construirTareas(): función PURA (datos ya contados → tareas ordenadas). Con pruebas.
//  · reunirDatos(): consultas de solo lectura a la base (cada bloque falla por separado:
//    si una consulta se cae, el resto de «Hoy» sigue funcionando).
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { contarBajadasSinNombre, contarNombresPorRevisar } from "../routes/modules/cuadrilla.js";

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
};

/** Horas a partir de las cuales un túnel «lleva mucho»: los secados reales duran ~13–16 h. */
export const HORAS_TUNEL_LARGO = 18;

const dinero = (n: number) => `$${n.toFixed(2)}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const horasTxt = (h: number) => (h < 1 ? "menos de 1 h" : `${Math.round(h)} h`);
const ORDEN: Record<NivelTarea, number> = { urgente: 0, atencion: 1, info: 2 };

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
        WHERE d.status = 'COMPLETED' AND d.motor_fuel_id IS NULL AND d.motor_number IN (1, 2)
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

  const puesta = ctx.esAdmin
    ? await seguro("puesta", { aplica: true, faltantes: [] as string[] }, async () => ({ aplica: true, faltantes: await ctx.faltantesPuesta() }))
    : { aplica: false, faltantes: [] as string[] };

  return { dow, caja, tuneles, nomina, cxc, cxp, pedidos, puesta };
}

export async function tareasDeHoy(ctx: Parameters<typeof reunirDatos>[1]): Promise<TareaHoy[]> {
  return construirTareas(await reunirDatos(pool, ctx));
}
