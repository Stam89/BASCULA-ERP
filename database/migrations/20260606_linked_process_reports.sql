CREATE TABLE IF NOT EXISTS lot_process_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  stage VARCHAR(40) NOT NULL,
  sequence INTEGER NOT NULL,
  reference_type VARCHAR(60),
  reference_id UUID,
  report_title VARCHAR(160) NOT NULL,
  report_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lot_process_stage_valid CHECK (
    stage IN ('BASCULA', 'SECADO', 'TUNEL_1', 'TUNEL_2', 'TUNEL_3', 'PILADO', 'RENDIMIENTO', 'VENTA')
  ),
  CONSTRAINT lot_process_sequence_positive CHECK (sequence > 0)
);

CREATE TABLE IF NOT EXISTS lot_process_report_links (
  from_report_id UUID NOT NULL REFERENCES lot_process_reports(id) ON DELETE CASCADE,
  to_report_id UUID NOT NULL REFERENCES lot_process_reports(id) ON DELETE CASCADE,
  link_type VARCHAR(40) NOT NULL DEFAULT 'NEXT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_report_id, to_report_id),
  CONSTRAINT lot_process_link_not_self CHECK (from_report_id <> to_report_id)
);

CREATE TABLE IF NOT EXISTS drying_tunnel_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  process_report_id UUID NOT NULL UNIQUE REFERENCES lot_process_reports(id) ON DELETE CASCADE,
  tunnel_number INTEGER NOT NULL CHECK (tunnel_number BETWEEN 1 AND 3),
  input_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  output_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  moisture_before NUMERIC(8,3),
  moisture_after NUMERIC(8,3),
  drying_hours NUMERIC(8,2),
  operator_name VARCHAR(160),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT drying_weights_non_negative CHECK (input_weight_kg >= 0 AND output_weight_kg >= 0)
);

CREATE INDEX IF NOT EXISTS idx_lot_process_reports_lot_sequence
  ON lot_process_reports(lot_id, sequence);

CREATE INDEX IF NOT EXISTS idx_lot_process_reports_stage
  ON lot_process_reports(lot_id, stage);

CREATE INDEX IF NOT EXISTS idx_drying_tunnel_reports_lot
  ON drying_tunnel_reports(lot_id, tunnel_number, created_at);
