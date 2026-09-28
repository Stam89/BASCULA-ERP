-- ACTIVO FIJO DESDE CAJA (aditiva e idempotente).
-- Una compra registrada como EGRESO en Caja puede crear el activo fijo en el
-- mismo paso (costo = monto del egreso, fecha = fecha de la compra). El enlace
-- permite retirarlo si se anula ese egreso.
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS cash_movement_id UUID REFERENCES cash_movements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_cash_movement ON equipment(cash_movement_id) WHERE cash_movement_id IS NOT NULL;

-- Categoría de Caja para estas compras (Matriz y socios).
INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a)
SELECT 'COMPRA_ACTIVO_FIJO', 'Compra de activo fijo', 'EGRESO', 'AMBOS'
WHERE NOT EXISTS (SELECT 1 FROM cash_categories WHERE codigo = 'COMPRA_ACTIVO_FIJO');
