ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS rice_type VARCHAR(30) NOT NULL DEFAULT '0.11';

INSERT INTO products (code, name, product_type, unit)
VALUES
  ('CASCARA-011', 'Cascara 0.11', 'RAW_MATERIAL', 'QQ'),
  ('CASCARA-CORRIENTE', 'Cascara Corriente', 'RAW_MATERIAL', 'QQ'),
  ('ARROZ-PILADO-011', 'Producto 0.11', 'FINISHED_GOOD', 'QQ'),
  ('ARROZ-PILADO-CORRIENTE', 'Producto Corriente', 'FINISHED_GOOD', 'QQ'),
  ('ARROCILLO-34', 'Arrocillo 3/4', 'BYPRODUCT', 'QQ'),
  ('ARROCILLO-FINO', 'Arrocillo Fino', 'BYPRODUCT', 'QQ'),
  ('POLVILLO', 'Polvillo', 'BYPRODUCT', 'QQ')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  product_type = EXCLUDED.product_type,
  unit = EXCLUDED.unit,
  is_active = true;
