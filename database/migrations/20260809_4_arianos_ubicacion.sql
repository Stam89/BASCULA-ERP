-- Ubicacion fisica donde se guarda el lote apartado (arroz seco sin procesar).
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS ubicacion_arianos VARCHAR(160);
