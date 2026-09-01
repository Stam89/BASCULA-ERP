-- La liquidación ahora aplica PAGOS REALES a los fomentos del agricultor.
--   · fomento_pagos.liquidation_id: liga el abono a la liquidación que lo originó
--     (referencia robusta para reversar si la liquidación se anula). Aditiva.
--   · fomentos.liquidado_at: marca cuándo el fomento quedó saldado (deuda_total<=0)
--     por una liquidación; el "estado Pagado/Liquidado" se deriva de esto. Nullable
--     para poder revertir (se limpia al reversar). No se toca `status` (activación).
ALTER TABLE fomento_pagos ADD COLUMN IF NOT EXISTS liquidation_id UUID REFERENCES liquidations(id);
ALTER TABLE fomentos      ADD COLUMN IF NOT EXISTS liquidado_at   TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_fomento_pagos_liquidation ON fomento_pagos (liquidation_id) WHERE liquidation_id IS NOT NULL;

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_fomento_pagos_liquidation;
--   ALTER TABLE fomentos      DROP COLUMN IF EXISTS liquidado_at;
--   ALTER TABLE fomento_pagos DROP COLUMN IF EXISTS liquidation_id;
--   DELETE FROM schema_migrations WHERE filename = '20260905_fomento_liquidacion.sql';
