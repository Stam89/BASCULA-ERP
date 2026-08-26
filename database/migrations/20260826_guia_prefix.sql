-- Prefijo / punto de emisión configurable de la Guía de Remisión. La numeración
-- de guías usa la secuencia `guia_remision_seq`; el prefijo antes estaba fijo
-- ('001-001-') y ahora se guarda aquí para poder cambiarlo (nueva libreta / año
-- fiscal) desde Configuración → Secuenciales. Aditivo; default = valor anterior.
-- (app_settings también lo crea en caliente vía ensureTable; esto garantiza que
-- exista para la generación de guías en orders.ts aunque no se abra Configuración.)
CREATE TABLE IF NOT EXISTS app_settings (id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1));
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS guia_prefix VARCHAR(20) NOT NULL DEFAULT '001-001-';
