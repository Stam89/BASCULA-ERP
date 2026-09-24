-- Detalle de cosechadoras aplicado a una liquidacion. Permite varias maquinas
-- por lote y evita volver a descontar el mismo Parte Diario.
-- Migracion aditiva: no cambia liquidaciones ni partes historicos.

ALTER TABLE campo_partes
  ADD COLUMN IF NOT EXISTS farmer_id UUID REFERENCES farmers(id) ON DELETE SET NULL;

-- Enlaza partes historicos por nombre normalizado cuando existe una coincidencia
-- unica en el catalogo global de agricultores.
UPDATE campo_partes p
   SET farmer_id = f.id
  FROM farmers f
 WHERE p.farmer_id IS NULL
   AND lower(trim(p.cliente)) = lower(trim(f.full_name))
   AND NOT EXISTS (
     SELECT 1
       FROM farmers f2
      WHERE f2.id <> f.id
        AND lower(trim(f2.full_name)) = lower(trim(f.full_name))
   );

CREATE INDEX IF NOT EXISTS idx_campo_partes_farmer_fecha
  ON campo_partes (farmer_id, fecha DESC);

CREATE TABLE IF NOT EXISTS liquidation_harvest_details (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidation_id     UUID NOT NULL REFERENCES liquidations(id) ON DELETE CASCADE,
  campo_parte_id     UUID REFERENCES campo_partes(id) ON DELETE RESTRICT,
  activo_id          UUID REFERENCES campo_activos(id) ON DELETE SET NULL,
  provider_type      VARCHAR(20) NOT NULL CHECK (provider_type IN ('propia', 'tercero')),
  provider_name      VARCHAR(200),
  quintals           NUMERIC(14,2) NOT NULL CHECK (quintals > 0),
  price_per_quintal  NUMERIC(14,4) NOT NULL CHECK (price_per_quintal >= 0),
  amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_liq_harvest_liquidation
  ON liquidation_harvest_details (liquidation_id);

-- Un Parte Diario representa el trabajo de una maquina y solo puede descontarse
-- una vez. Al anular la liquidacion el detalle se elimina y vuelve a estar libre.
CREATE UNIQUE INDEX IF NOT EXISTS uq_liq_harvest_campo_parte
  ON liquidation_harvest_details (campo_parte_id)
  WHERE campo_parte_id IS NOT NULL;

-- DOWN manual:
--   DROP TABLE IF EXISTS liquidation_harvest_details;
--   DROP INDEX IF EXISTS idx_campo_partes_farmer_fecha;
--   ALTER TABLE campo_partes DROP COLUMN IF EXISTS farmer_id;
--   DELETE FROM schema_migrations WHERE filename = '20261029_liquidacion_cosechadoras_multiples.sql';
