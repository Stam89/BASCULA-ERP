-- Secado en Tendal (patio, al sol): reusa el pipeline de secado mecánico para
-- que el lote quede disponible en Producción exactamente igual. Todo ADITIVO.
-- 1) Tarifa de cuadrilla por QQ para el tendal (Configuración → Tarifas de pago).
ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS tendal_per_qq NUMERIC(10,4) NOT NULL DEFAULT 0;
-- 2) Método de secado en el informe de túnel: 'TUNEL' (mecánico) o 'TENDAL'.
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS dry_method VARCHAR(10) NOT NULL DEFAULT 'TUNEL';
-- 3) El tendal no ocupa túnel: tunnel_number puede ser NULL. El CHECK existente
--    (BETWEEN 1 AND 3) sigue pasando para NULL (NULL BETWEEN → desconocido → OK).
ALTER TABLE drying_tunnel_reports ALTER COLUMN tunnel_number DROP NOT NULL;
