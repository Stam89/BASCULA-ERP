import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { type AuthenticatedRequest } from "../../auth/require-auth.js";

export const cuadrillaRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;

// Labores por saco (cuando la corrida se maneja en Sacos porque se agotaron las
// Tulas). Se busca la primera activa en este orden de preferencia.
const SACOS_LABOR_CANDIDATES = ["ENSACADO", "SACADO EN SACO"];

// Resuelve la LABOR (actividad + tarifa) y la CANTIDAD a pagar a la cuadrilla por
// un evento de túnel, según el TIPO DE EMPAQUE registrado para ese momento:
//   TULAS -> "RECEPCION A TUNEL N" (llenado) / "BOTADA DE TUNEL" (vaciado), pagado
//            por QQ del túnel.
//   SACOS -> "ENSACADO"/"SACADO EN SACO", pagado por Nº de sacos (si no se
//            registró el conteo, cae al QQ del túnel para no dejar el evento sin
//            pago). NO toca pesos ni tickets: solo cambia labor/tarifa/cantidad.
// Devuelve {missing} con el nombre de la labor faltante si no hay tarifa activa.
async function resolveTunnelLabor(
  client: PoolClient,
  opts: {
    tunnel_number: number;
    momento: "LLENADO" | "VACIADO";
    empaque: string | null;
    sacos: number | null;
    quintals: number;
  }
): Promise<
  | { activity_id: string; activity_name: string; unit_rate: number; quantity: number }
  | { missing: string }
> {
  const esSacos = String(opts.empaque ?? "TULAS").toUpperCase() === "SACOS";
  if (esSacos) {
    const act = await client.query(
      `SELECT id, name, unit_rate::float AS unit_rate
       FROM cuadrilla_activities
       WHERE upper(btrim(name)) = ANY($1::text[]) AND is_active = true
       ORDER BY array_position($1::text[], upper(btrim(name)))
       LIMIT 1`,
      [SACOS_LABOR_CANDIDATES]
    );
    if (!act.rowCount) return { missing: SACOS_LABOR_CANDIDATES[0] };
    const sacos = Number(opts.sacos) || 0;
    const quantity = sacos > 0 ? sacos : Number(opts.quintals) || 0;
    return {
      activity_id: act.rows[0].id as string,
      activity_name: act.rows[0].name as string,
      unit_rate: Number(act.rows[0].unit_rate),
      quantity
    };
  }
  const laborName = opts.momento === "VACIADO" ? "BOTADA DE TUNEL" : `RECEPCION A TUNEL ${opts.tunnel_number}`;
  const act = await client.query(
    "SELECT id, name, unit_rate::float AS unit_rate FROM cuadrilla_activities WHERE upper(btrim(name)) = $1 AND is_active = true LIMIT 1",
    [laborName]
  );
  if (!act.rowCount) return { missing: laborName };
  return {
    activity_id: act.rows[0].id as string,
    activity_name: act.rows[0].name as string,
    unit_rate: Number(act.rows[0].unit_rate),
    quantity: Number(opts.quintals) || 0
  };
}

