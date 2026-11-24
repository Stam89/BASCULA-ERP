-- 📟 Tablet de báscula: lo que la tablet informa de sí misma en cada contacto (versión de la app y cuántos tickets le
-- faltan por enviar), para verlo desde el ERP. Solo columnas nuevas; las tablets con versión anterior las dejan vacías.
ALTER TABLE bascula_devices ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE bascula_devices ADD COLUMN IF NOT EXISTS pendientes INTEGER;

-- Reversión (solo si hiciera falta):
--   ALTER TABLE bascula_devices DROP COLUMN IF EXISTS app_version, DROP COLUMN IF EXISTS pendientes;
--   DELETE FROM schema_migrations WHERE filename = '20261145_tablet_bascula.sql';
