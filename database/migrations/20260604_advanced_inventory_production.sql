ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS is_maquila BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE weighing_tickets
  ADD COLUMN IF NOT EXISTS is_maquila BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE accounts_receivable
  ADD COLUMN IF NOT EXISTS farmer_id UUID REFERENCES farmers(id);

ALTER TABLE accounts_receivable
  ADD COLUMN IF NOT EXISTS reference_type VARCHAR(60);

ALTER TABLE accounts_receivable
  ADD COLUMN IF NOT EXISTS reference_id UUID;

ALTER TABLE accounts_receivable
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE TABLE IF NOT EXISTS insumos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(140) NOT NULL UNIQUE,
  stock_actual NUMERIC(14,3) NOT NULL DEFAULT 0,
  nivel_critico NUMERIC(14,3) NOT NULL DEFAULT 50,
  unidad VARCHAR(20) NOT NULL DEFAULT 'UNIDAD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT insumos_stock_non_negative CHECK (stock_actual >= 0),
  CONSTRAINT insumos_critical_non_negative CHECK (nivel_critico >= 0)
);

CREATE TABLE IF NOT EXISTS insumo_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  insumo_id UUID NOT NULL REFERENCES insumos(id),
  movement VARCHAR(30) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  reference_type VARCHAR(60),
  reference_id UUID,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT insumo_movement_not_zero CHECK (quantity <> 0)
);

CREATE TABLE IF NOT EXISTS production_yields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processing_batch_id UUID NOT NULL UNIQUE REFERENCES processing_batches(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES lots(id),
  ownership ownership_type NOT NULL,
  input_paddy_kg NUMERIC(14,3) NOT NULL,
  white_rice_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  white_rice_unit VARCHAR(20) NOT NULL DEFAULT 'QQ',
  white_rice_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  broken_rice_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  broken_rice_unit VARCHAR(20) NOT NULL DEFAULT 'KG',
  broken_rice_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  bran_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  bran_unit VARCHAR(20) NOT NULL DEFAULT 'KG',
  bran_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  total_output_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  process_loss_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  yield_percent NUMERIC(8,3) NOT NULL DEFAULT 0,
  packaging_supply_id UUID REFERENCES insumos(id),
  sacks_used NUMERIC(14,3) NOT NULL DEFAULT 0,
  service_rate_per_qq NUMERIC(14,4) NOT NULL DEFAULT 0,
  service_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT production_yield_input_positive CHECK (input_paddy_kg > 0),
  CONSTRAINT production_yield_loss_non_negative CHECK (process_loss_kg >= 0)
);

CREATE TABLE IF NOT EXISTS third_party_custody (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processing_batch_id UUID NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES lots(id),
  farmer_id UUID REFERENCES farmers(id),
  product_id UUID NOT NULL REFERENCES products(id),
  product_label VARCHAR(80) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  kg_equivalent NUMERIC(14,3) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'IN_CUSTODY',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  CONSTRAINT third_party_custody_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_insumo_movements_insumo ON insumo_movements(insumo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_third_party_custody_lot ON third_party_custody(lot_id, status);
CREATE INDEX IF NOT EXISTS idx_production_yields_lot ON production_yields(lot_id, created_at);
