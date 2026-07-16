-- Secado: fecha de llenado del túnel y detalle del gas utilizado.
-- El gas se mide de dos formas y pueden usarse las dos en un mismo secado:
--   * BOMBONA: (medidor fin - medidor inicio) × precio
--   * CILINDRO: cilindros utilizados × precio
-- El costo total del gas es la suma de ambos. Los precios son fijos y salen de
-- Configuración → Tarifas.

ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS filled_at DATE;

-- Bombona (por medidor)
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS gas_bombona_inicio NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS gas_bombona_fin NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS gas_bombona_precio NUMERIC(12,4) NOT NULL DEFAULT 0;
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS gas_bombona_costo NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Cilindro (por unidades)
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS gas_cilindro_cantidad NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS gas_cilindro_precio NUMERIC(12,4) NOT NULL DEFAULT 0;
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS gas_cilindro_costo NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Costo total del gas del secado (bombona + cilindro)
ALTER TABLE drying_tunnel_reports ADD COLUMN IF NOT EXISTS gas_costo_total NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Precios fijos del gas, en Configuración → Tarifas.
ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS precio_gas_bombona NUMERIC(12,4) NOT NULL DEFAULT 0;
ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS precio_gas_cilindro NUMERIC(12,4) NOT NULL DEFAULT 0;
