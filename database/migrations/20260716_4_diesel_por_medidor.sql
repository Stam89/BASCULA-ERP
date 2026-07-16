-- El diesel se mide igual que la bombona de gas: por medidor (fin - inicio),
-- con un precio fijo por unidad que sale de Configuración → Tarifas.

ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS diesel_inicio NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS diesel_fin NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS diesel_precio NUMERIC(12,4) NOT NULL DEFAULT 0;
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS diesel_costo NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Precio fijo del diesel, junto a los del gas.
ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS precio_diesel NUMERIC(12,4) NOT NULL DEFAULT 0;
