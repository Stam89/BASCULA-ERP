-- Agrega batch_id a liquidaciones para agrupar lotes liquidados en una misma sesión
ALTER TABLE liquidations ADD COLUMN IF NOT EXISTS batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_liquidations_batch_id ON liquidations(batch_id);
