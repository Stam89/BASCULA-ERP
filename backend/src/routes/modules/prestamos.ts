import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { requirePermiso, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { avisarSobregiro, medioParaCaja } from "../../services/caja.js";
import { generarTablaCuotas } from "../../services/prestamos.js";

// 🏦 PRÉSTAMOS BANCARIOS del accionista activo (Por Pagar › Préstamos del banco).
//  · Cada préstamo tiene su banco, su día de cobro y su TABLA DE CUOTAS (fecha, capital, interés, otros cargos).
//  · Pagar una cuota = UN egreso en la caja abierta (PAGO_PRESTAMO, por defecto del banco). El capital baja la deuda
//    (Balance › pasivo); el interés y los otros cargos son gasto financiero (Estado de resultados, Resultado mensual).
//  · Un préstamo nuevo puede registrar la entrada del dinero a la caja (PRESTAMO_RECIBIDO); uno que ya venía de
//    antes se registra con lo que falta pagar y sin mover la caja.
//  · Anular el pago en Caja deja la cuota otra vez pendiente.
export const prestamosRouter = Router();

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");

function accId(req: unknown): string {
  const id = (req as AuthenticatedRequest).accionistaId;
  if (!id) throw new ApiError(400, "Selecciona un accionista activo");
  return id;
}

const datosTabla = z.object({
  capital: z.coerce.number().positive(),
  cuotas: z.coerce.number().int().min(1).max(600),
  primera_fecha: fecha,
  frecuencia_meses: z.coerce.number().int().refine((v) => [1, 2, 3, 6, 12].includes(v), "Frecuencia inválida").optional().default(1),
  tasa_anual: z.coerce.number().min(0).max(200).nullable().optional(),
  cuota: z.coerce.number().min(0).nullable().optional(),
  otros_por_cuota: z.coerce.number().min(0).optional().default(0)
});

function tabla(b: z.infer<typeof datosTabla>) {
  try {
    return generarTablaCuotas({
      capital: b.capital, cuotas: b.cuotas, primeraFecha: b.primera_fecha, frecuenciaMeses: b.frecuencia_meses,
      tasaAnual: b.tasa_anual ?? null, cuota: b.cuota ?? null, otrosPorCuota: b.otros_por_cuota
    });
  } catch (e) {
    throw new ApiError(400, (e as Error).message);
  }
}

// Resumen de cada préstamo: lo que falta de capital, la próxima cuota y cuántas están vencidas.
const RESUMEN = `
  SELECT p.id, p.banco, p.numero, p.descripcion, p.monto::float AS monto, p.tasa_anual::float AS tasa_anual,
         p.frecuencia_meses, p.dia_pago, p.estado, p.notas, p.created_at, p.desembolso_movement_id,
         COALESCE(s.saldo_capital, 0)::float AS saldo_capital,
         COALESCE(s.pendientes, 0)::int AS cuotas_pendientes, COALESCE(s.total_cuotas, 0)::int AS total_cuotas,
         COALESCE(s.vencidas, 0)::int AS cuotas_vencidas, COALESCE(s.monto_vencido, 0)::float AS monto_vencido,
         prox.id AS proxima_id, prox.numero AS proxima_numero, prox.fecha_vencimiento AS proxima_fecha,
         prox.total::float AS proxima_total,
         (prox.fecha_vencimiento - (now() AT TIME ZONE 'America/Guayaquil')::date)::int AS proxima_dias
    FROM prestamos_bancarios p
    LEFT JOIN LATERAL (
      SELECT sum(q.capital) FILTER (WHERE q.estado = 'PENDIENTE') AS saldo_capital,
             count(*) FILTER (WHERE q.estado = 'PENDIENTE') AS pendientes, count(*) AS total_cuotas,
             count(*) FILTER (WHERE q.estado = 'PENDIENTE' AND q.fecha_vencimiento < (now() AT TIME ZONE 'America/Guayaquil')::date) AS vencidas,
             sum(q.capital + q.interes + q.otros) FILTER (WHERE q.estado = 'PENDIENTE' AND q.fecha_vencimiento < (now() AT TIME ZONE 'America/Guayaquil')::date) AS monto_vencido
        FROM prestamo_cuotas q WHERE q.prestamo_id = p.id
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT q.id, q.numero, q.fecha_vencimiento, (q.capital + q.interes + q.otros) AS total
        FROM prestamo_cuotas q WHERE q.prestamo_id = p.id AND q.estado = 'PENDIENTE'
       ORDER BY q.fecha_vencimiento, q.numero LIMIT 1
    ) prox ON true`;

prestamosRouter.get("/", asyncRoute(async (req, res) => {
  const todos = req.query.todos === "1";
  const r = await pool.query(
    `${RESUMEN} WHERE p.accionista_id = $1 ${todos ? "" : "AND p.estado <> 'ANULADO'"}
      ORDER BY (p.estado = 'VIGENTE') DESC, prox.fecha_vencimiento NULLS LAST, p.created_at`,
    [accId(req)]
  );
  res.json(r.rows);
}));

async function prestamoDelAccionista(db: PoolClient | typeof pool, id: string, acc: string, bloquear = false) {
  const p = (await db.query(
    `SELECT * FROM prestamos_bancarios WHERE id = $1 AND accionista_id = $2 ${bloquear ? "FOR UPDATE" : ""}`, [id, acc]
  )).rows[0];
  if (!p) throw new ApiError(404, "Préstamo no encontrado para el accionista activo.");
  return p;
}

prestamosRouter.get("/:id", asyncRoute(async (req, res) => {
  const acc = accId(req);
  const p = (await pool.query(`${RESUMEN} WHERE p.id = $1 AND p.accionista_id = $2`, [req.params.id, acc])).rows[0];
  if (!p) throw new ApiError(404, "Préstamo no encontrado para el accionista activo.");
  const cuotas = (await pool.query(
    `SELECT q.id, q.numero, q.fecha_vencimiento, q.capital::float AS capital, q.interes::float AS interes, q.otros::float AS otros,
            (q.capital + q.interes + q.otros)::float AS total, q.estado, q.pagada_at,
            q.pagado_interes::float AS pagado_interes, q.pagado_otros::float AS pagado_otros, m.amount::float AS pagado_total, m.medio
       FROM prestamo_cuotas q LEFT JOIN cash_movements m ON m.id = q.cash_movement_id
      WHERE q.prestamo_id = $1 ORDER BY q.numero`,
    [req.params.id]
  )).rows;
  res.json({ ...p, cuotas });
}));

// Vista previa de la tabla de cuotas (no guarda nada).
prestamosRouter.post("/tabla", asyncRoute(async (req, res) => {
  res.json(tabla(datosTabla.parse(req.body)));
}));

// Registrar un préstamo con su tabla (la generada o la que se corrigió a mano con la del banco).
prestamosRouter.post("/", asyncRoute(async (req, res) => {
  const body = datosTabla.extend({
    banco: z.string().trim().min(2).max(80),
    numero: z.string().trim().max(40).optional(),
    descripcion: z.string().trim().max(200).optional(),
    notas: z.string().trim().max(500).optional(),
    filas: z.array(z.object({
      fecha: fecha,
      capital: z.coerce.number().min(0),
      interes: z.coerce.number().min(0),
      otros: z.coerce.number().min(0).optional().default(0)
    })).min(1).max(600).optional(),
    // Préstamo NUEVO: el dinero entró hoy a la caja abierta (al banco, si es mixta).
    desembolso: z.object({ cash_register_id: z.string().uuid(), medio_pago: z.enum(["EFECTIVO", "BANCO"]).optional() }).optional()
  }).parse(req.body);
  const acc = accId(req);
  const user = (req as AuthenticatedRequest).user;

  const generada = tabla(body);
  const filas = body.filas
    ? body.filas.map((f, k) => ({ numero: k + 1, fecha: f.fecha, capital: r2(f.capital), interes: r2(f.interes), otros: r2(f.otros) }))
    : generada.filas;
  const sumaCapital = r2(filas.reduce((s, f) => s + f.capital, 0));
  if (Math.abs(sumaCapital - r2(body.capital)) > 0.05) {
    throw new ApiError(400, `El capital de las cuotas suma $${sumaCapital.toFixed(2)} y el préstamo es de $${r2(body.capital).toFixed(2)}: corrige la tabla.`);
  }

  const out = await inTransaction(async (client) => {
    const p = (await client.query(
      `INSERT INTO prestamos_bancarios (accionista_id, banco, numero, descripcion, monto, tasa_anual, frecuencia_meses, dia_pago, notas, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [acc, body.banco.toUpperCase(), body.numero || null, body.descripcion || null, r2(body.capital), generada.tasa_anual,
       body.frecuencia_meses, Number(body.primera_fecha.slice(8, 10)), body.notas || null, user?.id ?? null]
    )).rows[0];
    for (const f of filas) {
      await client.query(
        `INSERT INTO prestamo_cuotas (prestamo_id, numero, fecha_vencimiento, capital, interes, otros) VALUES ($1, $2, $3, $4, $5, $6)`,
        [p.id, f.numero, f.fecha, f.capital, f.interes, f.otros]
      );
    }
    if (body.desembolso) {
      const caja = (await client.query(
        "SELECT id, status, tipo FROM cash_registers WHERE id = $1 AND accionista_id = $2 FOR UPDATE", [body.desembolso.cash_register_id, acc]
      )).rows[0];
      if (!caja) throw new ApiError(404, "Caja no disponible para el accionista activo.");
      if (caja.status !== "OPEN") throw new ApiError(409, "La caja no está abierta.");
      const mov = (await client.query(
        `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by, medio)
         VALUES ($1, 'INCOME', 'PRESTAMO_RECIBIDO', 'prestamo_bancario', $2, $3, $4, $5, $6) RETURNING id`,
        [caja.id, p.id, r2(body.capital), `Préstamo recibido · ${body.banco.toUpperCase()}${body.numero ? ` N.º ${body.numero}` : ""}`,
         user?.id ?? null, medioParaCaja(caja.tipo, body.desembolso.medio_pago ?? "BANCO")]
      )).rows[0];
      await client.query("UPDATE prestamos_bancarios SET desembolso_movement_id = $2 WHERE id = $1", [p.id, mov.id]);
    }
    return p.id as string;
  });
  const creado = (await pool.query(`${RESUMEN} WHERE p.id = $1`, [out])).rows[0];
  res.status(201).json(creado);
}));

// Corregir una cuota PENDIENTE (fecha, capital, interés u otros) con lo que dice el banco.
prestamosRouter.put("/:id/cuotas/:cuotaId", asyncRoute(async (req, res) => {
  const body = z.object({
    fecha_vencimiento: fecha.optional(),
    capital: z.coerce.number().min(0).optional(),
    interes: z.coerce.number().min(0).optional(),
    otros: z.coerce.number().min(0).optional()
  }).parse(req.body);
  const acc = accId(req);
  const r = await inTransaction(async (client) => {
    const p = await prestamoDelAccionista(client, String(req.params.id), acc, true);
    if (p.estado !== "VIGENTE") throw new ApiError(409, "Ese préstamo ya no está vigente.");
    const q = (await client.query("SELECT * FROM prestamo_cuotas WHERE id = $1 AND prestamo_id = $2 FOR UPDATE", [req.params.cuotaId, p.id])).rows[0];
    if (!q) throw new ApiError(404, "Cuota no encontrada.");
    if (q.estado !== "PENDIENTE") throw new ApiError(409, "Esa cuota ya está pagada: para corregirla, anula su pago en Caja.");
    return (await client.query(
      `UPDATE prestamo_cuotas SET fecha_vencimiento = COALESCE($2, fecha_vencimiento), capital = COALESCE($3, capital),
              interes = COALESCE($4, interes), otros = COALESCE($5, otros)
        WHERE id = $1
        RETURNING id, numero, fecha_vencimiento, capital::float AS capital, interes::float AS interes, otros::float AS otros,
                  (capital + interes + otros)::float AS total, estado`,
      [q.id, body.fecha_vencimiento ?? null, body.capital != null ? r2(body.capital) : null,
       body.interes != null ? r2(body.interes) : null, body.otros != null ? r2(body.otros) : null]
    )).rows[0];
  });
  res.json(r);
}));

// Pagar una cuota: UN egreso en la caja abierta. El interés y los otros cargos se pueden ajustar a lo que de verdad
// cobró el banco; el capital es el de la cuota (si el banco cambió el capital, corrige primero la cuota).
prestamosRouter.post("/:id/cuotas/:cuotaId/pagar", asyncRoute(async (req, res) => {
  const body = z.object({
    cash_register_id: z.string().uuid(),
    interes: z.coerce.number().min(0).optional(),
    otros: z.coerce.number().min(0).optional(),
    medio_pago: z.enum(["EFECTIVO", "BANCO"]).optional()
  }).parse(req.body);
  const acc = accId(req);
  const user = (req as AuthenticatedRequest).user;
  const r = await inTransaction(async (client) => {
    const p = await prestamoDelAccionista(client, String(req.params.id), acc, true);
    if (p.estado !== "VIGENTE") throw new ApiError(409, "Ese préstamo ya no está vigente.");
    const q = (await client.query("SELECT * FROM prestamo_cuotas WHERE id = $1 AND prestamo_id = $2 FOR UPDATE", [req.params.cuotaId, p.id])).rows[0];
    if (!q) throw new ApiError(404, "Cuota no encontrada.");
    if (q.estado !== "PENDIENTE") throw new ApiError(409, `La cuota ${q.numero} ya está pagada.`);
    const caja = (await client.query(
      "SELECT id, status, tipo FROM cash_registers WHERE id = $1 AND accionista_id = $2 FOR UPDATE", [body.cash_register_id, acc]
    )).rows[0];
    if (!caja) throw new ApiError(404, "Caja no disponible para el accionista activo.");
    if (caja.status !== "OPEN") throw new ApiError(409, "La caja no está abierta.");

    const capital = r2(Number(q.capital));
    const interes = r2(body.interes ?? Number(q.interes));
    const otros = r2(body.otros ?? Number(q.otros));
    const total = r2(capital + interes + otros);
    if (!(total > 0)) throw new ApiError(400, "La cuota no tiene valor a pagar.");
    await avisarSobregiro(client, caja.id, total, req);
    const totalCuotas = Number((await client.query("SELECT count(*)::int AS n FROM prestamo_cuotas WHERE prestamo_id = $1", [p.id])).rows[0].n);
    const mov = (await client.query(
      `INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description, created_by, medio)
       VALUES ($1, 'EXPENSE', 'PAGO_PRESTAMO', 'prestamo_cuota', $2, $3, $4, $5, $6) RETURNING id`,
      [caja.id, q.id, total,
       `Cuota ${q.numero}/${totalCuotas} préstamo ${p.banco}${p.numero ? ` N.º ${p.numero}` : ""} · capital $${capital.toFixed(2)} + interés $${interes.toFixed(2)}${otros > 0 ? ` + otros $${otros.toFixed(2)}` : ""}`,
       user?.id ?? null, medioParaCaja(caja.tipo, body.medio_pago ?? "BANCO")]
    )).rows[0];
    await client.query(
      `UPDATE prestamo_cuotas SET estado = 'PAGADA', pagado_interes = $2, pagado_otros = $3, pagada_at = now(), cash_movement_id = $4 WHERE id = $1`,
      [q.id, interes, otros, mov.id]
    );
    const quedan = Number((await client.query("SELECT count(*)::int AS n FROM prestamo_cuotas WHERE prestamo_id = $1 AND estado = 'PENDIENTE'", [p.id])).rows[0].n);
    if (quedan === 0) await client.query("UPDATE prestamos_bancarios SET estado = 'PAGADO' WHERE id = $1", [p.id]);
    return { pagado: total, capital, interes, otros, cuotas_pendientes: quedan, prestamo_pagado: quedan === 0, movimiento_id: mov.id };
  });
  res.json(r);
}));

// Anular un préstamo registrado por error (solo si no tiene cuotas pagadas). Si registró la entrada del dinero,
// esa entrada se anula también (contra-asiento en la caja abierta).
prestamosRouter.post("/:id/anular", requirePermiso("ANULAR"), asyncRoute(async (req, res) => {
  const body = z.object({ motivo: z.string().trim().min(3) }).parse(req.body);
  const acc = accId(req);
  const user = (req as AuthenticatedRequest).user;
  await inTransaction(async (client) => {
    const p = await prestamoDelAccionista(client, String(req.params.id), acc, true);
    if (p.estado === "ANULADO") throw new ApiError(409, "Ese préstamo ya está anulado.");
    const pagadas = Number((await client.query("SELECT count(*)::int AS n FROM prestamo_cuotas WHERE prestamo_id = $1 AND estado = 'PAGADA'", [p.id])).rows[0].n);
    if (pagadas > 0) throw new ApiError(409, `Tiene ${pagadas} cuota(s) pagada(s): anula primero esos pagos en Caja.`);
    if (p.desembolso_movement_id) {
      const m = (await client.query("SELECT * FROM cash_movements WHERE id = $1 FOR UPDATE", [p.desembolso_movement_id])).rows[0];
      if (m && !m.reversed_at) {
        const abierta = (await client.query(
          `SELECT CASE WHEN cr.status = 'OPEN' THEN cr.id
                       ELSE (SELECT o.id FROM cash_registers o WHERE o.accionista_id = cr.accionista_id AND o.status = 'OPEN' ORDER BY o.opened_at DESC LIMIT 1) END AS id
             FROM cash_registers cr WHERE cr.id = $1`, [m.cash_register_id]
        )).rows[0]?.id;
        if (!abierta) throw new ApiError(409, "Abre la caja de hoy para anular la entrada del dinero del préstamo.");
        await client.query(
          `INSERT INTO cash_movements (cash_register_id, movement, category, amount, description, reference_type, reference_id, reversal_of, created_by, medio)
           VALUES ($1, 'EXPENSE', $2, $3, $4, 'reversal', $5, $5, $6, $7)`,
          [abierta, m.category, m.amount, `Anulación: ${body.motivo} (préstamo ${p.banco})`, m.id, user?.id ?? null, m.medio]
        );
        await client.query("UPDATE cash_movements SET reversed_at = now(), reversed_by = $2, reversed_reason = $3 WHERE id = $1", [m.id, user?.id ?? null, body.motivo]);
      }
    }
    await client.query("UPDATE prestamos_bancarios SET estado = 'ANULADO', anulado_at = now(), anulado_motivo = $2 WHERE id = $1", [p.id, body.motivo]);
  });
  res.json({ ok: true });
}));

/**
 * Anular en Caja el pago de una cuota: la cuota vuelve a quedar pendiente (y el préstamo vigente).
 * El desembolso de un préstamo no se anula en Caja: se anula el préstamo (aquí arriba). Se llama DENTRO de la
 * transacción de la anulación, ANTES de marcar el movimiento (para poder rechazarla).
 */
export async function revertirMovimientoDePrestamo(client: PoolClient, m: { id: string; reference_type: string | null; reference_id: string | null }): Promise<boolean> {
  if (m.reference_type === "prestamo_bancario") {
    throw new ApiError(409, "Esa es la entrada del dinero de un préstamo: anúlalo desde Por Pagar › Préstamos del banco (si no tiene cuotas pagadas).");
  }
  if (m.reference_type !== "prestamo_cuota" || !m.reference_id) return false;
  const q = (await client.query("SELECT id, prestamo_id FROM prestamo_cuotas WHERE id = $1 AND cash_movement_id = $2 FOR UPDATE", [m.reference_id, m.id])).rows[0];
  if (!q) return false;
  await client.query(
    "UPDATE prestamo_cuotas SET estado = 'PENDIENTE', pagado_interes = NULL, pagado_otros = NULL, pagada_at = NULL, cash_movement_id = NULL WHERE id = $1",
    [q.id]
  );
  await client.query("UPDATE prestamos_bancarios SET estado = 'VIGENTE' WHERE id = $1 AND estado = 'PAGADO'", [q.prestamo_id]);
  return true;
}
