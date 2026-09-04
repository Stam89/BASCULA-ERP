-- Enlace del kardex de sacos con el movimiento de Caja que lo originó (compra de
-- sacos). Permite revertir automáticamente el inventario al anular la compra en
-- Caja. `ref_batch` ya referencia processing_batches (consumo por pilado), así que
-- se usa una columna aparte para la Caja. ON DELETE SET NULL: si el movimiento de
-- caja se borrara, el kardex conserva su historia sin el enlace.
ALTER TABLE sack_movements
  ADD COLUMN IF NOT EXISTS ref_cash_movement UUID REFERENCES cash_movements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sack_movements_ref_cash ON sack_movements (ref_cash_movement);
