import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { inTransaction } from "../../db/transaction.js";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import { nextCode } from "../../utils/codes.js";
import type { AuthenticatedRequest } from "../../auth/require-auth.js";
import {
  createLotProcessReport,
  findStageReportId,
  linkLotProcessReports,
  type ProcessStage
} from "../../utils/process-reports.js";

export const processFlowRouter = Router();

const stageSchema = z.enum(["BASCULA", "SECADO", "TUNEL_1", "TUNEL_2", "TUNEL_3", "PILADO", "RENDIMIENTO", "VENTA"]);

const dryingBodySchema = z.object({
  // Ingresos de materia prima (pesajes de báscula) que forman el lote.
  entry_ids: z.array(z.string().uuid()).min(1),
  // Código del lote: se propone automático, pero se puede escribir otro.
  lot_code: z.string().optional(),
  tunnel_number: z.number().int().min(1).max(3),
  rice_type: z.enum(["0.11", "CORRIENTE"]).default("0.11"),
  moisture_before: z.number().nonnegative().optional(),
  filled_at: z.string().optional(),
  dry_start_at: z.string().optional(),
  dry_end_at: z.string().optional(),
  // Gas: se puede usar bombona (por medidor), cilindro (por unidades) o ambos.
  gas_bombona_inicio: z.number().nonnegative().default(0),
  gas_bombona_fin: z.number().nonnegative().default(0),
  gas_cilindro_cantidad: z.number().nonnegative().default(0),
  diesel_used: z.number().nonnegative().default(0),
  dryer_name: z.string().optional(),
  notes: z.string().optional(),
  created_by: z.string().uuid().optional()
});

const dryingUpdateSchema = z.object({
  rice_type: z.enum(["0.11", "CORRIENTE"]).default("0.11"),
  moisture_before: z.number().nonnegative().optional(),
  filled_at: z.string().optional(),
  dry_start_at: z.string().optional(),
  dry_end_at: z.string().optional(),
  gas_bombona_inicio: z.number().nonnegative().default(0),
  gas_bombona_fin: z.number().nonnegative().default(0),
  gas_cilindro_cantidad: z.number().nonnegative().default(0),
  diesel_used: z.number().nonnegative().default(0),
  dryer_name: z.string().optional(),
  notes: z.string().optional()
});

/** Calcula el gas del secado con los precios fijos de Configuración → Tarifas. */
async function calcularGas(
  client: PoolClient,
  input: { gas_bombona_inicio: number; gas_bombona_fin: number; gas_cilindro_cantidad: number }
) {
  const r = await client.query(
    "SELECT COALESCE(precio_gas_bombona,0) bombona, COALESCE(precio_gas_cilindro,0) cilindro FROM labor_rates WHERE id = 1"
  );
  const precioBombona = Number(r.rows[0]?.bombona ?? 0);
  const precioCilindro = Number(r.rows[0]?.cilindro ?? 0);

  // Bombona: lo consumido es la diferencia del medidor (nunca negativo).
  const bombonaTotal = Math.max(0, Number(input.gas_bombona_fin) - Number(input.gas_bombona_inicio));
  const bombonaCosto = Math.round(bombonaTotal * precioBombona * 100) / 100;
  const cilindroCosto = Math.round(Number(input.gas_cilindro_cantidad) * precioCilindro * 100) / 100;

  return {
    precioBombona,
    precioCilindro,
    bombonaTotal,
    bombonaCosto,
    cilindroCosto,
    // El gas total del secado es la suma de lo que se haya usado.
    costoTotal: Math.round((bombonaCosto + cilindroCosto) * 100) / 100,
    gasUsado: bombonaTotal + Number(input.gas_cilindro_cantidad)
  };
}

