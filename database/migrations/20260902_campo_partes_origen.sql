-- Origen del Parte Diario: 'manual' (chofer/UI) o 'bascula' (integración con el
-- ingreso de materia prima de Planta). Sirve para el badge "⚖️ Báscula". Aditiva.
ALTER TABLE campo_partes ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'manual';

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   ALTER TABLE campo_partes DROP COLUMN IF EXISTS origen;
--   DELETE FROM schema_migrations WHERE filename = '20260902_campo_partes_origen.sql';
