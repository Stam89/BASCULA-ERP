import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { inTransaction } from "../../db/transaction.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { exigirCajaAbiertaDelAccionista } from "../../services/caja.js";
import { requireAdmin, type AuthenticatedRequest } from "../../auth/require-auth.js";
import { registrarSacosRecuperados, revertirSacosRecuperados } from "../../services/sacos.js";
import { armarRoster, canonico, evaluarNombre, type Evaluacion } from "../../services/bajada-nombres.js";

export const cuadrillaRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;
type Queryable = { query: typeof pool.query };
type EffectiveCuadrillaActivity = {
  id: string;
  name: string;
  unit_rate: number;
  is_active: boolean;
  categoria: string;
};

// Labores por saco (cuando la corrida se maneja en Sacos porque se agotaron las
// Tulas). Se busca la primera activa en este orden de preferencia.
const SACOS_LABOR_CANDIDATES = ["ENSACADO", "SACADO EN SACO"];
const DESPACHO_LABOR_CANDIDATES = ["ESTIBADA", "EMBARQUE Y DESEMBARQUE"];

const normalizeActivityName = (name: string) => name.trim().toUpperCase();

async function resolveCuadrillaSocioId(db: Queryable, accionistaId?: string | null): Promise<string | null> {
  if (!accionistaId) return null;
  const result = await db.query("SELECT tipo FROM accionistas WHERE id = $1", [accionistaId]);
  if (!result.rowCount || result.rows[0]?.tipo === "MATRIZ") return null;
  return accionistaId;
}

async function reqCuadrillaSocioId(req: unknown): Promise<string | null> {
  return resolveCuadrillaSocioId(pool, (req as AuthenticatedRequest).accionistaId ?? null);
}

export async function getEffectiveCuadrillaActivityByName(
  db: Queryable,
  name: string,
  socioId: string | null,
  activeOnly = true
): Promise<EffectiveCuadrillaActivity | null> {
  const normalized = normalizeActivityName(name);
  const activeWhere = activeOnly ? "AND is_active = true" : "";
  const result = await db.query(
    `SELECT id, name, unit_rate::float AS unit_rate, is_active, categoria
     FROM cuadrilla_activities
     WHERE upper(btrim(name)) = $2
       AND (($1::uuid IS NOT NULL AND socio_id = $1::uuid) OR socio_id IS NULL)
       ${activeWhere}
     ORDER BY CASE WHEN socio_id = $1::uuid THEN 0 ELSE 1 END
     LIMIT 1`,
    [socioId, normalized]
  );
  return result.rows[0] ?? null;
}

async function getEffectiveActivityById(
  db: Queryable,
  activityId: string,
  socioId: string | null,
  activeOnly = true
): Promise<EffectiveCuadrillaActivity | null> {
  const source = await db.query("SELECT name FROM cuadrilla_activities WHERE id = $1", [activityId]);
  if (!source.rowCount) return null;
  return getEffectiveCuadrillaActivityByName(db, String(source.rows[0].name), socioId, activeOnly);
}

async function getFirstEffectiveActivityByNames(
  db: Queryable,
  names: string[],
  socioId: string | null
): Promise<EffectiveCuadrillaActivity | null> {
  for (const name of names) {
    const activity = await getEffectiveCuadrillaActivityByName(db, name, socioId);
    if (activity) return activity;
  }
  return null;
}

async function upsertActivityOverride(
  db: Queryable,
  opts: { activityId?: string | null; name?: string | null; unit_rate?: number; is_active?: boolean; socioId: string | null }
): Promise<EffectiveCuadrillaActivity> {
  const source = opts.activityId
    ? await db.query("SELECT id, name, unit_rate, is_active, categoria, socio_id FROM cuadrilla_activities WHERE id = $1", [opts.activityId])
    : { rowCount: 0, rows: [] as any[] };
  if (opts.activityId && !source.rowCount) throw new ApiError(404, "Actividad no encontrada");
  const sourceRow = source.rows[0] ?? null;
  const name = normalizeActivityName(String(opts.name ?? sourceRow?.name ?? ""));
  if (name.length < 2) throw new ApiError(400, "Nombre de actividad inválido");
  const categoria = String(sourceRow?.categoria ?? "GENERAL").trim().toUpperCase() || "GENERAL";
  const unitRate = opts.unit_rate ?? Number(sourceRow?.unit_rate ?? 0);
  const isActive = opts.is_active ?? Boolean(sourceRow?.is_active ?? true);

  if (!opts.socioId) {
    if (opts.activityId) {
      const updated = await db.query(
        `UPDATE cuadrilla_activities
         SET unit_rate = COALESCE($2, unit_rate),
             is_active = COALESCE($3, is_active)
         WHERE id = $1 AND socio_id IS NULL
         RETURNING id, name, unit_rate::float AS unit_rate, is_active, categoria`,
        [opts.activityId, opts.unit_rate ?? null, opts.is_active ?? null]
      );
      if (!updated.rowCount) throw new ApiError(404, "Actividad maestra no encontrada");
      return updated.rows[0];
    }
    const existing = await db.query(
      "SELECT id FROM cuadrilla_activities WHERE socio_id IS NULL AND upper(btrim(name)) = $1 LIMIT 1",
      [name]
    );
    if (existing.rowCount) {
      const updated = await db.query(
        `UPDATE cuadrilla_activities
         SET unit_rate = $2, is_active = true
         WHERE id = $1
         RETURNING id, name, unit_rate::float AS unit_rate, is_active, categoria`,
        [existing.rows[0].id, unitRate]
      );
      return updated.rows[0];
    }
    const inserted = await db.query(
      `INSERT INTO cuadrilla_activities (name, unit_rate, is_active, categoria, socio_id)
       VALUES ($1, $2, true, $3, NULL)
       RETURNING id, name, unit_rate::float AS unit_rate, is_active, categoria`,
      [name, unitRate, categoria]
    );
    return inserted.rows[0];
  }

  const existing = await db.query(
    "SELECT id FROM cuadrilla_activities WHERE socio_id = $1 AND upper(btrim(name)) = $2 LIMIT 1",
    [opts.socioId, name]
  );
  if (existing.rowCount) {
    const updated = await db.query(
      `UPDATE cuadrilla_activities
       SET unit_rate = COALESCE($2, unit_rate),
           is_active = COALESCE($3, is_active),
           categoria = COALESCE($4, categoria)
       WHERE id = $1
       RETURNING id, name, unit_rate::float AS unit_rate, is_active, categoria`,
      [existing.rows[0].id, opts.unit_rate ?? null, opts.is_active ?? null, categoria]
    );
    return updated.rows[0];
  }
  const inserted = await db.query(
    `INSERT INTO cuadrilla_activities (name, unit_rate, is_active, categoria, socio_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, unit_rate::float AS unit_rate, is_active, categoria`,
    [name, unitRate, isActive, categoria, opts.socioId]
  );
  return inserted.rows[0];
}

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
    socio_id?: string | null;
  }
): Promise<
  | { activity_id: string; activity_name: string; unit_rate: number; quantity: number }
  | { missing: string }