// Ingresos de materia prima disponibles para formar un lote en la secadora:
// pesajes del accionista activo que todavía no pertenecen a ningún lote.
processFlowRouter.get("/drying/available-lots", asyncRoute(async (req, res) => {
  const accionistaId = (req as AuthenticatedRequest).accionistaId;
  const result = await pool.query(
    `SELECT w.id, w.ticket_number, w.rice_type, w.is_maquila, w.accionista_id,
            w.net_weight, w.qualification, w.quintals, w.created_at,
            f.full_name AS farmer_name,
            -- Número que ve el usuario: el del ticket de la app de báscula.
            m.raw_payload->>'numeroTicket' AS numero_bascula
     FROM weighing_tickets w
     LEFT JOIN farmers f ON f.id = w.farmer_id
     LEFT JOIN mobile_synced_tickets m ON m.weighing_ticket_id = w.id
     WHERE w.quintals IS NOT NULL AND w.quintals > 0
       AND w.lot_id IS NULL
       AND w.accionista_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM drying_tunnel_report_lots used
         WHERE used.weighing_ticket_id = w.id
       )
     ORDER BY w.created_at DESC
     LIMIT 500`,
    [accionistaId]
  );
  res.json(result.rows);
}));

processFlowRouter.get("/drying/reports", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT d.*,
            EXISTS (
              SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id
            ) AS is_processed,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'lot_id', dl.lot_id,
                  'lot_code', dl.lot_code,
                  'farmer_name', dl.farmer_name,
                  'net_weight_kg', dl.net_weight_kg,
                  'quintals', dl.quintals
                )
                ORDER BY dl.created_at ASC
              ) FILTER (WHERE dl.lot_id IS NOT NULL),
              '[]'::jsonb
            ) AS lots
     FROM drying_tunnel_reports d
     LEFT JOIN drying_tunnel_report_lots dl ON dl.drying_report_id = d.id
     GROUP BY d.id
     ORDER BY d.created_at DESC
     LIMIT 100`
  );
  res.json(result.rows);
}));

processFlowRouter.post("/drying", asyncRoute(async (req, res) => {
  const body = dryingBodySchema.parse(req.body);
  const result = await inTransaction((client) => createDryingReport(client, body));
  res.status(201).json(result);
}));

processFlowRouter.put("/drying/:dryingId", asyncRoute(async (req, res) => {
  const dryingId = String(req.params.dryingId);
  const body = dryingUpdateSchema.parse(req.body);
  const result = await inTransaction((client) => updateDryingReport(client, dryingId, body));
  res.json(result);
}));

processFlowRouter.get("/lots/:lotId", asyncRoute(async (req, res) => {
  const lotId = String(req.params.lotId);
  const lot = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name
     FROM lots l
     LEFT JOIN farmers f ON f.id = l.farmer_id
     WHERE l.id = $1`,
    [lotId]
  );
  if (!lot.rowCount) throw new ApiError(404, "Lote no encontrado");

  const [reports, links, tunnels] = await Promise.all([
    pool.query(
      `SELECT *
       FROM lot_process_reports
      WHERE lot_id = $1
      ORDER BY sequence ASC, created_at ASC`,
      [lotId]
    ),
    pool.query(
      `SELECT l.*
       FROM lot_process_report_links l
       JOIN lot_process_reports r ON r.id = l.from_report_id
       WHERE r.lot_id = $1
       ORDER BY l.created_at ASC`,
      [lotId]
    ),
    pool.query(
      `SELECT d.*,
              EXISTS (
                SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id
              ) AS is_processed,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'lot_id', dl.lot_id,
                    'lot_code', dl.lot_code,
                    'farmer_name', dl.farmer_name,
                    'net_weight_kg', dl.net_weight_kg,
                    'quintals', dl.quintals
                  )
                  ORDER BY dl.created_at ASC
                ) FILTER (WHERE dl.lot_id IS NOT NULL),
                '[]'::jsonb
              ) AS lots
       FROM drying_tunnel_reports d
       LEFT JOIN drying_tunnel_report_lots dl ON dl.drying_report_id = d.id
       WHERE d.lot_id = $1
          OR EXISTS (
            SELECT 1
            FROM drying_tunnel_report_lots lot_link
            WHERE lot_link.drying_report_id = d.id
              AND lot_link.lot_id = $1
          )
       GROUP BY d.id
       ORDER BY d.tunnel_number ASC, d.created_at ASC`,
      [lotId]
    )
  ]);

  res.json({
    lot: lot.rows[0],
    reports: reports.rows,
    links: links.rows,
    tunnels: tunnels.rows
  });
}));

