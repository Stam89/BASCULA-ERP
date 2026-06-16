ALTER TABLE drying_tunnel_reports
  ADD COLUMN IF NOT EXISTS total_quintals NUMERIC(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dry_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dry_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gas_used NUMERIC(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS diesel_used NUMERIC(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dryer_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drying_consumption_non_negative'
  ) THEN
    ALTER TABLE drying_tunnel_reports
      ADD CONSTRAINT drying_consumption_non_negative CHECK (gas_used >= 0 AND diesel_used >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drying_status_valid'
  ) THEN
    ALTER TABLE drying_tunnel_reports
      ADD CONSTRAINT drying_status_valid CHECK (status IN ('IN_PROGRESS', 'COMPLETED'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS drying_tunnel_report_lots (
  drying_report_id UUID NOT NULL REFERENCES drying_tunnel_reports(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  process_report_id UUID REFERENCES lot_process_reports(id) ON DELETE SET NULL,
  lot_code VARCHAR(60) NOT NULL,
  farmer_name VARCHAR(180),
  net_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  quintals NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (drying_report_id, lot_id),
  UNIQUE (lot_id)
);

INSERT INTO drying_tunnel_report_lots
  (drying_report_id, lot_id, process_report_id, lot_code, farmer_name, net_weight_kg, quintals)
SELECT
  d.id,
  d.lot_id,
  d.process_report_id,
  l.lot_code,
  f.full_name,
  COALESCE(t.net_weight, d.input_weight_kg, 0),
  COALESCE(t.quintals, d.total_quintals, 0)
FROM drying_tunnel_reports d
JOIN lots l ON l.id = d.lot_id
LEFT JOIN farmers f ON f.id = l.farmer_id
LEFT JOIN weighing_tickets t ON t.lot_id = l.id
ON CONFLICT (lot_id) DO NOTHING;

UPDATE drying_tunnel_reports d
SET total_quintals = src.total_quintals
FROM (
  SELECT drying_report_id, COALESCE(SUM(quintals), 0) AS total_quintals
  FROM drying_tunnel_report_lots
  GROUP BY drying_report_id
) src
WHERE src.drying_report_id = d.id
  AND d.total_quintals = 0;

CREATE INDEX IF NOT EXISTS idx_drying_tunnel_report_lots_report
  ON drying_tunnel_report_lots(drying_report_id);
