import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { inTransaction } from "../../db/transaction.js";
import { pool } from "../../db/pool.js";
import { asyncRoute } from "../../http/async-route.js";
import { ApiError } from "../../http/error-handler.js";
import {
  createLotProcessReport,
  findStageReportId,
  linkLotProcessReports,
  type ProcessStage
} from "../../utils/process-reports.js";

export const processFlowRouter = Router();

const stageSchema = z.enum(["BASCULA", "SECADO", "TUNEL_1", "TUNEL_2", "TUNEL_3", "PILADO", "RENDIMIENTO", "VENTA"]);

const dryingBodySchema = z.object({
  lot_ids: z.array(z.string().uuid()).min(1),
  tunnel_number: z.number().int().min(1).max(3),
  rice_type: z.enum(["0.11", "CORRIENTE"]).default("0.11"),
  moisture_before: z.number().nonnegative().optional(),
  dry_start_at: z.string().optional(),
  dry_end_at: z.string().optional(),
  gas_used: z.number().nonnegative().default(0),
  diesel_used: z.number().nonnegative().default(0),
  dryer_name: z.string().optional(),
  operator_name: z.string().optional(),
  notes: z.string().optional(),
  created_by: z.string().uuid().optional()
});

const dryingUpdateSchema = z.object({
  rice_type: z.enum(["0.11", "CORRIENTE"]).default("0.11"),
  moisture_before: z.number().nonnegative().optional(),
  dry_start_at: z.string().optional(),
  dry_end_at: z.string().optional(),
  gas_used: z.number().nonnegative().default(0),
  diesel_used: z.number().nonnegative().default(0),
  dryer_name: z.string().optional(),
  operator_name: z.string().optional(),
  notes: z.string().optional()
});

