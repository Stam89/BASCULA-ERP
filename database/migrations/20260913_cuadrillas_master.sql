-- Maestro de cuadrillas (grupos). Permite "crear" una cuadrilla por su nombre
-- aunque todavía no tenga registros, para que aparezca en el selector de la
-- alerta de Nómina. Los nombres ya usados en registros/asignaciones también
-- cuentan como cuadrillas (la lista /workers los une). Aditiva y reversible.
CREATE TABLE IF NOT EXISTS cuadrillas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(120) UNIQUE NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS cuadrillas;
--   DELETE FROM schema_migrations WHERE filename = '20260913_cuadrillas_master.sql';
