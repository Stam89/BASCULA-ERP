-- Registro de QQ liquidados en el abono de fomento, y enlace del "saldo en contra"
-- (nuevo fomento generado cuando los descuentos superan el bruto) a su liquidación
-- de origen, para poder revertirlo/eliminarlo con la anulación. Aditivas.
ALTER TABLE fomento_pagos ADD COLUMN IF NOT EXISTS qq_liquidados NUMERIC(14,2);
ALTER TABLE fomentos      ADD COLUMN IF NOT EXISTS origen_liquidation_id UUID REFERENCES liquidations(id);
CREATE INDEX IF NOT EXISTS idx_fomentos_origen_liq ON fomentos (origen_liquidation_id) WHERE origen_liquidation_id IS NOT NULL;

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_fomentos_origen_liq;
--   ALTER TABLE fomentos      DROP COLUMN IF EXISTS origen_liquidation_id;
--   ALTER TABLE fomento_pagos DROP COLUMN IF EXISTS qq_liquidados;
--   DELETE FROM schema_migrations WHERE filename = '20260907_fomento_qq_saldo_contra.sql';
