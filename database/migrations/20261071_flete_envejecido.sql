-- Flete de ENVEJECIDO (aditiva e idempotente).
-- Al mandar producto a envejecer se puede registrar el flete (solo envejecimiento, no selección):
--  · 'propia'  = lo lleva un carro de Transporte y Cosechadora: nace una CxC de Campo contra el socio
--                (campo_servicios, origen 'envejecido_flete' = lote) y su Por Pagar espejo.
--  · 'tercero' = lo lleva un carro externo: Por Pagar del socio al transportista.
ALTER TABLE selection_batches ADD COLUMN IF NOT EXISTS flete_tipo VARCHAR(10);
ALTER TABLE selection_batches ADD COLUMN IF NOT EXISTS flete_monto NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE selection_batches ADD COLUMN IF NOT EXISTS flete_activo_id UUID REFERENCES campo_activos(id) ON DELETE SET NULL;
ALTER TABLE selection_batches ADD COLUMN IF NOT EXISTS flete_prestador TEXT;
ALTER TABLE selection_batches ADD COLUMN IF NOT EXISTS flete_payable_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_selection_flete_tipo') THEN
    ALTER TABLE selection_batches
      ADD CONSTRAINT ck_selection_flete_tipo CHECK (flete_tipo IS NULL OR flete_tipo IN ('propia', 'tercero'));
  END IF;
END $$;

-- DOWN manual:
--   ALTER TABLE selection_batches DROP CONSTRAINT IF EXISTS ck_selection_flete_tipo;
--   ALTER TABLE selection_batches DROP COLUMN IF EXISTS flete_payable_id, DROP COLUMN IF EXISTS flete_prestador,
--     DROP COLUMN IF EXISTS flete_activo_id, DROP COLUMN IF EXISTS flete_monto, DROP COLUMN IF EXISTS flete_tipo;
