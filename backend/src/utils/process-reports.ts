import type { PoolClient } from "pg";

export type ProcessStage =
  | "BASCULA"
  | "SECADO"
  | "TUNEL_1"
  | "TUNEL_2"
  | "TUNEL_3"
  | "PILADO"
  | "RENDIMIENTO"
  | "VENTA";

type CreateReportInput = {
  lotId: string;
  stage: ProcessStage;
  title: string;
  referenceType?: string;
  referenceId?: string;
  data?: Record<string, unknown>;
  notes?: string;
  createdBy?: string;
  parentReportId?: string | null;
  linkType?: string;
};

export async function createLotProcessReport(client: PoolClient, input: CreateReportInput) {
  const nextSequence = await client.query(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM lot_process_reports WHERE lot_id = $1",
    [input.lotId]
  );

  const report = await client.query(
    `INSERT INTO lot_process_reports
     (lot_id, stage, sequence, reference_type, reference_id, report_title, report_data, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     RETURNING *`,
    [
      input.lotId,
      input.stage,
      Number(nextSequence.rows[0].next_sequence),
      input.referenceType ?? null,
      input.referenceId ?? null,
      input.title,
      JSON.stringify(input.data ?? {}),
      input.notes ?? null,
      input.createdBy ?? null
    ]
  );

  const parentReportId = input.parentReportId === undefined
    ? await findLatestPreviousReportId(client, input.lotId, report.rows[0].id)
    : input.parentReportId;

  if (parentReportId) {
    await linkLotProcessReports(client, parentReportId, report.rows[0].id, input.linkType ?? "NEXT");
  }

  return report.rows[0];
}

export async function linkLotProcessReports(
  client: PoolClient,
  fromReportId: string,
  toReportId: string,
  linkType = "NEXT"
) {
  await client.query(
    `INSERT INTO lot_process_report_links (from_report_id, to_report_id, link_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (from_report_id, to_report_id) DO UPDATE SET link_type = EXCLUDED.link_type`,
    [fromReportId, toReportId, linkType]
  );
}

export async function findStageReportId(client: PoolClient, lotId: string, stage: ProcessStage) {
  const result = await client.query(
    `SELECT id
     FROM lot_process_reports
     WHERE lot_id = $1 AND stage = $2
     ORDER BY sequence DESC
     LIMIT 1`,
    [lotId, stage]
  );
  return result.rows[0]?.id as string | undefined;
}

async function findLatestPreviousReportId(client: PoolClient, lotId: string, excludedReportId: string) {
  const result = await client.query(
    `SELECT id
     FROM lot_process_reports
     WHERE lot_id = $1 AND id <> $2
     ORDER BY sequence DESC
     LIMIT 1`,
    [lotId, excludedReportId]
  );
  return result.rows[0]?.id as string | undefined;
}
