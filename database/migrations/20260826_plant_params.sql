-- Parámetros operativos globales de la piladora, editables desde
-- Configuración → Operación y Planta:
--   * tarifa_pilado_qq  = tarifa del servicio de pilado por quintal ($/QQ)
--   * humedad_base_pct  = humedad base (%) para el cálculo de merma en báscula
-- Viven en app_settings (tabla de una sola fila, id = 1). Aditivo; defaults
-- según lo pactado (13.0 % / $3.50). app_settings también los crea en caliente
-- vía ensureTable en settings.ts; esto garantiza que existan aunque no se abra
-- Configuración.
CREATE TABLE IF NOT EXISTS app_settings (id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1));
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS tarifa_pilado_qq NUMERIC(10,2) NOT NULL DEFAULT 3.50;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS humedad_base_pct NUMERIC(5,2) NOT NULL DEFAULT 13.00;
