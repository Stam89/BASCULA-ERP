-- Asegura que existan las tablas de rendimiento de producción y custodia de
-- terceros. En algunas instalaciones (base creada de un esquema anterior) no se
-- crearon, y sin ellas falla el cierre de pilada (finish-production).

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
  fine_broken_rice_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  fine_broken_rice_unit VARCHAR(20) NOT NULL DEFAULT 'SACK',
  fine_broken_rice_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  bran_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  bran_unit VARCHAR(20) NOT NULL DEFAULT 'KG',
  bran_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  total_output_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  process_loss_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  yield_percent NUMERIC(8,3) NOT NULL DEFAULT 0,
  packaging_supply_id UUID REFERENCES insumos(id),
  sacks_used NUMERIC(14,3) NOT NULL DEFAULT 0,
  sack_presentation_data JSONB NOT NULL DEFAULT '{}'::jsonb,
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
  presentation VARCHAR(80),
  sack_weight_lb NUMERIC(10,3),
  kg_equivalent NUMERIC(14,3) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'IN_CUSTODY',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  CONSTRAINT third_party_custody_quantity_positive CHECK (quantity > 0)
);
