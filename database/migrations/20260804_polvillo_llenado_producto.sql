-- Producto para registrar el llenado de polvillo (25% del polvillo producido).
INSERT INTO products (code, name, product_type, unit)
VALUES ('POLVILLO-LLENADO', 'Polvillo Llenado', 'FINISHED_GOOD', 'QQ')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  product_type = EXCLUDED.product_type,
  unit = EXCLUDED.unit;
