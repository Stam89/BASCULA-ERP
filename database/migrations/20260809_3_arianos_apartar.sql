-- "Arianos": arroz ya secado que NO se va a procesar todavia, sino guardar.
-- Se marca el secado como apartado para que deje de contar como pendiente de
-- procesar (desaparece del selector de Produccion, del panel SECO y del informe
-- de pendientes). Es reversible (Devolver a proceso).
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS apartado_arianos BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS apartado_at TIMESTAMPTZ;
