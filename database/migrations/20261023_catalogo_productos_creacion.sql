-- Habilita el producto base de envejecimiento para instalaciones existentes.
-- El stock inicial se muestra como 0.00 QQ desde la UI; inventory_stock es una
-- vista de movimientos reales y no admite movimientos con cantidad 0.
INSERT INTO products (code, name, product_type, unit, is_active)
VALUES ('ARROZ-ENVEJECIDO', 'Arroz Envejecido', 'FINISHED_GOOD', 'QQ', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  product_type = EXCLUDED.product_type,
  unit = EXCLUDED.unit,
  is_active = true;

-- DOWN (reversa manual, sin borrar movimientos existentes):
--   UPDATE products SET is_active = false WHERE code = 'ARROZ-ENVEJECIDO';
--   DELETE FROM schema_migrations WHERE filename = '20261023_catalogo_productos_creacion.sql';
