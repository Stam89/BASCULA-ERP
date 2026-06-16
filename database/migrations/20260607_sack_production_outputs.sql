ALTER TABLE production_yields
  ADD COLUMN IF NOT EXISTS fine_broken_rice_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fine_broken_rice_unit VARCHAR(20) NOT NULL DEFAULT 'SACK',
  ADD COLUMN IF NOT EXISTS fine_broken_rice_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sack_presentation_data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE processing_outputs
  ADD COLUMN IF NOT EXISTS presentation VARCHAR(80),
  ADD COLUMN IF NOT EXISTS sack_weight_lb NUMERIC(10,3);

ALTER TABLE third_party_custody
  ADD COLUMN IF NOT EXISTS presentation VARCHAR(80),
  ADD COLUMN IF NOT EXISTS sack_weight_lb NUMERIC(10,3);

INSERT INTO products (code, name, product_type, unit)
VALUES
  ('ARROZ-PILADO-SACO', 'Sacos Pilado', 'FINISHED_GOOD', 'SACK'),
  ('ARROCILLO-34', 'Arrocillo 3/4', 'BYPRODUCT', 'SACK'),
  ('ARROCILLO-FINO', 'Arrocillo Fino', 'BYPRODUCT', 'SACK'),
  ('POLVILLO-SACO', 'Polvillo', 'BYPRODUCT', 'SACK')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  product_type = EXCLUDED.product_type,
  unit = EXCLUDED.unit,
  is_active = true;
