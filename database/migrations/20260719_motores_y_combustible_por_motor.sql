-- El combustible no lo consume cada secadora: lo consume el MOTOR, y un motor
-- mueve varias secadoras a la vez (Motor 1 -> Secadoras 1 y 2; Motor 2 ->
-- Secadora 3). Antes los medidores se anotaban por secadora, así que el total
-- y el costo por QQ salían mal cuando el motor secaba dos lotes a la vez.
--
-- Ahora los medidores se anotan UNA vez por motor (motor_fuel_records) y el
-- costo se reparte entre los secados activos de ese motor según los quintales
-- de cada uno. La parte de cada secado se guarda en sus columnas de costo de
-- siempre, así el costo del lote y del accionista no cambia de lugar.

ALTER TABLE drying_tunnel_reports
  ADD COLUMN IF NOT EXISTS motor_number INT,
  ADD COLUMN IF NOT EXISTS motor_fuel_id UUID;

-- Secadora 1 y 2 -> motor 1; Secadora 3 -> motor 2 (para lo ya guardado).
UPDATE drying_tunnel_reports
SET motor_number = CASE
  WHEN dryer_name ILIKE '%3%' THEN 2
  ELSE 1
END
WHERE motor_number IS NULL;

CREATE TABLE IF NOT EXISTS motor_fuel_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  motor_number INT NOT NULL CHECK (motor_number IN (1, 2)),
  -- Medidores del motor (la bombona baja: inicio - fin; igual el diesel).
  gas_bombona_inicio NUMERIC(12,3) NOT NULL DEFAULT 0,
  gas_bombona_fin NUMERIC(12,3) NOT NULL DEFAULT 0,
  gas_cilindro_cantidad NUMERIC(12,3) NOT NULL DEFAULT 0,
  diesel_inicio NUMERIC(12,3) NOT NULL DEFAULT 0,
  diesel_fin NUMERIC(12,3) NOT NULL DEFAULT 0,
  -- Precios del momento y costos calculados (quedan fijos como constancia).
  gas_bombona_precio NUMERIC(12,4) NOT NULL DEFAULT 0,
  gas_cilindro_precio NUMERIC(12,4) NOT NULL DEFAULT 0,
  diesel_precio NUMERIC(12,4) NOT NULL DEFAULT 0,
  gas_costo NUMERIC(12,2) NOT NULL DEFAULT 0,
  diesel_costo NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_quintals NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_motor_fuel_motor ON motor_fuel_records(motor_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drying_reports_motor ON drying_tunnel_reports(motor_number);
