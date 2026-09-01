-- Anulación de liquidaciones con reversa. Registra cuándo y por qué se anuló
-- (motivo obligatorio en el endpoint) para dejar traza contable. status pasa a
-- 'CANCELLED' (ya existía ese valor; solo faltaba dónde guardar el motivo). Aditiva.
ALTER TABLE liquidations ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMPTZ;
ALTER TABLE liquidations ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   ALTER TABLE liquidations DROP COLUMN IF EXISTS cancelled_reason;
--   ALTER TABLE liquidations DROP COLUMN IF EXISTS cancelled_at;
--   DELETE FROM schema_migrations WHERE filename = '20260906_liquidacion_anular.sql';
