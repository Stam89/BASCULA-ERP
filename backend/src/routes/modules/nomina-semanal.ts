import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { avisarSobregiro } from "../../services/caja.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import { getMatrizId } from "../../services/matriz.js";
import { ensureLaborTables, pagarTrabajadorPlanta } from "./labor.js";
import { contarBajadasSinNombre, contarNombresPorRevisar, pagarBajadasPendientes, pagarTrabajadorCuadrilla } from "./cuadrilla.js";
import { lunesDeSemana, pagarSueldo } from "./admin-payroll.js";

// 🗓️ Cierre semanal de Nómina en UN clic: paga a toda la planta/secador, la cuadrilla y
// la bajada de carro hasta una fecha de corte (por defecto, el último viernes).
//
// No tiene reglas propias de dinero: llama a las MISMAS funciones que el «Pagar» de
// cada persona (pagarTrabajadorPlanta / pagarTrabajadorCuadrilla / pagarBajadasPendientes),
// primero en modo «solo calcular» (vista previa) y luego pagando, todo en UNA
// transacción: o se paga todo o no se paga nada. Así lo que se revisó es lo que se paga.
export const nominaSemanalRouter = Router();

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SIN_LIMITE = "2999-12-31";
const DESDE_SIEMPRE = "2000-01-01";
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type PersonaSemana = {
  grupo: "planta" | "cuadrilla" | "bajada" | "sueldo";
  rol: string;
  nombre: string;
  ganado: number;
  anticipos: number;
  neto: number;
  registros: number;
  /** Para elegir a quién NO pagar hoy (casillas): `grupo|rol|nombre`; la bajada va toda junta (`bajada`). */
  clave: string;
  /** Sueldo semanal: empleado, pago por día y días que se pagan. */
  staff_id?: string;
  pago_dia?: number;
  dias?: number;
};

/** Clave de una persona en la lista del viernes. La bajada de carro se paga toda junta. */
export const claveSemana = (grupo: PersonaSemana["grupo"], rol: string, nombre: string) =>
  grupo === "bajada" ? "bajada" : `${grupo}|${rol}|${nombre}`;
export type ResumenSemana = {
  personas: PersonaSemana[];
  totales: { ganado: number; anticipos: number; neto: number; personas: number };
  bajada: Awaited<ReturnType<typeof pagarBajadasPendientes>>;
};

/** Último viernes (hoy si es viernes), en hora de Ecuador. */
export function ultimoViernes(hoyIso: string): string {
  const d = new Date(`${hoyIso}T12:00:00Z`);
  const atras = (d.getUTCDay() - 5 + 7) % 7; // dom=0 … vie=5 … sáb=6
  d.setUTCDate(d.getUTCDate() - atras);
  return d.toISOString().slice(0, 10);
}

