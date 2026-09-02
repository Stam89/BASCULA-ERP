-- Pago automático de cuadrilla desde Secadoras. Las labores de túnel (Llenado,
-- Sacado, Botada…) se autogeneran desde el movimiento de la secadora en vez de
-- digitarse a mano en Nómina. Aditiva y reversible.

-- 1) Categoría en el catálogo de actividades para filtrar "labores de secadora".
ALTER TABLE cuadrilla_activities
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(20) NOT NULL DEFAULT 'GENERAL';

-- Toda labor que menciona TUNEL es de secadora (Recepción a túnel, Sacado/Botada
-- de túnel, Llenado polvillo túnel, Limpieza túnel…). El operador puede recategorizar.
UPDATE cuadrilla_activities SET categoria = 'SECADORA'
  WHERE categoria = 'GENERAL' AND name ILIKE '%TUNEL%';

-- 2) Trazabilidad del origen en la nómina de cuadrilla.
ALTER TABLE cuadrilla_entries
  ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'MANUAL';  -- MANUAL | SECADORA
ALTER TABLE cuadrilla_entries
  ADD COLUMN IF NOT EXISTS referencia_id UUID;                             -- drying_tunnel_reports.id
ALTER TABLE cuadrilla_entries
  ADD COLUMN IF NOT EXISTS tunnel_number INT;                              -- para la etiqueta "Túnel N"
ALTER TABLE cuadrilla_entries
  ADD COLUMN IF NOT EXISTS momento VARCHAR(12);                            -- LLENADO | VACIADO

-- Un movimiento de secadora genera a lo sumo UNA entrada por momento (llenado /
-- vaciado): reguardar el movimiento actualiza la misma fila en vez de duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuadrilla_auto_secadora
  ON cuadrilla_entries (referencia_id, momento)
  WHERE origen = 'SECADORA';

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS uq_cuadrilla_auto_secadora;
--   ALTER TABLE cuadrilla_entries DROP COLUMN IF EXISTS momento, DROP COLUMN IF EXISTS tunnel_number,
--         DROP COLUMN IF EXISTS referencia_id, DROP COLUMN IF EXISTS origen;
--   ALTER TABLE cuadrilla_activities DROP COLUMN IF EXISTS categoria;
--   DELETE FROM schema_migrations WHERE filename = '20260910_cuadrilla_secadora.sql';