> {
  const esSacos = String(opts.empaque ?? "TULAS").toUpperCase() === "SACOS";
  if (esSacos) {
    const act = await getFirstEffectiveActivityByNames(client, SACOS_LABOR_CANDIDATES, opts.socio_id ?? null);
    if (!act) return { missing: SACOS_LABOR_CANDIDATES[0] };
    const sacos = Number(opts.sacos) || 0;
    const quantity = sacos > 0 ? sacos : Number(opts.quintals) || 0;
    return {
      activity_id: act.id,
      activity_name: act.name,
      unit_rate: Number(act.unit_rate),
      quantity
    };
  }
  const laborName = opts.momento === "VACIADO" ? "BOTADA DE TUNEL" : `RECEPCION A TUNEL ${opts.tunnel_number}`;
  const act = await getEffectiveCuadrillaActivityByName(client, laborName, opts.socio_id ?? null);
  if (!act) return { missing: laborName };
  return {
    activity_id: act.id,
    activity_name: act.name,
    unit_rate: Number(act.unit_rate),
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
    accionista_id?: string | null;
  }
): Promise<{ id: string } | null> {
  try {
    const worker = (opts.worker_name ?? "").trim();
    // Ambos campos son opcionales: sin cuadrilla o sin labor no se autogenera nada.
    if (!opts.activity_id || worker.length < 2) return null;

    const socioId = await resolveCuadrillaSocioId(client, opts.accionista_id ?? null);
    const activity = await getEffectiveActivityById(client, opts.activity_id, socioId);
    if (!activity) return null; // labor inexistente/inactiva: no romper el secado

    const rate = Number(activity.unit_rate);
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
        activity.id,
        activity.name,
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

// Cuadrilla a la que se asigna un pago autogenerado cuando el operador no eligió
// una: respeta la ya asignada en el túnel; si no hay, usa el grupo de cuadrilla
// por defecto (el más antiguo activo); si tampoco, el literal "CUADRILLA".
async function resolveCuadrillaWorker(client: PoolClient, dryingReportId: string): Promise<string> {
  const asig = await client.query(
    "SELECT worker_name FROM drying_tunnel_cuadrilla WHERE drying_report_id = $1 AND COALESCE(btrim(worker_name), '') <> '' ORDER BY momento LIMIT 1",
    [dryingReportId]
  );
  if (asig.rowCount) return String(asig.rows[0].worker_name).trim();
  const grp = await client.query("SELECT name FROM cuadrillas WHERE is_active = true ORDER BY created_at LIMIT 1");
  if (grp.rowCount) return String(grp.rows[0].name).trim();
  return "CUADRILLA";
}

async function resolveDefaultCuadrillaWorker(client: PoolClient): Promise<string> {
  const grp = await client.query("SELECT name FROM cuadrillas WHERE is_active = true ORDER BY created_at LIMIT 1");
  if (grp.rowCount) return String(grp.rows[0].name).trim();
  return "CUADRILLA";
}

export async function upsertCuadrillaDespachoVentaEntry(
  client: PoolClient,
  opts: {
    order_id: string;
    order_number: string;
    guia_number?: string | null;
    customer_name?: string | null;
    quantity_qq: number;
    work_date?: string | null;
    created_by?: string | null;
    accionista_id?: string | null;
  }
): Promise<{ id: string } | null> {
  const qty = Number(opts.quantity_qq) || 0;
  if (qty <= 0) return null;

  const socioId = await resolveCuadrillaSocioId(client, opts.accionista_id ?? null);
  const activity = await getFirstEffectiveActivityByNames(client, DESPACHO_LABOR_CANDIDATES, socioId);
  if (!activity) {
    throw new ApiError(400, `Configura la tarifa de la labor "${DESPACHO_LABOR_CANDIDATES[0]}" en Cuadrilla -> Actividades antes de despachar.`);
  }

  const worker = await resolveDefaultCuadrillaWorker(client);
  const rate = Number(activity.unit_rate);
  const subtotal = round2(qty * rate);
  const ref = opts.guia_number || opts.order_number;
  const cliente = opts.customer_name?.trim() || "cliente";
  const notes = `Despacho Venta #${ref} - ${cliente}`;
  const result = await client.query(
    `INSERT INTO cuadrilla_entries
       (work_date, activity_id, activity_name, worker_name, quantity, unit_rate, subtotal, notes,
        origen, referencia_id, momento, created_by)
     VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, 'VENTA', $9, 'DESPACHO', $10)
     ON CONFLICT (referencia_id, momento) WHERE origen = 'VENTA'
     DO UPDATE SET
       work_date = COALESCE(EXCLUDED.work_date, cuadrilla_entries.work_date),
       activity_id = EXCLUDED.activity_id,
       activity_name = EXCLUDED.activity_name,
       worker_name = EXCLUDED.worker_name,
       quantity = EXCLUDED.quantity,
       unit_rate = EXCLUDED.unit_rate,
       subtotal = EXCLUDED.subtotal,
       notes = EXCLUDED.notes
     RETURNING id`,
    [
      opts.work_date ?? null,
      activity.id,
      // Trazabilidad de cliente: el concepto/actividad mostrado concatena el cliente
      // del despacho (ej. "ESTIBADA - Cliente: COMERCIAL X"). activity_id sigue
      // ligado a la actividad del catálogo (la tarifa no cambia).
      `${activity.name} - Cliente: ${cliente}`,
      worker,
      qty,
      rate,
      subtotal,
      notes,
      opts.order_id,
      opts.created_by ?? null
    ]
  );
  return result.rows[0] ?? null;
}

export async function revertCuadrillaDespachoVentaEntry(client: PoolClient, orderId: string): Promise<number> {
  const deleted = await client.query(
    "DELETE FROM cuadrilla_entries WHERE origen = 'VENTA' AND referencia_id = $1 AND paid_at IS NULL",
    [orderId]
  );
  return deleted.rowCount ?? 0;
}

// AUTOMATIZACIÓN: genera de inmediato el pago de nómina de la cuadrilla para un
// secado MECÁNICO (túnel), sin el paso manual de "Detectar". Idempotente (se
// apoya en el upsert por referencia/momento/cuadrilla), así que puede llamarse
// tanto al llenar como al finalizar sin duplicar. LLENADO se paga en cuanto el
// túnel tiene quintales; VACIADO en cuanto queda finalizado (dry_end_at). El
// tendal genera su propio pago aparte, así que aquí se omite. Nunca lanza.
export async function autoGenerarPagosCuadrillaDeSecado(
  client: PoolClient,
  dryingReportId: string,
  createdBy?: string | null
): Promise<void> {
  const savepoint = "auto_cuadrilla_secado";
  try {
    // La automatización es complementaria. El SAVEPOINT permite recuperarse de
    // un fallo SQL sin dejar abortada la transacción principal del secado.
    await client.query(`SAVEPOINT ${savepoint}`);
    const r = await client.query(
      `SELECT d.tunnel_number, d.total_quintals::float AS quintals, d.dry_method, d.dry_end_at,
              d.recepcion_empaque, d.recepcion_sacos::float AS recepcion_sacos,
              d.botada_empaque, d.botada_sacos::float AS botada_sacos,
              COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) AS work_date,
              l.accionista_id
       FROM drying_tunnel_reports d
       LEFT JOIN lots l ON l.id = d.lot_id
       WHERE d.id = $1`,
      [dryingReportId]
    );
    if (!r.rowCount) { await client.query(`RELEASE SAVEPOINT ${savepoint}`); return; }
    const rep = r.rows[0];
    if (String(rep.dry_method ?? "TUNEL").toUpperCase() === "TENDAL") {
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return; // el tendal ya se paga aparte
    }
    const tunnel = Number(rep.tunnel_number) || 0;
    const qq = Number(rep.quintals) || 0;
    const accionistaId = rep.accionista_id as string | null;
    const socioId = await resolveCuadrillaSocioId(client, accionistaId);
    if (!tunnel || qq <= 0) { await client.query(`RELEASE SAVEPOINT ${savepoint}`); return; }
    const workDate = rep.work_date ? new Date(rep.work_date).toISOString().slice(0, 10) : null;

    const eventos: Array<{ momento: "LLENADO" | "VACIADO"; empaque: string | null; sacos: number | null }> = [
      { momento: "LLENADO", empaque: rep.recepcion_empaque, sacos: rep.recepcion_sacos ?? null }
    ];
    // La botada solo se paga cuando el túnel ya está finalizado (vaciado a bodega).
    if (rep.dry_end_at) {
      eventos.push({ momento: "VACIADO", empaque: rep.botada_empaque ?? rep.recepcion_empaque, sacos: rep.botada_sacos ?? null });
    }

    for (const ev of eventos) {
      // Respeta una asignación ya existente (worker/labor elegidos por el operador);
      // si no hay, crea una con la labor por tarifa y la cuadrilla por defecto.
      const asig = await client.query(
        "SELECT worker_name, activity_id, quintals::float AS quintals FROM drying_tunnel_cuadrilla WHERE drying_report_id = $1 AND momento = $2 ORDER BY created_at LIMIT 1",
        [dryingReportId, ev.momento]
      );
      let workerName: string;
      let activityId: string;
      let quantity: number;
      if (asig.rowCount) {
        workerName = String(asig.rows[0].worker_name).trim();
        activityId = asig.rows[0].activity_id as string;
        quantity = Number(asig.rows[0].quintals) || 0;
      } else {
        const resolved = await resolveTunnelLabor(client, {
          tunnel_number: tunnel, momento: ev.momento, empaque: ev.empaque, sacos: ev.sacos, quintals: qq, socio_id: socioId
        });
        if ("missing" in resolved) continue; // sin tarifa configurada: no romper el secado
        workerName = await resolveCuadrillaWorker(client, dryingReportId);
        activityId = resolved.activity_id;
        quantity = resolved.quantity;
        await client.query(
          `INSERT INTO drying_tunnel_cuadrilla (drying_report_id, worker_name, activity_id, quintals, momento, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (drying_report_id, momento, (lower(btrim(worker_name)))) DO NOTHING`,
          [dryingReportId, workerName, activityId, quantity, ev.momento, createdBy ?? null]
        );
      }
      await upsertCuadrillaSecadoraEntry(client, {
        referencia_id: dryingReportId,
        tunnel_number: tunnel,
        momento: ev.momento,
        activity_id: activityId,
        worker_name: workerName,
        quantity,
        work_date: workDate,
        created_by: createdBy ?? null,
        accionista_id: accionistaId
      });
    }
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => undefined);
    console.error("[cuadrilla] auto-pago de secado (túnel) falló", {
      drying_report_id: dryingReportId,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

// ── Actividades (catálogo con valor unitario) ───────────────────────────────

cuadrillaRouter.get("/activities", asyncRoute(async (req, res) => {
  // ?categoria=SECADORA filtra a las labores de túnel (para el form de Secadoras).
  const { categoria } = z.object({ categoria: z.string().optional() }).parse(req.query);
  const socioId = await reqCuadrillaSocioId(req);
  const result = await pool.query(
    `WITH master AS (
       SELECT id, name, unit_rate, is_active, categoria
       FROM cuadrilla_activities
       WHERE socio_id IS NULL
     ),
     own AS (
       SELECT id, name, unit_rate, is_active, categoria
       FROM cuadrilla_activities
       WHERE $1::uuid IS NOT NULL AND socio_id = $1::uuid
     ),
     merged_master AS (
       SELECT COALESCE(o.id, m.id) AS id,
              COALESCE(o.name, m.name) AS name,
              COALESCE(o.unit_rate, m.unit_rate) AS unit_rate,
              COALESCE(o.is_active, m.is_active) AS is_active,
              COALESCE(o.categoria, m.categoria) AS categoria,
              CASE WHEN o.id IS NULL THEN 'MAESTRO' ELSE 'SOCIO' END AS fuente_tarifa
       FROM master m
       LEFT JOIN own o ON upper(btrim(o.name)) = upper(btrim(m.name))
     ),
     own_extra AS (
       SELECT o.id, o.name, o.unit_rate, o.is_active, o.categoria, 'SOCIO' AS fuente_tarifa
       FROM own o
       WHERE NOT EXISTS (SELECT 1 FROM master m WHERE upper(btrim(m.name)) = upper(btrim(o.name)))
     )
     SELECT id, name, unit_rate, is_active, categoria, fuente_tarifa
     FROM (
       SELECT * FROM merged_master
       UNION ALL
       SELECT * FROM own_extra
     ) a
     WHERE is_active = true
       AND ($2::text IS NULL OR categoria = $2)
     ORDER BY name`,
    [socioId, categoria ? categoria.trim().toUpperCase() : null]
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
              a.worker_name, a.activity_id, a.quintals, l.accionista_id
       FROM drying_tunnel_cuadrilla a
       JOIN drying_tunnel_reports d ON d.id = a.drying_report_id
       LEFT JOIN lots l ON l.id = d.lot_id
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
        created_by: userId,
        accionista_id: a.accionista_id ?? null
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
              d.recepcion_empaque AS empaque, d.recepcion_sacos::float AS sacos,
              l.accionista_id
       FROM drying_tunnel_reports d
       LEFT JOIN lots l ON l.id = d.lot_id
       WHERE COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date) BETWEEN $1 AND $2
         AND COALESCE(d.total_quintals,0) > 0
         AND NOT EXISTS (SELECT 1 FROM drying_tunnel_cuadrilla a WHERE a.drying_report_id = d.id AND a.momento='LLENADO')
       UNION ALL
       SELECT d.id, d.tunnel_number, 'VACIADO'::text,
              COALESCE(d.filled_at, d.dry_start_at::date, d.created_at::date),
              d.total_quintals::float,
              d.botada_empaque AS empaque, d.botada_sacos::float AS sacos,
              l.accionista_id
       FROM drying_tunnel_reports d
       LEFT JOIN lots l ON l.id = d.lot_id
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
      const socioId = await resolveCuadrillaSocioId(client, e.accionista_id ?? null);

      // La labor y cantidad dependen del EMPAQUE del túnel (Tulas por QQ vs Sacos
      // por saco). Si falta la tarifa configurada, se omite y se reporta.
      const resolved = await resolveTunnelLabor(client, {
        tunnel_number: tunnel,
        momento,
        empaque: e.empaque,
        sacos: e.sacos == null ? null : Number(e.sacos),
        quintals: qq,
        socio_id: socioId
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
        created_by: userId,
        accionista_id: e.accionista_id ?? null
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
    unit_rate: z.number().nonnegative(),
    accionista_id: z.string().uuid().nullable().optional()
  }).parse(req.body);

  const requestedAccionista = body.accionista_id ?? (req as AuthenticatedRequest).accionistaId ?? null;
  const socioId = await resolveCuadrillaSocioId(pool, requestedAccionista);
  const activity = await upsertActivityOverride(pool, {
    name: body.name,
    unit_rate: body.unit_rate,
    is_active: true,
    socioId
  });
  res.status(201).json(activity);
}));

cuadrillaRouter.put("/activities/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    unit_rate: z.number().nonnegative().optional(),
    is_active: z.boolean().optional(),
    accionista_id: z.string().uuid().nullable().optional()
  }).parse(req.body);

  const requestedAccionista = body.accionista_id ?? (req as AuthenticatedRequest).accionistaId ?? null;
  const socioId = await resolveCuadrillaSocioId(pool, requestedAccionista);
  const activity = await upsertActivityOverride(pool, {
    activityId: String(req.params.id),
    unit_rate: body.unit_rate,
    is_active: body.is_active,
    socioId
  });
  res.json(activity);
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

// ── CAMBIO DE SACO: el saco recuperado y su destino ─────────────────────────
// Solo en la actividad «CAMBIO DE SACO». La cantidad es la del registro (N.º de
// sacos). Destino BODEGA → los sacos entran al inventario como «<tipo> (Usado)»
// (aparte de los nuevos); DESCARTE → solo queda anotado. Todo opcional.
const esCambioDeSaco = (activityName: string) =>
  activityName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().includes("CAMBIO DE SACO");
const sacoRecuperadoSchema = {
  // Tipo de saco recuperado: id del catálogo de sacos (Flor 100 LB…).
  marca_saco_recuperado: z.string().uuid().optional().nullable(),
  destino_saco: z.enum(["BODEGA", "DESCARTE"]).optional().nullable()
};

async function guardarSacoRecuperado(
  client: PoolClient,
  e: { id: string; activityName: string; cantidad: number; worker: string; marcaId: string | null | undefined; destino: string | null | undefined }
) {
  if (!esCambioDeSaco(e.activityName) || (!e.marcaId && !e.destino)) {
    await client.query(
      "UPDATE cuadrilla_entries SET saco_recuperado_id = NULL, marca_saco_recuperado = NULL, destino_saco = NULL WHERE id = $1",
      [e.id]
    );
    return null;
  }
  if (e.destino === "BODEGA" && !e.marcaId) throw new ApiError(400, "Elige la marca del saco recuperado para guardarlo en bodega.");
  let etiqueta: string | null = null;
  if (e.marcaId) {
    const saco = await client.query("SELECT tipo FROM sack_inventory WHERE id = $1 AND accionista_id IS NULL", [e.marcaId]);
    if (!saco.rows[0]) throw new ApiError(404, "Ese saco no está en el catálogo de sacos de la planta.");
    etiqueta = saco.rows[0].tipo;
  }
  await client.query(
    "UPDATE cuadrilla_entries SET saco_recuperado_id = $2, marca_saco_recuperado = $3, destino_saco = $4 WHERE id = $1",
    [e.id, e.marcaId ?? null, etiqueta, e.destino ?? null]
  );
  const ingreso = e.destino === "BODEGA"
    ? await registrarSacosRecuperados(client, {
      sackId: e.marcaId!, cantidad: e.cantidad, entryId: e.id,
      concepto: `Recuperado en cambio de saco${e.worker ? ` · ${e.worker}` : ""}`
    })
    : null;
  return { marca_saco_recuperado: etiqueta, destino_saco: e.destino ?? null, ingreso_bodega: ingreso };
}

cuadrillaRouter.get("/entries", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const result = await pool.query(
    `SELECT id, work_date, activity_id, activity_name, worker_name, quantity, unit_rate, subtotal, notes,
            origen, referencia_id, tunnel_number, momento,
            saco_recuperado_id, marca_saco_recuperado, destino_saco
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
    created_by: z.string().uuid().optional(),
    ...sacoRecuperadoSchema
  }).parse(req.body);

  const socioId = await reqCuadrillaSocioId(req);
  const activity = await getEffectiveActivityById(pool, body.activity_id, socioId, false);
  if (!activity) throw new ApiError(404, "Actividad no encontrada");

  const rate = Number(activity.unit_rate);
  const subtotal = round2(body.quantity * rate);

  const out = await inTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO cuadrilla_entries
         (work_date, activity_id, activity_name, worker_name, quantity, unit_rate, subtotal, notes, created_by)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, work_date, activity_name, worker_name, quantity, unit_rate, subtotal, notes`,
      [
        body.work_date ?? null,
        activity.id,
        activity.name,
        body.worker_name.trim(),
        body.quantity,
        rate,
        subtotal,
        body.notes ?? null,
        body.created_by ?? null
      ]
    );
    const saco = await guardarSacoRecuperado(client, {
      id: result.rows[0].id, activityName: activity.name, cantidad: body.quantity, worker: body.worker_name.trim(),
      marcaId: body.marca_saco_recuperado, destino: body.destino_saco
    });
    return { ...result.rows[0], ...(saco ?? {}) };
  });
  res.status(201).json(out);
}));