/** Calcula (ejecutar=false) o paga (ejecutar=true) TODO lo pendiente hasta `hasta`. */
export async function procesarSemana(
  client: PoolClient,
  p: {
    hasta: string; cashRegisterId: string; userId: string | null;
    /** Claves que NO se pagan hoy (siguen pendientes). */
    excluir?: string[];
    /** Sueldo semanal: días a pagar por empleado (si no, los de su ficha). */
    dias?: Record<string, number>;
    /** Matriz: dueña de los sueldos semanales. */
    matrizId?: string | null;
  },
  ejecutar: boolean
): Promise<ResumenSemana> {
  const personas: PersonaSemana[] = [];
  const fuera = new Set(p.excluir ?? []);
  // Al pagar, los que se dejaron fuera no se tocan: quedan pendientes para después.
  const pagarA = (clave: string) => ejecutar && !fuera.has(clave);

  const planta = (await client.query(
    `SELECT DISTINCT worker_role, worker_name FROM worker_payments
      WHERE status = 'PENDING' AND work_date <= $1::date ORDER BY worker_role, worker_name`,
    [p.hasta]
  )).rows as Array<{ worker_role: string; worker_name: string }>;
  for (const w of planta) {
    const clave = claveSemana("planta", w.worker_role, w.worker_name);
    if (ejecutar && fuera.has(clave)) continue;
    const r = await pagarTrabajadorPlanta(
      client,
      { role: w.worker_role, name: w.worker_name, from: DESDE_SIEMPRE, to: p.hasta, cashRegisterId: p.cashRegisterId, userId: p.userId },
      pagarA(clave)
    );
    if (r) personas.push({ grupo: "planta", rol: w.worker_role, nombre: w.worker_name, ganado: r.gross, anticipos: r.advances, neto: r.paid, registros: r.count, clave });
  }

  const cuadrilla = (await client.query(
    `SELECT DISTINCT worker_name FROM cuadrilla_entries
      WHERE paid_at IS NULL AND origen <> 'BASCULA' AND work_date <= $1::date ORDER BY worker_name`,
    [p.hasta]
  )).rows as Array<{ worker_name: string }>;
  for (const w of cuadrilla) {
    const clave = claveSemana("cuadrilla", "CUADRILLA", w.worker_name);
    if (ejecutar && fuera.has(clave)) continue;
    const r = await pagarTrabajadorCuadrilla(
      client,
      { name: w.worker_name, from: DESDE_SIEMPRE, to: p.hasta, cashRegisterId: p.cashRegisterId, userId: p.userId },
      pagarA(clave)
    );
    if (r) personas.push({ grupo: "cuadrilla", rol: "CUADRILLA", nombre: w.worker_name, ganado: r.gross, anticipos: r.anticipos, neto: r.paid, registros: r.count, clave });
  }

  const conBajada = !(ejecutar && fuera.has("bajada"));
  const bajada = conBajada ? await pagarBajadasPendientes(client, { cashRegisterId: p.cashRegisterId, hasta: p.hasta, userId: p.userId }, pagarA("bajada")) : null;
  for (const b of bajada?.por_trabajador ?? []) {
    personas.push({ grupo: "bajada", rol: "BAJADA DE CARRO", nombre: b.trabajador, ganado: b.monto, anticipos: 0, neto: b.monto, registros: b.tickets, clave: "bajada" });
  }

  // 🗓️ Sueldos SEMANALES de la Matriz (la cocinera…): pago por día × días, la semana del corte, si aún no cobró.
  if (p.matrizId) {
    const periodo = `Semana ${lunesDeSemana(p.hasta)}`;
    const semanales = (await client.query(
      `SELECT s.id, s.cargo, s.worker_name, s.base_salary::float AS pago_dia, s.dias_semana
         FROM admin_staff s
        WHERE s.accionista_id = $1 AND s.is_active AND s.periodicidad = 'SEMANAL'
          AND NOT EXISTS (SELECT 1 FROM admin_salary_payments pp WHERE pp.staff_id = s.id AND pp.periodo = $2 AND pp.anulado_at IS NULL)
        ORDER BY s.worker_name`,
      [p.matrizId, periodo]
    )).rows as Array<{ id: string; cargo: string | null; worker_name: string; pago_dia: number; dias_semana: number }>;
    for (const s of semanales) {
      const clave = claveSemana("sueldo", s.cargo || "SUELDO", s.worker_name);
      const dias = Math.min(7, Math.max(0, Number(p.dias?.[s.id] ?? s.dias_semana)));
      if (!(dias > 0)) continue;
      if (ejecutar && fuera.has(clave)) continue;
      const neto = r2(s.pago_dia * dias);
      if (pagarA(clave)) {
        await pagarSueldo(client, {
          staff_id: s.id, incentivo: 0, descuentos: 0, periodo, cash_register_id: p.cashRegisterId, dias,
          accionista: p.matrizId, userId: p.userId
        });
      }
      personas.push({ grupo: "sueldo", rol: s.cargo || "SUELDO", nombre: s.worker_name, ganado: neto, anticipos: 0, neto, registros: dias, clave, staff_id: s.id, pago_dia: s.pago_dia, dias });
    }
  }

  const suma = (k: "ganado" | "anticipos" | "neto") => r2(personas.reduce((a, x) => a + x[k], 0));
  return {
    personas,
    totales: { ganado: suma("ganado"), anticipos: suma("anticipos"), neto: suma("neto"), personas: new Set(personas.map((x) => x.nombre)).size },
    bajada
  };
}