// Autogenera (o actualiza) la entrada de nómina de la cuadrilla a partir de un
// movimiento de secadora (llenado o vaciado de un túnel). Se llama DENTRO de la
// transacción del movimiento. Nunca lanza: si algo falla, no debe tumbar el
// secado — solo se deja constancia en consola. Devuelve la fila creada o null.
export async function upsertCuadrillaSecadoraEntry(
  client: PoolClient,
  opts: {
    referencia_id: string;
    tunnel_number: number;
    momento: "LLENADO" | "VACIADO";
    activity_id?: string | null;
    worker_name?: string | null;
    quantity: number;           // sacos/QQ del túnel
    work_date?: string | null;  // YYYY-MM-DD; por defecto hoy
    created_by?: string | null;
  }
): Promise<{ id: string } | null> {
  try {
    const worker = (opts.worker_name ?? "").trim();
    // Ambos campos son opcionales: sin cuadrilla o sin labor no se autogenera nada.
    if (!opts.activity_id || worker.length < 2) return null;

    const activity = await client.query(
      "SELECT name, unit_rate FROM cuadrilla_activities WHERE id = $1 AND is_active = true",
      [opts.activity_id]
    );
    if (!activity.rowCount) return null; // labor inexistente/inactiva: no romper el secado

    const rate = Number(activity.rows[0].unit_rate);
    const qty = Number(opts.quantity) || 0;
    const subtotal = round2(qty * rate);
    const notes = `Autogenerado desde Secadora · Túnel ${opts.tunnel_number} · ${opts.momento === "LLENADO" ? "Llenado" : "Vaciado"}`;

    const result = await client.query(
      `INSERT INTO cuadrilla_entries
         (work_date, activity_id, activity_name, worker_name, quantity, unit_rate, subtotal, notes,
          origen, referencia_id, tunnel_number, momento, created_by)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, 'SECADORA', $9, $10, $11, $12)
       ON CONFLICT (referencia_id, momento, (lower(btrim(worker_name)))) WHERE origen = 'SECADORA'
       DO UPDATE SET
         work_date = COALESCE(EXCLUDED.work_date, cuadrilla_entries.work_date),
         activity_id = EXCLUDED.activity_id,
         activity_name = EXCLUDED.activity_name,
         worker_name = EXCLUDED.worker_name,
         quantity = EXCLUDED.quantity,
         unit_rate = EXCLUDED.unit_rate,
         subtotal = EXCLUDED.subtotal,
         notes = EXCLUDED.notes,
         tunnel_number = EXCLUDED.tunnel_number
       RETURNING id`,
      [
        opts.work_date ?? null,
        opts.activity_id,
        activity.rows[0].name,
        worker,
        qty,
        rate,
        subtotal,
        notes,
        opts.referencia_id,
        opts.tunnel_number,
        opts.momento,
        opts.created_by ?? null
      ]
    );
    return result.rows[0] ?? null;
  } catch (err) {
    console.error("[cuadrilla] No se pudo autogenerar el pago desde Secadora", {
      referencia_id: opts.referencia_id,
      momento: opts.momento,
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

// ── Actividades (catálogo con valor unitario) ───────────────────────────────

cuadrillaRouter.get("/activities", asyncRoute(async (req, res) => {
  // ?categoria=SECADORA filtra a las labores de túnel (para el form de Secadoras).
  const { categoria } = z.object({ categoria: z.string().optional() }).parse(req.query);
  const params: unknown[] = [];
  let where = "WHERE is_active = true";
  if (categoria) { params.push(categoria.trim().toUpperCase()); where += ` AND categoria = $${params.length}`; }
  const result = await pool.query(
    `SELECT id, name, unit_rate, is_active, categoria FROM cuadrilla_activities ${where} ORDER BY name`,
    params
  );
  res.json(result.rows);
}));

// Nombres de cuadrillas (grupos): el maestro + los ya usados en registros y
// asignaciones. Alimenta el selector de la alerta de Nómina.
cuadrillaRouter.get("/workers", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT worker_name FROM (
       SELECT worker_name FROM cuadrilla_entries
       UNION SELECT worker_name FROM drying_tunnel_cuadrilla
       UNION SELECT name AS worker_name FROM cuadrillas WHERE is_active
     ) w WHERE COALESCE(TRIM(worker_name), '') <> '' ORDER BY worker_name`
  );
  res.json(result.rows.map((r) => r.worker_name));
}));

// Crea (o reactiva) una cuadrilla por su nombre. Sirve para el botón de creación
// rápida: solo el nombre, para tenerla disponible en el selector al instante.
cuadrillaRouter.post("/groups", asyncRoute(async (req, res) => {
  const { name } = z.object({ name: z.string().min(2) }).parse(req.body);
  const clean = name.trim();
  await pool.query(
    "INSERT INTO cuadrillas (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET is_active = true",
    [clean]
  );
  res.status(201).json({ name: clean });
}));

// ── Recepción a Túnel (LLENADO): detectar y generar desde Secadora ──────────
// Rango por defecto: semana en curso (lunes a hoy), igual que el resto de nómina.
function defaultRange(query: unknown): { from: string; to: string } {
  const { from, to } = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(query);
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return { from: from ?? monday.toISOString().slice(0, 10), to: to ?? today.toISOString().slice(0, 10) };
}

// Detecta el CICLO COMPLETO de cuadrilla en Secadoras en un rango: llenado
// (Recepción a Túnel) y vaciado (Botada/Sacado de Túnel), cada uno con el QQ del
// túnel y su tarifa. Reporta también los eventos SIN cuadrilla asignada (para la
// alerta amarilla): túneles llenados sin recepción y túneles vaciados sin botada.
cuadrillaRouter.get("/tunnel-suggestions", asyncRoute(async (req, res) => {
  const { from, to } = defaultRange(req.query);

  // La fecha de la corrida es la fecha de llenado (filled_at) unificada por motor.
  const asignadas = await pool.query(
    `SELECT a.drying_report_id, d.tunnel_number, a.momento,
            COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) AS work_date,
            a.worker_name, a.activity_id, act.name AS activity_name,
            act.unit_rate::float AS unit_rate, a.quintals::float AS quintals,
            EXISTS(
              SELECT 1 FROM cuadrilla_entries e
              WHERE e.origen='SECADORA' AND e.momento = a.momento
                AND e.referencia_id = a.drying_report_id
                AND lower(btrim(e.worker_name)) = lower(btrim(a.worker_name))
            ) AS already_generated
     FROM drying_tunnel_cuadrilla a
     JOIN drying_tunnel_reports d ON d.id = a.drying_report_id
     JOIN cuadrilla_activities act ON act.id = a.activity_id
     WHERE COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) BETWEEN $1 AND $2
     ORDER BY work_date DESC, d.tunnel_number, a.momento, a.worker_name`,
    [from, to]
  );

  // Llenados sin recepción asignada. El pago se computa AUTOMÁTICAMENTE:
  // total_quintals del túnel × tarifa de "RECEPCION A TUNEL N" (sin tabla ni
  // guardado intermedio en Secadoras). Se muestra ya calculado en la alerta.
  const sinLlenado = await pool.query(
    `SELECT d.id AS drying_report_id, d.tunnel_number, 'LLENADO'::text AS momento,
            COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) AS work_date,
            d.total_quintals::float AS quintals,
            act.unit_rate::float AS unit_rate,
            round(d.total_quintals * COALESCE(act.unit_rate,0), 2)::float AS subtotal,
            act.name AS activity_name
     FROM drying_tunnel_reports d
     LEFT JOIN cuadrilla_activities act
       ON upper(btrim(act.name)) = 'RECEPCION A TUNEL ' || d.tunnel_number AND act.is_active
     WHERE COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) BETWEEN $1 AND $2
       AND COALESCE(d.total_quintals,0) > 0
       AND NOT EXISTS (SELECT 1 FROM drying_tunnel_cuadrilla a WHERE a.drying_report_id = d.id AND a.momento='LLENADO')
     ORDER BY work_date DESC, d.tunnel_number`,
    [from, to]
  );

  // Vaciados (túnel ya finalizado = botado) sin botada asignada: total_quintals ×
  // tarifa de "BOTADA DE TUNEL", también computado automáticamente.
  const sinVaciado = await pool.query(
    `SELECT d.id AS drying_report_id, d.tunnel_number, 'VACIADO'::text AS momento,
            COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) AS work_date,
            d.total_quintals::float AS quintals,
            act.unit_rate::float AS unit_rate,
            round(d.total_quintals * COALESCE(act.unit_rate,0), 2)::float AS subtotal,
            act.name AS activity_name
     FROM drying_tunnel_reports d
     LEFT JOIN cuadrilla_activities act
       ON upper(btrim(act.name)) = 'BOTADA DE TUNEL' AND act.is_active
     WHERE COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) BETWEEN $1 AND $2
       AND COALESCE(d.total_quintals,0) > 0
       AND d.dry_end_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM drying_tunnel_cuadrilla a WHERE a.drying_report_id = d.id AND a.momento='VACIADO')
     ORDER BY work_date DESC, d.tunnel_number`,
    [from, to]
  );

  const rows = asignadas.rows.map((r) => ({
    drying_report_id: r.drying_report_id,
    tunnel_number: r.tunnel_number,
    momento: r.momento,
    work_date: r.work_date,
    worker_name: r.worker_name,
    activity_id: r.activity_id,
    activity_name: r.activity_name,
    unit_rate: r.unit_rate,
    quintals: r.quintals,
    subtotal: round2(Number(r.quintals) * Number(r.unit_rate)),
    already_generated: r.already_generated
  }));
  res.json({ range: { from, to }, rows, sin_asignar: [...sinLlenado.rows, ...sinVaciado.rows] });
}));

// Genera los pagos de nómina (cuadrilla_entries) desde las asignaciones de túnel
// del rango que aún no se generaron. Los registros quedan como origen='SECADORA'
// (no editables desde Nómina) para no descuadrar con el inventario del túnel.
cuadrillaRouter.post("/tunnel-generate", asyncRoute(async (req, res) => {
  const body = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).parse(req.body ?? {});
  const { from, to } = defaultRange(body);
  const userId = (req as AuthenticatedRequest).user?.id ?? null;

  const created = await inTransaction(async (client) => {
    const asignaciones = await client.query(
      `SELECT a.drying_report_id, d.tunnel_number, a.momento,
              COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) AS work_date,
              a.worker_name, a.activity_id, a.quintals
       FROM drying_tunnel_cuadrilla a
       JOIN drying_tunnel_reports d ON d.id = a.drying_report_id
       WHERE COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) BETWEEN $1 AND $2`,
      [from, to]
    );
    let count = 0;
    for (const a of asignaciones.rows) {
      const entry = await upsertCuadrillaSecadoraEntry(client, {
        referencia_id: a.drying_report_id,
        tunnel_number: a.tunnel_number,
        momento: a.momento === "VACIADO" ? "VACIADO" : "LLENADO",
        activity_id: a.activity_id,
        worker_name: a.worker_name,
        quantity: Number(a.quintals) || 0,
        work_date: a.work_date ? new Date(a.work_date).toISOString().slice(0, 10) : null,
        created_by: userId
      });
      if (entry) count++;
    }
    return count;
  });
  res.json({ created });
}));

// AUTOMATIZACIÓN 100%: detecta TODOS los eventos nuevos de túnel (Recepción y
// Botada) sin nómina en el rango, les asigna la cuadrilla indicada y genera el
// pago (QQ del túnel × tarifa) EN UN SOLO PASO. Sin cola de pendientes: al
// detectar, cae directo a "Registros del período". Devuelve cuántos se crearon.
cuadrillaRouter.post("/tunnel-autoprocess", asyncRoute(async (req, res) => {
  const body = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    worker_name: z.string().min(2)
  }).parse(req.body);
  const { from, to } = defaultRange(body);
  const worker = body.worker_name.trim();
  const userId = (req as AuthenticatedRequest).user?.id ?? null;

  const result = await inTransaction(async (client) => {
    // Eventos pendientes: llenados sin recepción + túneles finalizados sin botada.
    const eventos = await client.query(
      `SELECT d.id AS drying_report_id, d.tunnel_number, 'LLENADO'::text AS momento,
              COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) AS work_date,
              d.total_quintals::float AS quintals,
              d.recepcion_empaque AS empaque, d.recepcion_sacos::float AS sacos
       FROM drying_tunnel_reports d
       WHERE COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) BETWEEN $1 AND $2
         AND COALESCE(d.total_quintals,0) > 0
         AND NOT EXISTS (SELECT 1 FROM drying_tunnel_cuadrilla a WHERE a.drying_report_id = d.id AND a.momento='LLENADO')
       UNION ALL
       SELECT d.id, d.tunnel_number, 'VACIADO'::text,
              COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date),
              d.total_quintals::float,
              d.botada_empaque AS empaque, d.botada_sacos::float AS sacos
       FROM drying_tunnel_reports d
       WHERE COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) BETWEEN $1 AND $2
         AND COALESCE(d.total_quintals,0) > 0
         AND d.dry_end_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM drying_tunnel_cuadrilla a WHERE a.drying_report_id = d.id AND a.momento='VACIADO')`,
      [from, to]
    );

    let count = 0;
    const sinTarifa: string[] = [];
    for (const e of eventos.rows) {
      const tunnel = Number(e.tunnel_number);
      const momento = e.momento === "VACIADO" ? "VACIADO" : "LLENADO";
      const qq = Number(e.quintals) || 0;

      // La labor y cantidad dependen del EMPAQUE del túnel (Tulas por QQ vs Sacos
      // por saco). Si falta la tarifa configurada, se omite y se reporta.
      const resolved = await resolveTunnelLabor(client, {
        tunnel_number: tunnel,
        momento,
        empaque: e.empaque,
        sacos: e.sacos == null ? null : Number(e.sacos),
        quintals: qq
      });
      if ("missing" in resolved) { sinTarifa.push(resolved.missing); continue; }
      const workDate = e.work_date ? new Date(e.work_date).toISOString().slice(0, 10) : null;

      // Asignación (100% al grupo) + pago, en la misma transacción. La cantidad
      // asignada es QQ (Tulas) o Nº de sacos (Sacos), según el empaque.
      await client.query(
        `INSERT INTO drying_tunnel_cuadrilla (drying_report_id, worker_name, activity_id, quintals, momento, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (drying_report_id, momento, (lower(btrim(worker_name))))
         DO UPDATE SET activity_id = EXCLUDED.activity_id, quintals = EXCLUDED.quintals`,
        [e.drying_report_id, worker, resolved.activity_id, resolved.quantity, momento, userId]
      );
      const entry = await upsertCuadrillaSecadoraEntry(client, {
        referencia_id: e.drying_report_id,
        tunnel_number: tunnel,
        momento,
        activity_id: resolved.activity_id,
        worker_name: worker,
        quantity: resolved.quantity,
        work_date: workDate,
        created_by: userId
      });
      if (entry) count++;
    }
    return { created: count, worker_name: worker, sin_tarifa: [...new Set(sinTarifa)] };
  });
  res.json(result);
}));

cuadrillaRouter.post("/activities", asyncRoute(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    unit_rate: z.number().nonnegative()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO cuadrilla_activities (name, unit_rate)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET unit_rate = EXCLUDED.unit_rate, is_active = true
     RETURNING id, name, unit_rate, is_active`,
    [body.name.trim().toUpperCase(), body.unit_rate]
  );
  res.status(201).json(result.rows[0]);
}));

