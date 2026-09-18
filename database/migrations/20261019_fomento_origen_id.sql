-- Trazabilidad del arrastre de deuda (rollover): el fomento NUEVO generado al
-- cerrar una cosecha apunta al fomento ARCHIVADO del que hereda el saldo en contra.
-- Aditiva: los fomentos existentes quedan con fomento_origen_id NULL.
ALTER TABLE fomentos ADD COLUMN IF NOT EXISTS fomento_origen_id uuid
  REFERENCES fomentos(id) ON DELETE SET NULL;
