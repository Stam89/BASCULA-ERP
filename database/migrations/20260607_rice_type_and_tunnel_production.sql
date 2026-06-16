ALTER TABLE drying_tunnel_reports
  ADD COLUMN IF NOT EXISTS rice_type VARCHAR(30) NOT NULL DEFAULT '0.11';

ALTER TABLE processing_batches
  ADD COLUMN IF NOT EXISTS drying_report_id UUID UNIQUE REFERENCES drying_tunnel_reports(id);

CREATE TABLE IF NOT EXISTS processing_batch_drying_lots (
  processing_batch_id UUID NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
  drying_report_id UUID NOT NULL REFERENCES drying_tunnel_reports(id) ON DELETE RESTRICT,
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  lot_code VARCHAR(60) NOT NULL,
  farmer_name VARCHAR(180),
  net_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  quintals NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (processing_batch_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_processing_batch_drying_lots_report
  ON processing_batch_drying_lots(drying_report_id);
