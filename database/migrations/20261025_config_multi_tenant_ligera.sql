-- Arquitectura Multi-Tenant Ligera para configuraciones operativas.
--
-- Las filas existentes quedan como MAESTRO con socio_id = NULL. Cada socio puede
-- tener una fila propia; si no existe, el backend usa el Maestro como fallback.

-- ── Configuración de planta / negocio ──────────────────────────────────────
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS socio_id UUID REFERENCES accionistas(id);
ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey;
ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_id_check;

UPDATE app_settings SET socio_id = NULL WHERE socio_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_master
  ON app_settings ((1))
  WHERE socio_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_socio
  ON app_settings (socio_id)
  WHERE socio_id IS NOT NULL;

INSERT INTO app_settings (id, socio_id)
SELECT 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE socio_id IS NULL);

-- ── Tarifas de cuadrilla / secado / combustible ────────────────────────────
ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS socio_id UUID REFERENCES accionistas(id);
ALTER TABLE labor_rates DROP CONSTRAINT IF EXISTS labor_rates_pkey;
ALTER TABLE labor_rates DROP CONSTRAINT IF EXISTS labor_rates_id_check;

UPDATE labor_rates SET socio_id = NULL WHERE socio_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_labor_rates_master
  ON labor_rates ((1))
  WHERE socio_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_labor_rates_socio
  ON labor_rates (socio_id)
  WHERE socio_id IS NOT NULL;

INSERT INTO labor_rates (id, socio_id)
SELECT 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM labor_rates WHERE socio_id IS NULL);