cuadrillaRouter.delete("/entries/:id", asyncRoute(async (req, res) => {
  // Los registros autogenerados NO se borran aquí: hacerlo descuadraría el
  // movimiento de origen. Se corrigen en Secadoras/Ventas según corresponda.
  const current = await pool.query("SELECT origen, tunnel_number FROM cuadrilla_entries WHERE id = $1", [req.params.id]);
  if (!current.rowCount) throw new ApiError(404, "Registro no encontrado");
  if (current.rows[0].origen === "SECADORA" || current.rows[0].origen === "VENTA") {
    const origen = current.rows[0].origen === "VENTA" ? "Ventas" : `Secadoras (Túnel ${current.rows[0].tunnel_number ?? "?"})`;
    throw new ApiError(409, `Este registro se generó automáticamente desde ${origen}. Corrígelo en el módulo de origen.`);
  }
  await inTransaction(async (client) => {
    await revertirSacosRecuperados(client, String(req.params.id), "Reverso: se eliminó el registro de cambio de saco");
    await client.query("DELETE FROM cuadrilla_entries WHERE id = $1", [req.params.id]);
  });
  res.status(204).end();
}));

// Editar un registro MANUAL de cuadrilla. Los automáticos son inmutables aquí:
// se corrigen desde el movimiento que los creó.
cuadrillaRouter.put("/entries/:id", asyncRoute(async (req, res) => {
  const body = z.object({
    work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    activity_id: z.string().uuid(),
    worker_name: z.string().optional().default(""),
    quantity: z.number().positive(),
    // Sin enviar = se conservan los del registro (clientes que no los conocen).
    ...sacoRecuperadoSchema
  }).parse(req.body);

  const current = await pool.query("SELECT origen, tunnel_number, saco_recuperado_id, destino_saco FROM cuadrilla_entries WHERE id = $1", [req.params.id]);
  if (!current.rowCount) throw new ApiError(404, "Registro no encontrado");
  if (current.rows[0].origen === "SECADORA" || current.rows[0].origen === "VENTA") {
    throw new ApiError(409, "Este registro es automático. Para modificarlo, corrija el movimiento de origen.");
  }
  const socioId = await reqCuadrillaSocioId(req);
  const activity = await getEffectiveActivityById(pool, body.activity_id, socioId, false);
  if (!activity) throw new ApiError(404, "Actividad no encontrada");
  const rate = Number(activity.unit_rate);
  const subtotal = round2(body.quantity * rate);

  const out = await inTransaction(async (client) => {
    const result = await client.query(
      `UPDATE cuadrilla_entries
       SET work_date = COALESCE($2::date, work_date),
           activity_id = $3, activity_name = $4, worker_name = $5,
           quantity = $6, unit_rate = $7, subtotal = $8
       WHERE id = $1 AND origen NOT IN ('SECADORA', 'VENTA')
       RETURNING id, work_date, activity_name, worker_name, quantity, unit_rate, subtotal, notes, origen, referencia_id, tunnel_number, momento`,
      [req.params.id, body.work_date ?? null, activity.id, activity.name, body.worker_name.trim(), body.quantity, rate, subtotal]
    );
    if (!result.rows[0]) return result.rows[0];
    // Sacos recuperados: se revierte lo que entró y se vuelve a registrar con la
    // cantidad / marca / destino actuales (o se quita si ya no es cambio de saco).
    await revertirSacosRecuperados(client, result.rows[0].id, "Reverso: se editó el registro de cambio de saco");
    const saco = await guardarSacoRecuperado(client, {
      id: result.rows[0].id, activityName: activity.name, cantidad: body.quantity, worker: body.worker_name.trim(),
      marcaId: body.marca_saco_recuperado !== undefined ? body.marca_saco_recuperado : current.rows[0].saco_recuperado_id,
      destino: body.destino_saco !== undefined ? body.destino_saco : current.rows[0].destino_saco
    });
    return { ...result.rows[0], ...(saco ?? {}) };
  });
  res.json(out);
}));