cuadrillaRouter.put("/activities/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    unit_rate: z.number().nonnegative().optional(),
    is_active: z.boolean().optional()
  }).parse(req.body);

  const result = await pool.query(
    `UPDATE cuadrilla_activities
     SET unit_rate = COALESCE($2, unit_rate),
         is_active = COALESCE($3, is_active)
     WHERE id = $1
     RETURNING id, name, unit_rate, is_active`,
    [req.params.id, body.unit_rate ?? null, body.is_active ?? null]
  );
  if (!result.rowCount) throw new ApiError(404, "Actividad no encontrada");
  res.json(result.rows[0]);
}));

// ── Entradas (registro diario por actividad) ────────────────────────────────

function parseRange(query: unknown): { from: string; to: string } {
  const schema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  });
  const { from, to } = schema.parse(query);
  const today = new Date();
  const monday = new Date(today);
  const day = (today.getDay() + 6) % 7; // 0 = lunes
  monday.setDate(today.getDate() - day);
  return {
    from: from ?? monday.toISOString().slice(0, 10),
    to: to ?? today.toISOString().slice(0, 10)
  };
}

cuadrillaRouter.get("/entries", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const result = await pool.query(
    `SELECT id, work_date, activity_id, activity_name, worker_name, quantity, unit_rate, subtotal, notes,
            origen, referencia_id, tunnel_number, momento
     FROM cuadrilla_entries
     WHERE work_date BETWEEN $1 AND $2
     ORDER BY work_date DESC, created_at DESC`,
    [from, to]
  );
  const total = result.rows.reduce((s, r) => s + Number(r.subtotal), 0);
  res.json({ range: { from, to }, rows: result.rows, total: round2(total) });
}));

