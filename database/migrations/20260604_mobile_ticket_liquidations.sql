ALTER TABLE mobile_synced_tickets
  ADD COLUMN IF NOT EXISTS farmer_id UUID REFERENCES farmers(id);

ALTER TABLE mobile_synced_tickets
  ADD COLUMN IF NOT EXISTS price_per_quintal NUMERIC(14,4) NOT NULL DEFAULT 0;

ALTER TABLE mobile_synced_tickets
  ADD COLUMN IF NOT EXISTS gross_payable NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE mobile_synced_tickets
  ADD COLUMN IF NOT EXISTS advances_discount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE mobile_synced_tickets
  ADD COLUMN IF NOT EXISTS net_payable NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE mobile_synced_tickets
  ADD COLUMN IF NOT EXISTS liquidated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS mobile_advance_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advance_id UUID NOT NULL REFERENCES farmer_advances(id),
  ticket_id UUID NOT NULL REFERENCES mobile_synced_tickets(id),
  amount_applied NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mobile_advance_application_positive CHECK (amount_applied > 0)
);