// ── Resumen por persona (total ganado, anticipos pendientes, neto) ──────────

cuadrillaRouter.get("/summary", asyncRoute(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const earned = await pool.query(
    `SELECT worker_name,
            COUNT(*)::int AS entradas,
            COALESCE(SUM(subtotal), 0)::float AS total,
            COALESCE(SUM(subtotal) FILTER (WHERE paid_at IS NULL), 0)::float AS pendiente,
            COALESCE(SUM(subtotal) FILTER (WHERE paid_at IS NOT NULL), 0)::float AS pagado,
            MIN(work_date) FILTER (WHERE paid_at IS NULL) AS oldest_pending,
            COUNT(*) FILTER (WHERE paid_at IS NULL)::int AS pending_count
     FROM cuadrilla_entries
     WHERE work_date BETWEEN $1 AND $2
       AND origen <> 'BASCULA' -- la bajada de carro se paga aparte, en un solo pago
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
    const pendiente = round2(Number(r.pendiente));
    return {
      worker_name: r.worker_name,
      entradas: r.entradas,
      total: round2(Number(r.total)),
      pagado: round2(Number(r.pagado)),
      oldest_pending: r.oldest_pending,
      pending_count: r.pending_count,
      anticipos: round2(pending),
      // Neto a pagar = lo aún NO pagado, menos los anticipos pendientes.
      neto: round2(Math.max(0, pendiente - pending))
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

// ── Pagar a una persona de la cuadrilla (liquida su neto del período) ────────
// Espeja a /labor/pay-worker: marca como pagados sus registros no pagados del
// rango, aplica los anticipos pendientes (más viejos primero) y saca de la caja
// SOLO el neto restante. Todo en una transacción. Los anticipos ya habían salido
// de caja al entregarse, por eso no se vuelven a cobrar aquí.
// Paga (o, con ejecutar=false, solo CALCULA) lo pendiente de UNA persona de la
// cuadrilla entre `from` y `to` (sin la bajada de carro, que se paga aparte).
// Lo comparten «Pagar» por persona y el cierre semanal. null = nada pendiente.
export async function pagarTrabajadorCuadrilla(
  client: PoolClient,
  p: { name: string; from: string; to: string; cashRegisterId: string; userId: string | null },
  ejecutar = true
): Promise<{ gross: number; anticipos: number; paid: number; count: number } | null> {
  const lock = ejecutar ? "FOR UPDATE" : "";
  const pending = await client.query(
    `SELECT id, subtotal FROM cuadrilla_entries
     WHERE worker_name = $1 AND paid_at IS NULL
       AND work_date BETWEEN $2 AND $3
       AND origen <> 'BASCULA' -- la bajada de carro se paga aparte
     ${lock}`,
    [p.name, p.from, p.to]
  );
  if (!pending.rowCount) return null;

  const gross = round2(pending.rows.reduce((s: number, r: { subtotal: string }) => s + Number(r.subtotal), 0));

  // Anticipos pendientes de la persona (no atados a fecha, igual que el resumen).
  // Se aplican del más viejo al más nuevo hasta agotar el bruto.
  const advResult = await client.query(
    `SELECT id, balance FROM cuadrilla_advances
     WHERE worker_name = $1 AND status IN ('PENDING', 'PARTIAL')
     ORDER BY issued_at ASC
     ${lock}`,
    [p.name]
  );
  let remaining = gross;
  let applied = 0;
  for (const adv of advResult.rows as Array<{ id: string; balance: string }>) {
    if (remaining <= 0.001) break;
    const bal = Number(adv.balance);
    const use = round2(Math.min(bal, remaining));
    if (use <= 0) continue;
    const newBal = round2(bal - use);
    if (ejecutar) {
      await client.query(
        `UPDATE cuadrilla_advances SET balance = $2, status = $3 WHERE id = $1`,
        [adv.id, newBal, newBal < 0.01 ? "PAID" : "PARTIAL"]
      );
    }
    applied = round2(applied + use);
    remaining = round2(remaining - use);
  }
  const net = round2(Math.max(0, gross - applied));
  const ids = pending.rows.map((r: { id: string }) => r.id);
  if (!ejecutar) return { gross, anticipos: applied, paid: net, count: ids.length };

  await client.query(
    `UPDATE cuadrilla_entries SET paid_at = now(), cash_register_id = $2 WHERE id = ANY($1)`,
    [ids, p.cashRegisterId]
  );
  if (net > 0) {
    await client.query(
      `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, amount, description, created_by)
       VALUES ($1, 'EXPENSE', 'PAGO_MANO_OBRA', 'cuadrilla_entries', $2, $3, $4)`,
      [p.cashRegisterId, net, `Pago cuadrilla ${p.name}`, p.userId]
    );
  }
  return { gross, anticipos: applied, paid: net, count: ids.length };
}

cuadrillaRouter.post("/pay-worker", asyncRoute(async (req, res) => {
  const body = z.object({
    worker_name: z.string().min(1),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cash_register_id: z.string().uuid()
  }).parse(req.body);
  const user = (req as AuthenticatedRequest).user;

  const result = await inTransaction(async (client) => {
    await exigirCajaAbiertaDelAccionista(client, body.cash_register_id, (req as AuthenticatedRequest).accionistaId);
    const r = await pagarTrabajadorCuadrilla(client, {
      name: body.worker_name, from: body.from, to: body.to,
      cashRegisterId: body.cash_register_id, userId: user?.id ?? null
    });
    if (!r) throw new ApiError(400, "No hay pagos pendientes de esta cuadrilla en el período");
    return r;
  });

  res.json(result);
}));

// ── Recibo (Rol de Pago) de una cuadrilla: lista sus registros pendientes ────
// Devuelve la MISMA forma que /labor/worker-receipt para reusar el modal del
// frontend. Por defecto solo lo pendiente (paid_at IS NULL).
cuadrillaRouter.get("/worker-receipt", asyncRoute(async (req, res) => {
  const q = z.object({
    worker_name: z.string().min(1),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(["pending", "paid", "all"]).optional().default("pending")
  }).parse(req.query);
  const from = q.from ?? "2000-01-01";
  const to = q.to ?? "2999-12-31";
  const paidCond = q.status === "pending" ? "AND paid_at IS NULL" : q.status === "paid" ? "AND paid_at IS NOT NULL" : "";

  const recs = await pool.query(
    `SELECT id, work_date::date AS fecha, activity_name,
            quantity::float AS qty, unit_rate::float AS rate, subtotal::float AS subtotal, paid_at
       FROM cuadrilla_entries
      WHERE worker_name = $1 AND work_date BETWEEN $2 AND $3 ${paidCond} AND origen <> 'BASCULA'
      ORDER BY work_date ASC, created_at ASC`,
    [q.worker_name, from, to]
  );

  const rows = recs.rows.map((r: Record<string, unknown>) => {
    const qty = Number(r.qty) || 0;
    const rate = Number(r.rate) || 0;
    return {
      fecha: r.fecha,
      concepto: (r.activity_name as string) || "Trabajo de cuadrilla",
      lote: null,
      cantidad: qty ? `${qty}` : "—",
      tarifa: rate ? `$${rate.toFixed(2)}/u` : "—",
      // Numéricos para el resguardo del frontend (unidad genérica para cuadrilla).
      cantidad_num: qty,
      tarifa_num: rate,
      unidad: "",
      subtotal: round2(Number(r.subtotal) || 0),
      status: r.paid_at ? "PAID" : "PENDING"
    };
  });

  const earned = round2(rows.reduce((s, r) => s + r.subtotal, 0));
  const adv = await pool.query(
    `SELECT COALESCE(SUM(balance), 0)::float total FROM cuadrilla_advances
      WHERE worker_name = $1 AND status IN ('PENDING', 'PARTIAL')`,
    [q.worker_name]
  );
  const advances = round2(Number(adv.rows[0].total));
  const net = round2(Math.max(0, earned - advances));

  res.json({
    worker: { role: "CUADRILLA", name: q.worker_name },
    range: { from, to },
    rows,
    totals: { earned, advances, net },
    rates: {}
  });
}));

// ════════════════════════════════════════════════════════════════════════════
// 🚚 BAJADA DE CARRO (descarga del camión en báscula)
// Cada ticket de báscula (modo principal, ya con 2º pesaje) paga QQ × tarifa de
// la actividad «BAJADA DE CARRO» a quien bajó el carro: el nombre llega de la
// app de báscula (`bajadaX`) o se pone a mano (`bajada_manual`; '__NO__' = no se
// paga). Se guarda como labor de CUADRILLA (origen 'BASCULA', una por ticket):
// así aparece en Nómina → Pagos con lo demás de esa persona, se paga por Caja
// y lo no pagado se acumula solo a la semana siguiente (sábado a viernes).
// Solo se tocan registros NO pagados; lo ya pagado nunca cambia.
// ════════════════════════════════════════════════════════════════════════════
const BAJADA_NO = "__NO__";
// Fecha del ticket: la que escribió la báscula (DD/MM/AAAA HH:MM) o, si falta,
// la de creación en la app (hora de Ecuador).
const FECHA_TICKET = `COALESCE(
  CASE WHEN t.raw_payload->>'fecha' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}'
       THEN to_date(split_part(t.raw_payload->>'fecha', ' ', 1), 'DD/MM/YYYY') END,
  (to_timestamp(t.mobile_created_at / 1000.0) AT TIME ZONE 'America/Guayaquil')::date)`;
const TICKET_ELEGIBLE = `lower(coalesce(t.raw_payload->>'modo', 'principal')) = 'principal'
  AND NOT coalesce(t.en_espera, false) AND coalesce(t.quintals, 0) > 0`;
// Sábado que abre la semana de pago de una fecha (getUTCDay: dom=0 … sáb=6).
const inicioSemana = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7));
  return d.toISOString().slice(0, 10);
};
const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// JOSÉ = JOSE = José: sin esto la misma persona quedaba como dos y se le pagaba por separado.
const normalizarTrabajador = canonico;

// «Roster» de nombres de la báscula: quién ha bajado carros (tickets) y a quién ya se le pagó.
// Un nombre con pagos previos cuenta como validado por una persona.
async function cargarRosterBajada(db: Pick<PoolClient, "query">) {
  const filas = (await db.query(
    `SELECT n AS nombre, COUNT(*)::int AS cuenta FROM (
       SELECT NULLIF(btrim(COALESCE(NULLIF(btrim(t.bajada_manual), ''), t.raw_payload->>'bajadaX')), '') AS n
         FROM mobile_synced_tickets t WHERE ${TICKET_ELEGIBLE}
     ) x WHERE n IS NOT NULL AND n <> '__NO__' GROUP BY n
     UNION ALL
     SELECT worker_name, 3 FROM cuadrilla_entries WHERE origen = 'BASCULA' AND paid_at IS NOT NULL GROUP BY worker_name`
  )).rows as Array<{ nombre: string; cuenta: number }>;
  return armarRoster(filas);
}

/** Tickets con nombre de la báscula dudoso (varias personas / nombre poco usual) aún por pagar. */
export async function contarNombresPorRevisar(db: Pick<PoolClient, "query">, hasta?: string | null): Promise<number> {
  const roster = await cargarRosterBajada(db);
  const filas = (await db.query(
    `SELECT t.raw_payload->>'bajadaX' AS nombre
       FROM mobile_synced_tickets t
       JOIN bajada_carro_config c ON c.id = 1
       LEFT JOIN cuadrilla_entries e ON e.origen = 'BASCULA' AND e.referencia_id = t.id
      WHERE ${TICKET_ELEGIBLE}
        AND ${FECHA_TICKET} >= COALESCE(c.desde, CURRENT_DATE)
        AND ($1::date IS NULL OR ${FECHA_TICKET} <= $1::date)
        AND e.paid_at IS NULL
        AND COALESCE(t.bajada_manual, '') = ''
        AND NULLIF(btrim(t.raw_payload->>'bajadaX'), '') IS NOT NULL`,
    [hasta ?? null]
  )).rows as Array<{ nombre: string }>;
  return filas.filter((f) => evaluarNombre(f.nombre, roster) !== null).length;
}
const fechaIso = (v: Date | string) => (typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10));

async function actividadBajada(db: Queryable) {
  const r = await db.query(
    `SELECT id, name, unit_rate::float AS unit_rate FROM cuadrilla_activities
      WHERE upper(btrim(name)) = 'BAJADA DE CARRO' ORDER BY is_active DESC, created_at ASC LIMIT 1`
  );
  return r.rows[0] as { id: string; name: string; unit_rate: number } | undefined;
}

export async function sincronizarBajadas(client: PoolClient): Promise<{ creados: number; actualizados: number; eliminados: number }> {
  const out = { creados: 0, actualizados: 0, eliminados: 0 };
  // Serializa sincronizaciones simultáneas (dos pantallas abiertas).
  await client.query("SELECT pg_advisory_xact_lock($1)", [71010]);
  const cfg = (await client.query("SELECT desde::text AS desde FROM bajada_carro_config WHERE id = 1")).rows[0];
  const act = await actividadBajada(client);
  if (!cfg?.desde || !act) return out;
  const tarifa = Number(act.unit_rate) || 0;

  const tickets = (await client.query(
    `SELECT t.id, t.quintals::float AS qq, t.farmer_name, t.raw_payload->>'numeroTicket' AS numero,
            t.raw_payload->>'placa' AS placa,
            COALESCE(NULLIF(btrim(t.bajada_manual), ''), NULLIF(btrim(t.raw_payload->>'bajadaX'), '')) AS trabajador,
            (${FECHA_TICKET})::text AS fecha
       FROM mobile_synced_tickets t
      WHERE ${TICKET_ELEGIBLE} AND ${FECHA_TICKET} >= $1::date`,
    [cfg.desde]
  )).rows as Array<{ id: string; qq: number; farmer_name: string | null; numero: string | null; placa: string | null; trabajador: string | null; fecha: string }>;

  const existentes = new Map<string, { id: string; paid_at: Date | null; worker_name: string; quantity: number; unit_rate: number; work_date: string }>();
  for (const e of (await client.query(
    `SELECT id, referencia_id, paid_at, worker_name, quantity::float AS quantity, unit_rate::float AS unit_rate, work_date::text AS work_date
       FROM cuadrilla_entries WHERE origen = 'BASCULA'`
  )).rows) existentes.set(String(e.referencia_id), e);

  const vistos = new Set<string>();
  for (const t of tickets) {
    vistos.add(t.id);
    const e = existentes.get(t.id);
    if (e?.paid_at) continue; // pagado: intocable
    const trabajador = t.trabajador === BAJADA_NO ? "" : normalizarTrabajador(t.trabajador);
    if (!trabajador) {
      if (e) { await client.query("DELETE FROM cuadrilla_entries WHERE id = $1 AND paid_at IS NULL", [e.id]); out.eliminados++; }
      continue;
    }
    const qq = Number(t.qq) || 0;
    const subtotal = round2(qq * tarifa);
    const fecha = fechaIso(t.fecha);
    const notas = `Bajada de carro · Ticket #${t.numero ?? "—"} · ${t.farmer_name ?? "—"}${t.placa ? ` · ${t.placa}` : ""}`;
    if (!e) {
      await client.query(
        `INSERT INTO cuadrilla_entries (work_date, activity_id, activity_name, worker_name, quantity, unit_rate, subtotal, notes, origen, referencia_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'BASCULA', $9)
         ON CONFLICT (referencia_id) WHERE origen = 'BASCULA' DO NOTHING`,
        [fecha, act.id, act.name, trabajador, qq, tarifa, subtotal, notas, t.id]
      );
      out.creados++;
    } else if (e.worker_name !== trabajador || Math.abs(e.quantity - qq) > 0.0005 || Math.abs(e.unit_rate - tarifa) > 0.00005 || e.work_date !== fecha) {
      await client.query(
        `UPDATE cuadrilla_entries SET worker_name = $2, quantity = $3, unit_rate = $4, subtotal = $5, work_date = $6, notes = $7
          WHERE id = $1 AND paid_at IS NULL`,
        [e.id, trabajador, qq, tarifa, subtotal, fecha, notas]
      );
      out.actualizados++;
    }
  }
  // Pendientes cuyo ticket ya no aplica (borrado en la báscula, volvió a espera
  // o quedó antes de la fecha de inicio): no se deben.
  for (const [ref, e] of existentes) {
    if (!vistos.has(ref) && !e.paid_at) {
      await client.query("DELETE FROM cuadrilla_entries WHERE id = $1 AND paid_at IS NULL", [e.id]);
      out.eliminados++;
    }
  }
  return out;
}

