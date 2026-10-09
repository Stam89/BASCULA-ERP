-- Selección/envejecido (auditoría 2026-10-08): anular un viaje traído y reabrir un lote cuyo informe se registró mal.
-- Nada se borra: queda quién, cuándo y por qué. Aditiva e idempotente.
ALTER TABLE selection_traidas ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ;
ALTER TABLE selection_traidas ADD COLUMN IF NOT EXISTS anulado_motivo TEXT;
ALTER TABLE selection_traidas ADD COLUMN IF NOT EXISTS anulado_by UUID;

-- Historial de reaperturas de un lote (el informe anterior queda guardado aquí).
CREATE TABLE IF NOT EXISTS selection_batch_reaperturas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    UUID NOT NULL REFERENCES selection_batches(id),
  motivo      TEXT NOT NULL,
  salidas     JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_qq   NUMERIC(14,3),
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_selection_reaperturas_batch ON selection_batch_reaperturas (batch_id);