processFlowRouter.post("/lots/:lotId/reports", asyncRoute(async (req, res) => {
  const lotId = String(req.params.lotId);
  const body = z.object({
    stage: stageSchema,
    title: z.string().min(2),
    reference_type: z.string().optional(),
    reference_id: z.string().uuid().optional(),
    report_data: z.record(z.unknown()).default({}),
    notes: z.string().optional(),
    parent_report_id: z.string().uuid().nullable().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction(async (client) => {
    await assertLotExists(client, lotId);
    return createLotProcessReport(client, {
      lotId,
      stage: body.stage as ProcessStage,
      title: body.title,
      referenceType: body.reference_type,
      referenceId: body.reference_id,
      data: body.report_data,
      notes: body.notes,
      createdBy: body.created_by,
      parentReportId: body.parent_report_id
    });
  });

  res.status(201).json(result);
}));

// (Se eliminó POST /lots/:lotId/drying: en el modelo actual el lote no existe
// antes del secado, se forma justamente al agrupar los ingresos en el túnel.)

processFlowRouter.post("/lots/:lotId/link", asyncRoute(async (req, res) => {
  const lotId = String(req.params.lotId);
  const body = z.object({
    from_report_id: z.string().uuid(),
    to_report_id: z.string().uuid(),
    link_type: z.string().default("NEXT")
  }).parse(req.body);

  await inTransaction(async (client) => {
    await assertLotExists(client, lotId);
    await linkLotProcessReports(client, body.from_report_id, body.to_report_id, body.link_type);
  });

  res.status(201).json({ ok: true });
}));

// Aquí NACE el lote: se agrupan varios ingresos de materia prima (pesajes de
// báscula) en un túnel, y ese grupo es el lote. De aquí en adelante el proceso
// (pilado, inventario, liquidación) trabaja con el lote.
async function createDryingReport(client: PoolClient, input: z.infer<typeof dryingBodySchema>) {
  const entryIds = [...new Set(input.entry_ids)];
  const entries = await client.query(
    `SELECT w.id, w.ticket_number, w.farmer_id, w.is_maquila, w.accionista_id, w.lot_id,
            COALESCE(w.net_weight, 0) AS net_weight_kg,
            COALESCE(w.quintals, 0) AS quintals,
            f.full_name AS farmer_name,
            m.raw_payload->>'numeroTicket' AS numero_bascula,
            used.id AS used_id
     FROM weighing_tickets w
     LEFT JOIN farmers f ON f.id = w.farmer_id
     LEFT JOIN mobile_synced_tickets m ON m.weighing_ticket_id = w.id
     LEFT JOIN drying_tunnel_report_lots used ON used.weighing_ticket_id = w.id
     WHERE w.id = ANY($1::uuid[])
     ORDER BY w.created_at ASC`,
    [entryIds]
  );

  if (entries.rowCount !== entryIds.length) {
    throw new ApiError(404, "Uno o más ingresos de materia prima no existen");
  }
  const yaUsados = entries.rows.filter((e) => e.used_id || e.lot_id);
  if (yaUsados.length > 0) {
    throw new ApiError(409, `Estos ingresos ya están en un lote: ${yaUsados.map((e) => e.ticket_number).join(", ")}`);
  }

  // Un lote no puede mezclar accionistas ni compra con servicio de pilado.
  if (new Set(entries.rows.map((e) => e.accionista_id)).size > 1) {
    throw new ApiError(400, "No se puede formar un lote con ingresos de accionistas distintos.");
  }
  if (new Set(entries.rows.map((e) => e.is_maquila)).size > 1) {
    throw new ApiError(400, "No se puede mezclar compra propia y servicio de pilado en el mismo lote.");
  }

  const isMaquila = Boolean(entries.rows[0].is_maquila);
  const lotAccionista = entries.rows[0].accionista_id as string | null;
  const farmerIds = new Set(entries.rows.map((e) => e.farmer_id));
  // Si el lote junta arroz de varios agricultores, no tiene un dueño único.
  const lotFarmerId = farmerIds.size === 1 ? entries.rows[0].farmer_id : null;

  const totalNetKg = entries.rows.reduce((sum, e) => sum + Number(e.net_weight_kg), 0);
  const totalQuintals = entries.rows.reduce((sum, e) => sum + Number(e.quintals), 0);
  const dryingHours = calculateDryingHours(input.dry_start_at, input.dry_end_at);
  const status = input.dry_end_at ? "COMPLETED" : "IN_PROGRESS";

  // El código del lote se propone automático, pero se puede escribir otro.
  const lotCode = (input.lot_code ?? "").trim() || nextCode("LT");
  const dup = await client.query("SELECT 1 FROM lots WHERE lot_code = $1", [lotCode]);
  if (dup.rowCount) throw new ApiError(409, `Ya existe un lote con el código "${lotCode}".`);

  const lot = await client.query(
    `INSERT INTO lots (lot_code, print_batch_code, farmer_id, rice_type, ownership, is_maquila, status, notes, accionista_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'WEIGHED', $7, $8)
     RETURNING *`,
    [
      lotCode, nextCode("IMP"), lotFarmerId, input.rice_type,
      isMaquila ? "MAQUILA" : "OWNED", isMaquila,
      `Lote formado en túnel ${input.tunnel_number} con ${entries.rowCount} ingreso(s) de materia prima`,
      lotAccionista
    ]
  );
  const lotId = lot.rows[0].id as string;

  // Los ingresos (y el inventario que generaron) pasan a pertenecer al lote.
  await client.query("UPDATE weighing_tickets SET lot_id = $1 WHERE id = ANY($2::uuid[])", [lotId, entryIds]);
  await client.query(
    `UPDATE inventory_movements SET lot_id = $1
     WHERE reference_type = 'weighing_tickets' AND reference_id = ANY($2::uuid[]) AND lot_id IS NULL`,
    [lotId, entryIds]
  );

  // En los informes se muestra el número del ticket de la báscula (el que
  // conoce el usuario), no el código interno del ingreso.
  const etiqueta = (e: { numero_bascula: string | null; ticket_number: string }) =>
    e.numero_bascula ? `Ticket #${e.numero_bascula}` : e.ticket_number;

  const lotSnapshot = entries.rows.map((e) => ({
    weighing_ticket_id: e.id,
    ticket_number: etiqueta(e),
    numero_bascula: e.numero_bascula,
    farmer_name: e.farmer_name,
    net_weight_kg: Number(e.net_weight_kg),
    quintals: Number(e.quintals)
  }));

  const dryingReport = await createLotProcessReport(client, {
    lotId,
    stage: "SECADO",
    title: "Informe general de secado",
    data: { tunnel_count: 3, flow: "Materia prima -> Secado -> Tuneles" },
    createdBy: input.created_by
  });

  const tunnelStage = `TUNEL_${input.tunnel_number}` as ProcessStage;
  const tunnelReport = await createLotProcessReport(client, {
    lotId,
    stage: tunnelStage,
    title: `Informe Tunel ${input.tunnel_number}`,
    referenceType: "drying_tunnel_reports",
    data: dryingReportData(input, totalNetKg, totalQuintals, dryingHours, status, lotSnapshot),
    notes: input.notes,
    createdBy: input.created_by,
    parentReportId: dryingReport.id,
    linkType: "DRYING_BRANCH"
  });

  const gas = await calcularGas(client, input);

  const tunnel = await client.query(
    `INSERT INTO drying_tunnel_reports
     (lot_id, process_report_id, tunnel_number, rice_type, input_weight_kg, total_quintals, output_weight_kg,
      moisture_before, drying_hours, filled_at, dry_start_at, dry_end_at, gas_used, diesel_used,
      gas_bombona_inicio, gas_bombona_fin, gas_bombona_precio, gas_bombona_costo,
      gas_cilindro_cantidad, gas_cilindro_precio, gas_cilindro_costo, gas_costo_total,
      dryer_name, status, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
     RETURNING *`,
    [
      lotId,
      tunnelReport.id,
      input.tunnel_number,
      input.rice_type,
      totalNetKg,
      totalQuintals,
      input.moisture_before ?? null,
      dryingHours,
      input.filled_at ?? null,
      input.dry_start_at ?? null,
      input.dry_end_at ?? null,
      gas.gasUsado,
      input.diesel_used,
      input.gas_bombona_inicio,
      input.gas_bombona_fin,
      gas.precioBombona,
      gas.bombonaCosto,
      input.gas_cilindro_cantidad,
      gas.precioCilindro,
      gas.cilindroCosto,
      gas.costoTotal,
      input.dryer_name ?? null,
      status,
      input.notes ?? null,
      input.created_by ?? null
    ]
  );

  // Los miembros del grupo son los ingresos de materia prima.
  for (const e of entries.rows) {
    await client.query(
      `INSERT INTO drying_tunnel_report_lots
       (drying_report_id, weighing_ticket_id, lot_id, process_report_id, lot_code, farmer_name, net_weight_kg, quintals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tunnel.rows[0].id, e.id, lotId, tunnelReport.id, etiqueta(e), e.farmer_name, e.net_weight_kg, e.quintals]
    );
  }

  await client.query(
    `UPDATE lot_process_reports
     SET reference_id = $1,
         report_data = report_data || $2::jsonb
     WHERE id = $3`,
    [tunnel.rows[0].id, JSON.stringify({ drying_report_id: tunnel.rows[0].id }), tunnelReport.id]
  );

  return getDryingReportById(client, tunnel.rows[0].id);
}

async function updateDryingReport(
  client: PoolClient,
  dryingId: string,
  input: z.infer<typeof dryingUpdateSchema>
) {
  const current = await client.query(
    "SELECT * FROM drying_tunnel_reports WHERE id = $1",
    [dryingId]
  );
  if (!current.rowCount) throw new ApiError(404, "Informe de secado no encontrado");

  const dryStartAt = input.dry_start_at ?? current.rows[0].dry_start_at;
  const dryEndAt = input.dry_end_at ?? current.rows[0].dry_end_at;
  const dryingHours = calculateDryingHours(dryStartAt, dryEndAt);
  const status = dryEndAt ? "COMPLETED" : "IN_PROGRESS";

  const gas = await calcularGas(client, input);

  const updated = await client.query(
    `UPDATE drying_tunnel_reports
     SET moisture_before = $2,
         rice_type = $3,
         drying_hours = $4,
         filled_at = $5,
         dry_start_at = $6,
         dry_end_at = $7,
         gas_used = $8,
         diesel_used = $9,
         gas_bombona_inicio = $10,
         gas_bombona_fin = $11,
         gas_bombona_precio = $12,
         gas_bombona_costo = $13,
         gas_cilindro_cantidad = $14,
         gas_cilindro_precio = $15,
         gas_cilindro_costo = $16,
         gas_costo_total = $17,
         dryer_name = $18,
         status = $19,
         notes = $20
     WHERE id = $1
     RETURNING *`,
    [
      dryingId,
      input.moisture_before ?? current.rows[0].moisture_before,
      input.rice_type,
      dryingHours,
      input.filled_at ?? current.rows[0].filled_at,
      dryStartAt,
      dryEndAt,
      gas.gasUsado,
      input.diesel_used,
      input.gas_bombona_inicio,
      input.gas_bombona_fin,
      gas.precioBombona,
      gas.bombonaCosto,
      input.gas_cilindro_cantidad,
      gas.precioCilindro,
      gas.cilindroCosto,
      gas.costoTotal,
      input.dryer_name ?? current.rows[0].dryer_name,
      status,
      input.notes ?? current.rows[0].notes
    ]
  );

  const reportIds = await client.query(
    `SELECT process_report_id
     FROM drying_tunnel_report_lots
     WHERE drying_report_id = $1
       AND process_report_id IS NOT NULL`,
    [dryingId]
  );
  const ids = reportIds.rows.map((row) => row.process_report_id);
  if (ids.length > 0) {
    await client.query(
      `UPDATE lot_process_reports
       SET report_data = report_data || $2::jsonb,
           notes = $3
       WHERE id = ANY($1::uuid[])`,
      [
        ids,
        JSON.stringify({
          moisture_before: updated.rows[0].moisture_before,
          rice_type: updated.rows[0].rice_type,
          drying_hours: updated.rows[0].drying_hours,
          dry_start_at: updated.rows[0].dry_start_at,
          dry_end_at: updated.rows[0].dry_end_at,
          gas_used: updated.rows[0].gas_used,
          diesel_used: updated.rows[0].diesel_used,
          dryer_name: updated.rows[0].dryer_name,
          status: updated.rows[0].status
        }),
        updated.rows[0].notes
      ]
    );
  }

  return getDryingReportById(client, dryingId);
}

async function getDryingReportById(client: PoolClient, dryingId: string) {
  const result = await client.query(
    `SELECT d.*,
            EXISTS (
              SELECT 1 FROM processing_batches b WHERE b.drying_report_id = d.id
            ) AS is_processed,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'lot_id', dl.lot_id,
                  'lot_code', dl.lot_code,
                  'farmer_name', dl.farmer_name,
                  'net_weight_kg', dl.net_weight_kg,
                  'quintals', dl.quintals
                )
                ORDER BY dl.created_at ASC
              ) FILTER (WHERE dl.lot_id IS NOT NULL),
              '[]'::jsonb
            ) AS lots
     FROM drying_tunnel_reports d
     LEFT JOIN drying_tunnel_report_lots dl ON dl.drying_report_id = d.id
     WHERE d.id = $1
     GROUP BY d.id`,
    [dryingId]
  );
  return result.rows[0];
}

function dryingReportData(
  input: z.infer<typeof dryingBodySchema>,
  totalNetKg: number,
  totalQuintals: number,
  dryingHours: number | null,
  status: string,
  lots: Array<Record<string, unknown>>
) {
  return {
    tunnel_number: input.tunnel_number,
    rice_type: input.rice_type,
    total_weight_kg: totalNetKg,
    total_quintals: totalQuintals,
    moisture_before: input.moisture_before,
    drying_hours: dryingHours,
    filled_at: input.filled_at,
    dry_start_at: input.dry_start_at,
    dry_end_at: input.dry_end_at,
    gas_bombona_inicio: input.gas_bombona_inicio,
    gas_bombona_fin: input.gas_bombona_fin,
    gas_cilindro_cantidad: input.gas_cilindro_cantidad,
    diesel_used: input.diesel_used,
    dryer_name: input.dryer_name,
    status,
    lots
  };
}

function calculateDryingHours(start?: string | Date | null, end?: string | Date | null) {
  if (!start || !end) return null;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) return null;
  return Number(((endTime - startTime) / 3_600_000).toFixed(2));
}

async function assertLotExists(client: PoolClient, lotId: string) {
  const lot = await client.query("SELECT id FROM lots WHERE id = $1", [lotId]);
  if (!lot.rowCount) throw new ApiError(404, "Lote no encontrado");
}