cuadrillaRouter.post("/bajadas/sync", asyncRoute(async (_req, res) => {
  res.json(await inTransaction((client) => sincronizarBajadas(client)));
}));

// Tickets de báscula del día `fecha` (AAAA-MM-DD, Ecuador): cuántos y cuántos QQ. Lo usa el resumen diario.
export async function resumenTicketsDelDia(db: Pick<PoolClient, "query">, fecha: string): Promise<{ n: number; qq: number }> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(t.quintals), 0)::float AS qq
       FROM mobile_synced_tickets t WHERE ${TICKET_ELEGIBLE} AND ${FECHA_TICKET} = $1::date`,
    [fecha]
  );
  return { n: Number(r.rows[0].n), qq: Number(r.rows[0].qq) };
}

// Tickets de báscula (desde «Contar desde», y hasta `hasta` si se da) que NO tienen
// quién bajó el carro ni están marcados «no se paga»: no entran a ningún pago.
export async function contarBajadasSinNombre(db: Pick<PoolClient, "query">, hasta?: string | null): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM mobile_synced_tickets t
       JOIN bajada_carro_config c ON c.id = 1
      WHERE ${TICKET_ELEGIBLE}
        AND ${FECHA_TICKET} >= COALESCE(c.desde, CURRENT_DATE)
        AND ($1::date IS NULL OR ${FECHA_TICKET} <= $1::date)
        AND COALESCE(t.bajada_manual, '') <> '__NO__'
        AND COALESCE(NULLIF(btrim(t.bajada_manual), ''), NULLIF(btrim(t.raw_payload->>'bajadaX'), '')) IS NULL`,
    [hasta ?? null]
  );
  return Number(r.rows[0].n);
}

