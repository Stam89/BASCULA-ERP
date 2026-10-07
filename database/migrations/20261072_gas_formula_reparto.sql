-- Fórmula correcta del gas y reparto por túnel (aditiva e idempotente).
-- Bombona: (inicio − fin del medidor en %) × kg por cada 1% (10) × $ por kg (0.334).
-- Cilindro: cilindros usados × $ por cilindro (2.45).
-- Reparto: por tiempo compartido del quemador (si hay horas) o por QQ (si faltan).
ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS gas_bombona_kg_por_punto NUMERIC(10,3) NOT NULL DEFAULT 10;

ALTER TABLE motor_fuel_records ADD COLUMN IF NOT EXISTS gas_bombona_kg_por_punto NUMERIC(10,3);
ALTER TABLE motor_fuel_records ADD COLUMN IF NOT EXISTS reparto_metodo VARCHAR(10);

-- Lo que le tocó a cada túnel en cada registro de combustible: al reabrir un túnel se resta EXACTAMENTE esto.
CREATE TABLE IF NOT EXISTS motor_fuel_partes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motor_fuel_id UUID NOT NULL REFERENCES motor_fuel_records(id) ON DELETE CASCADE,
  drying_report_id UUID NOT NULL REFERENCES drying_tunnel_reports(id) ON DELETE CASCADE,
  quintales NUMERIC(14,3) NOT NULL DEFAULT 0,
  horas NUMERIC(10,2),
  peso NUMERIC(18,6) NOT NULL DEFAULT 0,
  gas NUMERIC(14,2) NOT NULL DEFAULT 0,
  diesel NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_motor_fuel_partes_fuel ON motor_fuel_partes(motor_fuel_id);
CREATE INDEX IF NOT EXISTS idx_motor_fuel_partes_report ON motor_fuel_partes(drying_report_id);

-- DOWN manual:
--   DROP TABLE IF EXISTS motor_fuel_partes;
--   ALTER TABLE motor_fuel_records DROP COLUMN IF EXISTS reparto_metodo, DROP COLUMN IF EXISTS gas_bombona_kg_por_punto;
--   ALTER TABLE labor_rates DROP COLUMN IF EXISTS gas_bombona_kg_por_punto;