async function hoyEcuador(db: Pick<PoolClient, "query"> = pool): Promise<string> {
  return (await db.query("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text AS d")).rows[0].d as string;
}

async function exigirMatriz(req: AuthenticatedRequest): Promise<string> {
  const acc = req.accionistaId;
  if (!acc || acc !== (await getMatrizId())) throw new ApiError(403, "La nómina semanal es de la Matriz: cambia al accionista principal.");
  return acc;
}

// Vista previa: nada se paga ni se marca. Lo que muestra es exactamente lo que pagaría.
nominaSemanalRouter.get("/vista", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const q = z.object({ hasta: FECHA.optional() }).parse(req.query);
  await exigirMatriz(req as AuthenticatedRequest);
  const sugerido = ultimoViernes(await hoyEcuador());
  const hasta = q.hasta ?? sugerido;
  const matrizId = await getMatrizId();
  const out = await inTransaction(async (client) => {
    const corte = await procesarSemana(client, { hasta, cashRegisterId: "", userId: null, matrizId }, false);
    const todo = await procesarSemana(client, { hasta: SIN_LIMITE, cashRegisterId: "", userId: null }, false);
    const sinNombre = await contarBajadasSinNombre(client, hasta);
    const porRevisar = await contarNombresPorRevisar(client, hasta);
    return { corte, todo, sinNombre, porRevisar };
  });
  res.json({
    hasta,
    hasta_sugerido: sugerido,
    personas: out.corte.personas,
    totales: out.corte.totales,
    // Lo trabajado DESPUÉS del corte no entra: queda pendiente para la próxima semana.
    posterior: { ganado: r2(Math.max(0, out.todo.totales.ganado - out.corte.totales.ganado)) },
    bajada_sin_nombre: out.sinNombre,
    bajada_nombres_por_revisar: out.porRevisar
  });
}));

// Pago: una sola transacción. `confirmar_neto` es el total que la persona vio en la
// vista previa; si al pagar el cálculo es otro (llegó un ticket nuevo, alguien pagó a
// alguien…), se CANCELA todo y se pide revisar de nuevo.
nominaSemanalRouter.post("/pagar", asyncRoute(async (req, res) => {
  await ensureLaborTables();
  const body = z.object({
    hasta: FECHA,
    cash_register_id: z.string().uuid(),
    confirmar_neto: z.number().min(0),
    // Casillas: a quién NO se le paga hoy (queda pendiente) y días de cada sueldo semanal.
    excluir: z.array(z.string().max(300)).max(200).optional().default([]),
    dias: z.record(z.string().uuid(), z.number().min(0).max(7)).optional().default({})
  }).parse(req.body);
  const r = req as AuthenticatedRequest;
  const accionistaId = await exigirMatriz(r);
  const userId = r.user?.id ?? null;

  const out = await inTransaction(async (client) => {
    // Un solo cierre a la vez (doble clic, dos personas).
    await client.query("SELECT pg_advisory_xact_lock($1)", [71003]);
    const caja = (await client.query("SELECT status, accionista_id FROM cash_registers WHERE id = $1", [body.cash_register_id])).rows[0];
    if (!caja || caja.status !== "OPEN") throw new ApiError(409, "La caja no está abierta.");
    if (caja.accionista_id && caja.accionista_id !== accionistaId) throw new ApiError(409, "Esa caja es de otro accionista.");
    await avisarSobregiro(client, body.cash_register_id, body.confirmar_neto, req);

    const resumen = await procesarSemana(client, {
      hasta: body.hasta, cashRegisterId: body.cash_register_id, userId, excluir: body.excluir, dias: body.dias, matrizId: accionistaId
    }, true);
    if (resumen.personas.length === 0) throw new ApiError(400, "No hay nada que pagar: marca al menos a una persona.");
    if (Math.abs(resumen.totales.neto - body.confirmar_neto) > 0.009) {
      throw new ApiError(409, `Los montos cambiaron desde que los revisaste (revisado $${body.confirmar_neto.toFixed(2)}, ahora $${resumen.totales.neto.toFixed(2)}). No se pagó nada: vuelve a revisar.`);
    }
    return resumen;
  });

  res.json({ ok: true, hasta: body.hasta, paid_at: new Date().toISOString(), ...out });
}));
