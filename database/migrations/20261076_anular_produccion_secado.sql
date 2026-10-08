-- Un secado admite UN solo proceso de producción (índice único sobre drying_report_id): al anular, el proceso anulado suelta ese
-- enlace para que el secado pueda volver a pilarse, y guarda aquí a qué secado pertenecía (trazabilidad). Aditivo e idempotente.
ALTER TABLE processing_batches ADD COLUMN IF NOT EXISTS drying_report_id_anulado uuid;