cuadrillaRouter.post("/entries", asyncRoute(async (req, res) => {
  const body = z.object({
    work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    activity_id: z.string().uuid(),
    worker_name: z.string().optional().default(""),
    quantity: z.number().positive(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const activity = await pool.query(
    "SELECT name, unit_rate FROM cuadrilla_activities WHERE id = $1",
    [body.activity_id]
  );
  if (!activity.rowCount) throw new ApiError(404, "Actividad no encontrada");

  const rate = Number(activity.rows[0].unit_rate);
  const subtotal = round2(body.quantity * rate);

  const result = await pool.query(
    `INSERT INTO cuadrilla_entries
       (work_date, activity_id, activity_name, worker_name, quantity, unit_rate, subtotal, notes, created_by)
     VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, work_date, activity_name, worker_name, quantity, unit_rate, subtotal, notes`,
    [
      body.work_date ?? null,
      body.activity_id,
      activity.rows[0].name,
      body.worker_name.trim(),
      body.quantity,
      rate,
      subtotal,
      body.notes ?? null,
      body.created_by ?? null
    ]
  );
  res.status(201).json(result.rows[0]);
}));

cuadrillaRouter.delete("/entries/:id", asyncRoute(async (req, res) => {
  // Los registros autogenerados desde Secadoras NO se borran aquí: hacerlo
  // descuadraría el movimiento del túnel. Se corrigen en el módulo de Secadoras.
  const current = await pool.query("SELECT origen, tunnel_number FROM cuadrilla_entries WHERE id = $1", [req.params.id]);
  if (!current.rowCount) throw new ApiError(404, "Registro no encontrado");
  if (current.rows[0].origen === "SECADORA") {
    throw new ApiError(409, `Este registro se generó automáticamente desde Secadoras (Túnel ${current.rows[0].tunnel_number ?? "?"}). Corrígelo en el módulo de Secadoras.`);
  }
  await pool.query("DELETE FROM cuadrilla_entries WHERE id = $1", [req.params.id]);
  res.status(204).end();
}));

// Editar un registro MANUAL de cuadrilla. Los automáticos (Secadora) son
// inmutables: se corrigen editando el túnel en el módulo de Secadoras.
cuadrillaRouter.put("/entries/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    activity_id: z.string().uuid(),
    worker_name: z.string().optional().default(""),
    quantity: z.number().positive()
  }).parse(req.body);

  const current = await pool.query("SELECT origen, tunnel_number FROM cuadrilla_entries WHERE id = $1", [req.params.id]);
  if (!current.rowCount) throw new ApiError(404, "Registro no encontrado");
  if (current.rows[0].origen === "SECADORA") {
    throw new ApiError(409, "Este registro proviene de Secadoras. Para modificar los quintales, edite el túnel directamente.");
  }
  const activity = await pool.query("SELECT name, unit_rate FROM cuadrilla_activities WHERE id = $1", [body.activity_id]);
  if (!activity.rowCount) throw new ApiError(404, "Actividad no encontrada");
  const rate = Number(activity.rows[0].unit_rate);
  const subtotal = round2(body.quantity * rate);

  const result = await pool.query(
    `UPDATE cuadrilla_entries
     SET work_date = COALESCE($2::date, work_date),
         activity_id = $3, activity_name = $4, worker_name = $5,
         quantity = $6, unit_rate = $7, subtotal = $8
     WHERE id = $1 AND origen <> 'SECADORA'
     RETURNING id, work_date, activity_name, worker_name, quantity, unit_rate, subtotal, notes, origen, referencia_id, tunnel_number, momento`,
    [req.params.id, body.work_date ?? null, body.activity_id, activity.rows[0].name, body.worker_name.trim(), body.quantity, rate, subtotal]
  );
  res.json(result.rows[0]);
}));