// Semana de pago (sábado→viernes) que contiene `semana` (hoy por defecto): tickets
// con su monto y estado, y lo pendiente de semanas previas (se arrastra).
cuadrillaRouter.get("/bajadas", asyncRoute(async (req, res) => {
  // ?todo=1: en vez de una semana, TODOS los tickets desde «Contar desde» hasta hoy.
  const q = z.object({ semana: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), todo: z.enum(["0", "1"]).optional() }).parse(req.query);
  const hoy = (await pool.query("SELECT (now() AT TIME ZONE 'America/Guayaquil')::date::text AS d")).rows[0].d as string;
  await inTransaction((client) => sincronizarBajadas(client));

  const cfg = (await pool.query("SELECT desde::text AS desde FROM bajada_carro_config WHERE id = 1")).rows[0] ?? { desde: null };
  const modoTodo = q.todo === "1";
  const ini = modoTodo ? (cfg.desde && cfg.desde <= hoy ? cfg.desde : inicioSemana(hoy)) : inicioSemana(q.semana ?? hoy);
  const fin = modoTodo ? sumarDias(inicioSemana(hoy), 6) : sumarDias(ini, 6);
  const act = await actividadBajada(pool);
  const filas = (await pool.query(
    `SELECT t.id AS ticket_id, t.raw_payload->>'numeroTicket' AS numero, (${FECHA_TICKET})::text AS fecha,
            t.raw_payload->>'fecha' AS fecha_hora, t.farmer_name AS cliente, t.raw_payload->>'placa' AS placa,
            t.quintals::float AS qq, NULLIF(btrim(t.raw_payload->>'bajadaX'), '') AS bajada_bascula,
            NULLIF(btrim(t.bajada_manual), '') AS bajada_manual,
            e.id AS entry_id, e.worker_name AS trabajador, e.subtotal::float AS monto, e.unit_rate::float AS tarifa,
            e.paid_at
       FROM mobile_synced_tickets t
       LEFT JOIN cuadrilla_entries e ON e.origen = 'BASCULA' AND e.referencia_id = t.id
      WHERE ${TICKET_ELEGIBLE} AND ${FECHA_TICKET} BETWEEN $1::date AND $2::date
      ORDER BY ${FECHA_TICKET}, NULLIF(regexp_replace(coalesce(t.raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '')::bigint NULLS LAST`,
    [ini, fin]
  )).rows;
  const arrastre = (await pool.query(
    `SELECT worker_name AS trabajador, COUNT(*)::int AS tickets, COALESCE(SUM(subtotal), 0)::float AS monto
       FROM cuadrilla_entries WHERE origen = 'BASCULA' AND paid_at IS NULL AND work_date < $1::date
      GROUP BY worker_name ORDER BY worker_name`,
    [ini]
  )).rows;
  // Nombre dudoso: solo si lo escribió la báscula (uno corregido a mano ya está confirmado) y no está pagado.
  const roster = await cargarRosterBajada(pool);
  const filasConAviso = filas.map((f) => ({
    ...f,
    nombre_revisar: (!f.bajada_manual && !f.paid_at && f.bajada_bascula ? evaluarNombre(f.bajada_bascula, roster) : null) as Evaluacion | null
  }));
  res.json({
    semana: { inicio: ini, fin, actual: inicioSemana(hoy) === ini },
    modo: modoTodo ? "todo" : "semana",
    desde: cfg.desde,
    tarifa: act ? Number(act.unit_rate) : null,
    actividad: act?.name ?? null,
    filas: filasConAviso,
    por_revisar: filasConAviso.filter((f) => f.nombre_revisar).length,
    arrastre
  });
}));

