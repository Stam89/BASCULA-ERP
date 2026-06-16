CREATE TABLE IF NOT EXISTS mobile_synced_tickets (
  id UUID PRIMARY KEY,
  device_id TEXT,
  farmer_name VARCHAR(180) NOT NULL DEFAULT '',
  gross_weight NUMERIC(14,3) NOT NULL DEFAULT 0,
  tare_weight NUMERIC(14,3) NOT NULL DEFAULT 0,
  net_weight NUMERIC(14,3) NOT NULL DEFAULT 0,
  qualification NUMERIC(10,3) NOT NULL DEFAULT 0,
  quintals NUMERIC(14,3) NOT NULL DEFAULT 0,
  print_count INTEGER NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  mobile_created_at BIGINT NOT NULL,
  mobile_updated_at BIGINT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_synced_tickets_updated_at
  ON mobile_synced_tickets (mobile_updated_at);
