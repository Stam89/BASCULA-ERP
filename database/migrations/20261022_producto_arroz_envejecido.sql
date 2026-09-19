-- Productos resultantes independientes para Seleccion / Envejecimiento.
-- No altera existencias: solo habilita nombres de destino en el catalogo.
INSERT INTO products (code, name, product_type, unit, is_active)
VALUES ('ARROZ-ENVEJECIDO', 'Arroz Envejecido', 'FINISHED_GOOD', 'QQ', true)
ON CONFLICT (code) DO UPDATE SET is_active = true;

-- Este producto fue desactivado cuando el proceso obligaba a devolver el mismo
-- arroz. La nueva transformacion permite volver a usarlo como destino distinto.
UPDATE products
   SET is_active = true
 WHERE code = 'ARROZ-PILADO-011-SEL';

-- DOWN (reversa manual; no borra movimientos ni existencias):
--   UPDATE products SET is_active = false
--    WHERE code IN ('ARROZ-ENVEJECIDO', 'ARROZ-PILADO-011-SEL');
--   DELETE FROM schema_migrations WHERE filename = '20261022_producto_arroz_envejecido.sql';
