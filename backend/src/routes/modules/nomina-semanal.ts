import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import { getMatrizId } from "../../services/matriz.js";
import { ensureLaborTables, pagarTrabajadorPlanta } from "./labor.js";
import { contarBajadasSinNombre, contarNombresPorRevisar, pagarBajadasPendientes, pagarTrabajadorCuadrilla } from "./cuadrilla.js";

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
  grupo: "planta" | "cuadrilla" | "bajada";
  rol: string;
  nombre: string;
  ganado: number;
  anticipos: number;
  neto: number;
  registros: number;
};
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
  p: { hasta: string; cashRegisterId: string; userId: string | null },
  ejecutar: boolean
): Promise<ResumenSemana> {
  const personas: PersonaSemana[] = [];

  const planta = (await client.query(
    `SELECT DISTINCT worker_role, worker_name FROM worker_payments
      WHERE status = 'PENDING' AND work_date <= $1::date ORDER BY worker_role, worker_name`,
    [p.hasta]
  )).rows as Array<{ worker_role: string; worker_name: string }>;
  for (const w of planta) {
    const r = await pagarTrabajadorPlanta(
      client,
      { role: w.worker_role, name: w.worker_name, from: DESDE_SIEMPRE, to: p.hasta, cashRegisterId: p.cashRegisterId, userId: p.userId },
      ejecutar
    );
    if (r) personas.push({ grupo: "planta", rol: w.worker_role, nombre: w.worker_name, ganado: r.gross, anticipos: r.advances, neto: r.paid, registros: r.count });
  }

  const cuadrilla = (await client.query(
    `SELECT DISTINCT worker_name FROM cuadrilla_entries
      WHERE paid_at IS NULL AND origen <> 'BASCULA' AND work_date <= $1::date ORDER BY worker_name`,
    [p.hasta]
  )).rows as Array<{ worker_name: string }>;
  for (const w of cuadrilla) {
    const r = await pagarTrabajadorCuadrilla(
      client,
      { name: w.worker_name, from: DESDE_SIEMPRE, to: p.hasta, cashRegisterId: p.cashRegisterId, userId: p.userId },
      ejecutar
    );
    if (r) personas.push({ grupo: "cuadrilla", rol: "CUADRILLA", nombre: w.worker_name, ganado: r.gross, anticipos: r.anticipos, neto: r.paid, registros: r.count });
  }

  const bajada = await pagarBajadasPendientes(client, { cashRegisterId: p.cashRegisterId, hasta: p.hasta, userId: p.userId }, ejecutar);
  for (const b of bajada?.por_trabajador ?? []) {
    personas.push({ grupo: "bajada", rol: "BAJADA DE CARRO", nombre: b.trabajador, ganado: b.monto, anticipos: 0, neto: b.monto, registros: b.tickets });
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
  const out = await inTransaction(async (client) => {
    const corte = await procesarSemana(client, { hasta, cashRegisterId: "", userId: null }, false);
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
    confirmar_neto: z.number().min(0)
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

    const resumen = await procesarSemana(client, { hasta: body.hasta, cashRegisterId: body.cash_register_id, userId }, true);
    if (resumen.personas.length === 0) throw new ApiError(400, "No hay nada pendiente de pago hasta esa fecha.");
    if (Math.abs(resumen.totales.neto - body.confirmar_neto) > 0.009) {
      throw new ApiError(409, `Los montos cambiaron desde que los revisaste (revisado $${body.confirmar_neto.toFixed(2)}, ahora $${resumen.totales.neto.toFixed(2)}). No se pagó nada: vuelve a revisar.`);
    }
    return resumen;
  });

  res.json({ ok: true, hasta: body.hasta, paid_at: new Date().toISOString(), ...out });
}));
