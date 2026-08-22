-- Presentación / tamaño de saco en las salidas de selección, para descontar los
-- sacos exactos (por tipo) del inventario de la matriz al cerrar el lote. Aditivo.
ALTER TABLE selection_batch_outputs
  ADD COLUMN IF NOT EXISTS presentation VARCHAR(40),
  ADD COLUMN IF NOT EXISTS sack_weight_lb NUMERIC(6,2);
