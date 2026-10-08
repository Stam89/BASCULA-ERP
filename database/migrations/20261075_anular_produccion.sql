-- Anular un proceso de producción ya cerrado: queda constancia en el propio proceso y se recuerda en qué estado
-- estaba su lote antes de producir (para devolverlo ahí). Aditivo e idempotente.
ALTER TABLE processing_batches ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE processing_batches ADD COLUMN IF NOT EXISTS anulado_por uuid;
ALTER TABLE processing_batches ADD COLUMN IF NOT EXISTS anulado_motivo text;
ALTER TABLE processing_batches ADD COLUMN IF NOT EXISTS estado_lote_previo text;