// ── Resumen por persona (total ganado, anticipos pendientes, neto) ──────────

cuadrillaRouter.get("/summary", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const earned = await pool.query(
    `SELECT worker_name,
            COUNT(*)::int AS entradas,
            COALESCE(SUM(subtotal), 0)::float AS total
     FROM cuadrilla_entries
     WHERE work_date BETWEEN $1 AND $2
     GROUP BY worker_name
     ORDER BY total DESC`,
    [from, to]
  );
  const advances = await pool.query(
    `SELECT worker_name, COALESCE(SUM(balance), 0)::float AS pending
     FROM cuadrilla_advances
     WHERE status IN ('PENDING', 'PARTIAL')
     GROUP BY worker_name`
  );
  const pendingByWorker = new Map<string, number>(
    advances.rows.map((r) => [r.worker_name, Number(r.pending)])
  );

  const rows = earned.rows.map((r) => {
    const pending = pendingByWorker.get(r.worker_name) ?? 0;
    return {
      worker_name: r.worker_name,
      entradas: r.entradas,
      total: round2(Number(r.total)),
      anticipos: round2(pending),
      neto: round2(Number(r.total) - pending)
    };
  });

  res.json({
    range: { from, to },
    rows,
    total_general: round2(rows.reduce((s, r) => s + r.total, 0)),
    total_anticipos: round2(rows.reduce((s, r) => s + r.anticipos, 0)),
    total_neto: round2(rows.reduce((s, r) => s + r.neto, 0))
  });
}));