processFlowRouter.get("/drying/available-lots", asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT l.*, f.full_name AS farmer_name,
            t.ticket_number, t.net_weight, t.qualification, t.quintals
     FROM lots l
     JOIN weighing_tickets t ON t.lot_id = l.id
     LEFT JOIN farmers f ON f.id = l.farmer_id
     WHERE t.quintals IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM drying_tunnel_report_lots used_lots
         WHERE used_lots.lot_id = l.id
       )
     ORDER BY l.created_at DESC
     LIMIT 500`
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

processFlowRouter.post("/lots/:lotId/drying", asyncRoute(async (req, res) => {
  const lotId = String(req.params.lotId);
  const legacyBody = z.object({
    tunnel_number: z.number().int().min(1).max(3),
    input_weight_kg: z.number().nonnegative().optional(),
    output_weight_kg: z.number().nonnegative().optional(),
    moisture_before: z.number().nonnegative().optional(),
    moisture_after: z.number().nonnegative().optional(),
    drying_hours: z.number().nonnegative().optional(),
    operator_name: z.string().optional(),
    notes: z.string().optional(),
    created_by: z.string().uuid().optional()
  }).parse(req.body);

  const result = await inTransaction((client) =>
    createDryingReport(client, {
      lot_ids: [lotId],
      tunnel_number: legacyBody.tunnel_number,
      rice_type: "0.11",
      moisture_before: legacyBody.moisture_before,
      gas_used: 0,
      diesel_used: 0,
      operator_name: legacyBody.operator_name,
      notes: legacyBody.notes,
      created_by: legacyBody.created_by
    })
  );

  res.status(201).json(result);
}));

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

async function createDryingReport(client: PoolClient, input: z.infer<typeof dryingBodySchema>) {
  const lotIds = [...new Set(input.lot_ids)];
  const selectedLots = await client.query(
    `SELECT l.id, l.lot_code, f.full_name AS farmer_name,
            COALESCE(t.net_weight, 0) AS net_weight_kg,
            COALESCE(t.quintals, 0) AS quintals,
            used_lots.lot_id AS used_lot_id
     FROM lots l
     JOIN weighing_tickets t ON t.lot_id = l.id
     LEFT JOIN farmers f ON f.id = l.farmer_id
     LEFT JOIN drying_tunnel_report_lots used_lots ON used_lots.lot_id = l.id
     WHERE l.id = ANY($1::uuid[])
     ORDER BY l.created_at ASC`,
    [lotIds]
  );

  if (selectedLots.rowCount !== lotIds.length) {
    throw new ApiError(404, "Uno o mas lotes no existen o aun no tienen ticket cerrado");
  }

  const alreadyUsed = selectedLots.rows.filter((lot) => lot.used_lot_id);
  if (alreadyUsed.length > 0) {
    throw new ApiError(409, `Lote ya usado en secado: ${alreadyUsed.map((lot) => lot.lot_code).join(", ")}`);
  }

  const totalNetKg = selectedLots.rows.reduce((sum, lot) => sum + Number(lot.net_weight_kg), 0);
  const totalQuintals = selectedLots.rows.reduce((sum, lot) => sum + Number(lot.quintals), 0);
  const primaryLotId = selectedLots.rows[0].id as string;
  const dryingHours = calculateDryingHours(input.dry_start_at, input.dry_end_at);
  const status = input.dry_end_at ? "COMPLETED" : "IN_PROGRESS";
  const lotSnapshot = selectedLots.rows.map((lot) => ({
    lot_id: lot.id,
    lot_code: lot.lot_code,
    farmer_name: lot.farmer_name,
    net_weight_kg: Number(lot.net_weight_kg),
    quintals: Number(lot.quintals)
  }));

  const tunnelReports: Array<{ lotId: string; reportId: string }> = [];
  for (const lot of selectedLots.rows) {
    let dryingReportId = await findStageReportId(client, lot.id, "SECADO");
    if (!dryingReportId) {
      const dryingReport = await createLotProcessReport(client, {
        lotId: lot.id,
        stage: "SECADO",
        title: "Informe general de secado",
        data: {
          tunnel_count: 3,
          flow: "Bascula -> Secado -> Tuneles"
        },
        createdBy: input.created_by
      });
      dryingReportId = dryingReport.id;
    }

    const tunnelStage = `TUNEL_${input.tunnel_number}` as ProcessStage;
    const tunnelReport = await createLotProcessReport(client, {
      lotId: lot.id,
      stage: tunnelStage,
      title: `Informe Tunel ${input.tunnel_number}`,
      referenceType: "drying_tunnel_reports",
      data: dryingReportData(input, totalNetKg, totalQuintals, dryingHours, status, lotSnapshot),
      notes: input.notes,
      createdBy: input.created_by,
      parentReportId: dryingReportId,
      linkType: "DRYING_BRANCH"
    });

    tunnelReports.push({ lotId: lot.id, reportId: tunnelReport.id });
  }

  const tunnel = await client.query(
    `INSERT INTO drying_tunnel_reports
     (lot_id, process_report_id, tunnel_number, rice_type, input_weight_kg, total_quintals, output_weight_kg,
      moisture_before, drying_hours, dry_start_at, dry_end_at, gas_used, diesel_used,
      dryer_name, status, operator_name, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      primaryLotId,
      tunnelReports[0].reportId,
      input.tunnel_number,
      input.rice_type,
      totalNetKg,
      totalQuintals,
      input.moisture_before ?? null,
      dryingHours,
      input.dry_start_at ?? null,
      input.dry_end_at ?? null,
      input.gas_used,
      input.diesel_used,
      input.dryer_name ?? null,
      status,
      input.operator_name ?? null,
      input.notes ?? null,
      input.created_by ?? null
    ]
  );

  for (const lot of selectedLots.rows) {
    const reportId = tunnelReports.find((report) => report.lotId === lot.id)?.reportId ?? null;
    await client.query(
      `INSERT INTO drying_tunnel_report_lots
       (drying_report_id, lot_id, process_report_id, lot_code, farmer_name, net_weight_kg, quintals)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tunnel.rows[0].id,
        lot.id,
        reportId,
        lot.lot_code,
        lot.farmer_name,
        lot.net_weight_kg,
        lot.quintals
      ]
    );
  }

  await client.query(
    `UPDATE lot_process_reports
     SET reference_id = $1,
         report_data = report_data || $2::jsonb
     WHERE id = ANY($3::uuid[])`,
    [
      tunnel.rows[0].id,
      JSON.stringify({ drying_report_id: tunnel.rows[0].id }),
      tunnelReports.map((report) => report.reportId)
    ]
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

  const updated = await client.query(
    `UPDATE drying_tunnel_reports
     SET moisture_before = $2,
         rice_type = $3,
         drying_hours = $4,
         dry_start_at = $5,
         dry_end_at = $6,
         gas_used = $7,
         diesel_used = $8,
         dryer_name = $9,
         status = $10,
         operator_name = $11,
         notes = $12
     WHERE id = $1
     RETURNING *`,
    [
      dryingId,
      input.moisture_before ?? current.rows[0].moisture_before,
      input.rice_type,
      dryingHours,
      dryStartAt,
      dryEndAt,
      input.gas_used,
      input.diesel_used,
      input.dryer_name ?? current.rows[0].dryer_name,
      status,
      input.operator_name ?? current.rows[0].operator_name,
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
    dry_start_at: input.dry_start_at,
    dry_end_at: input.dry_end_at,
    gas_used: input.gas_used,
    diesel_used: input.diesel_used,
    dryer_name: input.dryer_name,
    operator_name: input.operator_name,
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