// Poner / corregir a mano quién bajó el carro (o marcar que no se paga).
cuadrillaRouter.post("/bajadas/asignar", asyncRoute(async (req, res) => {
  const body = z.object({
    ticket_id: z.string().uuid(),
    trabajador: z.string().trim().max(60).nullable().optional(),
    no_se_paga: z.boolean().optional()
  }).parse(req.body);
  const valor = body.no_se_paga ? BAJADA_NO : (normalizarTrabajador(body.trabajador) || null);
  const out = await inTransaction(async (client) => {
    const pagado = await client.query(
      "SELECT 1 FROM cuadrilla_entries WHERE origen = 'BASCULA' AND referencia_id = $1 AND paid_at IS NOT NULL",
      [body.ticket_id]
    );
    if (pagado.rowCount) throw new ApiError(409, "Esta bajada ya se pagó; no se puede cambiar.");
    const r = await client.query("UPDATE mobile_synced_tickets SET bajada_manual = $2 WHERE id = $1 RETURNING id", [body.ticket_id, valor]);
    if (!r.rowCount) throw new ApiError(404, "Ticket no encontrado");
    return sincronizarBajadas(client);
  });
  res.json({ ok: true, ...out });
}));

// Desde qué fecha se cuentan las bajadas (lo anterior ya se pagó por fuera).
cuadrillaRouter.put("/bajadas/desde", requireAdmin, asyncRoute(async (req, res) => {
  const body = z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
  const user = (req as AuthenticatedRequest).user;
  const out = await inTransaction(async (client) => {
    await client.query(
      `INSERT INTO bajada_carro_config (id, desde, updated_at, updated_by) VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET desde = EXCLUDED.desde, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [body.desde, user?.id ?? null]
    );
    return sincronizarBajadas(client);
  });
  res.json({ ok: true, desde: body.desde, ...out });
}));

// ── Bajada de carro: se paga como UN SOLO pago (todas las personas juntas) ──
// El recibo sale desglosado: cuánto le toca a cada quien y sus tickets.
type DetalleBajada = { entry_id: string; fecha: string; trabajador: string; qq: number; tarifa: number; monto: number; numero: string | null; cliente: string | null; placa: string | null };
function resumirBajadas(det: DetalleBajada[]) {
  const porTrab = new Map<string, { trabajador: string; tickets: number; qq: number; monto: number }>();
  for (const d of det) {
    const t = porTrab.get(d.trabajador) ?? { trabajador: d.trabajador, tickets: 0, qq: 0, monto: 0 };
    t.tickets += 1; t.qq = round2(t.qq + d.qq); t.monto = round2(t.monto + d.monto);
    porTrab.set(d.trabajador, t);
  }
  const fechas = det.map((d) => d.fecha).sort();
  return {
    total: round2(det.reduce((a, d) => a + d.monto, 0)),
    tickets: det.length,
    desde: fechas[0] ?? null,
    hasta: fechas[fechas.length - 1] ?? null,
    por_trabajador: [...porTrab.values()].sort((a, b) => b.monto - a.monto),
    detalle: det
  };
}
async function detalleBajadas(db: Queryable, where: string, params: unknown[]) {
  return (await db.query(
    `SELECT e.id AS entry_id, e.work_date::text AS fecha, e.worker_name AS trabajador, e.quantity::float AS qq,
            e.unit_rate::float AS tarifa, e.subtotal::float AS monto,
            t.raw_payload->>'numeroTicket' AS numero, t.farmer_name AS cliente, t.raw_payload->>'placa' AS placa
       FROM cuadrilla_entries e
       LEFT JOIN mobile_synced_tickets t ON t.id = e.referencia_id
      WHERE e.origen = 'BASCULA' AND ${where}
      ORDER BY e.worker_name, e.work_date, e.created_at`,
    params
  )).rows as DetalleBajada[];
}

// Todo lo pendiente de bajada (cualquier semana: lo no pagado se arrastra).
// Con ?hasta=AAAA-MM-DD solo lo trabajado HASTA ese día (incluido): para pagar
// por corte y dejar lo posterior pendiente.
const FECHA_CORTE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
cuadrillaRouter.get("/bajadas/pendiente", asyncRoute(async (req, res) => {
  const { hasta } = z.object({ hasta: FECHA_CORTE }).parse(req.query);
  await inTransaction((client) => sincronizarBajadas(client));
  res.json(resumirBajadas(await detalleBajadas(pool, "e.paid_at IS NULL AND ($1::date IS NULL OR e.work_date <= $1::date)", [hasta ?? null])));
}));

// Recibo de un pago ya hecho (por la fecha/hora exacta del pago).
cuadrillaRouter.get("/bajadas/recibo", asyncRoute(async (req, res) => {
  const q = z.object({ paid_at: z.string().min(10) }).parse(req.query);
  res.json({ paid_at: q.paid_at, ...resumirBajadas(await detalleBajadas(pool, "date_trunc('milliseconds', e.paid_at) = date_trunc('milliseconds', $1::timestamptz)", [q.paid_at])) });
}));

// Paga la bajada pendiente en un solo egreso de Caja (mano de obra): toda, o solo
// hasta la fecha de corte `hasta` (incluida); lo posterior sigue pendiente. Con
// ejecutar=false solo CALCULA el resumen (no paga ni exige caja).
// null = no hay bajadas pendientes. Lo comparten la ruta y el cierre semanal.
export async function pagarBajadasPendientes(
  client: PoolClient,
  p: { cashRegisterId: string; hasta?: string | null; userId: string | null },
  ejecutar = true
) {
  await sincronizarBajadas(client);
  if (ejecutar) {
    const caja = await client.query("SELECT status FROM cash_registers WHERE id = $1", [p.cashRegisterId]);
    if (caja.rows[0]?.status !== "OPEN") throw new ApiError(409, "La caja no está abierta.");
  }
  const pendientes = await client.query(
    `SELECT id FROM cuadrilla_entries WHERE origen = 'BASCULA' AND paid_at IS NULL
        AND ($1::date IS NULL OR work_date <= $1::date) ${ejecutar ? "FOR UPDATE" : ""}`,
    [p.hasta ?? null]
  );
  if (!pendientes.rowCount) return null;
  const ids = pendientes.rows.map((r: { id: string }) => r.id);
  if (!ejecutar) return { paid_at: null as string | null, ...resumirBajadas(await detalleBajadas(client, "e.id = ANY($1)", [ids])) };
  const pagado = (await client.query(
    "UPDATE cuadrilla_entries SET paid_at = now(), cash_register_id = $2 WHERE id = ANY($1) RETURNING paid_at",
    [ids, p.cashRegisterId]
  )).rows[0].paid_at as Date;
  const resumen = resumirBajadas(await detalleBajadas(client, "e.id = ANY($1)", [ids]));
  if (resumen.total > 0) {
    const reparto = resumen.por_trabajador.map((t) => `${t.trabajador} $${t.monto.toFixed(2)}`).join(", ");
    await client.query(
      `INSERT INTO cash_movements
         (cash_register_id, movement, category, reference_type, amount, description, created_by)
       VALUES ($1, 'EXPENSE', 'PAGO_MANO_OBRA', 'cuadrilla_entries', $2, $3, $4)`,
      [p.cashRegisterId, resumen.total, `Pago bajada de carro · ${resumen.tickets} ticket(s): ${reparto}`.slice(0, 500), p.userId]
    );
  }
  return { paid_at: (pagado instanceof Date ? pagado.toISOString() : String(pagado)) as string | null, ...resumen };
}

cuadrillaRouter.post("/bajadas/pagar", asyncRoute(async (req, res) => {
  const body = z.object({ cash_register_id: z.string().uuid(), hasta: FECHA_CORTE }).parse(req.body);
  const user = (req as AuthenticatedRequest).user;
  const out = await inTransaction(async (client) => {
    await exigirCajaAbiertaDelAccionista(client, body.cash_register_id, (req as AuthenticatedRequest).accionistaId);
    const r = await pagarBajadasPendientes(client, { cashRegisterId: body.cash_register_id, hasta: body.hasta, userId: user?.id ?? null });
    if (!r) throw new ApiError(400, body.hasta ? "No hay bajadas de carro pendientes hasta esa fecha." : "No hay bajadas de carro pendientes de pago.");
    return r;
  });
  res.json(out);
}));