// ── Anticipos de la cuadrilla ───────────────────────────────────────────────

cuadrillaRouter.get("/advances", asyncRoute(async (req, res) => {
  const status = z.object({ status: z.enum(["pending", "all"]).optional() }).parse(req.query).status ?? "pending";
  const where = status === "pending" ? "WHERE status IN ('PENDING', 'PARTIAL')" : "";
  const result = await pool.query(
    `SELECT id, worker_name, amount, balance, concept, status, issued_at
     FROM cuadrilla_advances
     ${where}
     ORDER BY issued_at DESC`
  );
  res.json(result.rows);
}));

cuadrillaRouter.post("/advances", asyncRoute(async (req, res) => {
  const body = z.object({
    worker_name: z.string().min(2),
    amount: z.number().positive(),
    concept: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await pool.query(
    `INSERT INTO cuadrilla_advances (worker_name, amount, balance, concept, created_by)
     VALUES ($1, $2, $2, $3, $4)
     RETURNING id, worker_name, amount, balance, concept, status, issued_at`,
    [body.worker_name.trim(), body.amount, body.concept ?? null, body.created_by ?? null]
  );
  res.status(201).json(result.rows[0]);
}));

// Salda (total o parcial) un anticipo pendiente.
cuadrillaRouter.post("/advances/:id/settle", asyncRoute(async (req, res) => {
  const body = z.object({ amount: z.number().positive().optional() }).parse(req.body);
  const current = await pool.query("SELECT balance FROM cuadrilla_advances WHERE id = $1", [req.params.id]);
  if (!current.rowCount) throw new ApiError(404, "Anticipo no encontrado");

  const balance = Number(current.rows[0].balance);
  const pay = round2(Math.min(body.amount ?? balance, balance));
  const newBalance = round2(balance - pay);
  const newStatus = newBalance < 0.01 ? "PAID" : "PARTIAL";

  const result = await pool.query(
    "UPDATE cuadrilla_advances SET balance = $2, status = $3 WHERE id = $1 RETURNING id, worker_name, amount, balance, status",
    [req.params.id, newBalance, newStatus]
  );
  res.json(result.rows[0]);
}));
