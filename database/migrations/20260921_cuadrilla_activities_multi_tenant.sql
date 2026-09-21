-- Multi-tenant ligero para tarifas de Cuadrilla.
-- Las actividades existentes quedan como tarifario maestro (socio_id NULL).
-- Los socios pueden sobreescribir una actividad sin modificar el maestro.

ALTER TABLE cuadrilla_activities
  ADD COLUMN IF NOT EXISTS socio_id UUID REFERENCES accionistas(id);

ALTER TABLE cuadrilla_activities
  DROP CONSTRAINT IF EXISTS cuadrilla_activities_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuadrilla_activities_master_name
  ON cuadrilla_activities (upper(btrim(name)))
  WHERE socio_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuadrilla_activities_socio_name
  ON cuadrilla_activities (socio_id, upper(btrim(name)))
  WHERE socio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cuadrilla_activities_socio_id
  ON cuadrilla_activities (socio_id);

