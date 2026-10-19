-- SECADO FINALIZADO CON EL COMBUSTIBLE PENDIENTE (pedido del dueño 2026-10-19: «hay días que el informe no me lo
-- envía al instante y necesito llenar los túneles con más arroz»). El último túnel del motor se puede finalizar sin
-- el combustible: la corrida queda cerrada en un registro del motor marcado «pendiente» (costo 0) y los túneles quedan
-- libres. Cuando llega el informe se completa ese registro y el costo se reparte a SUS túneles (no a la corrida nueva).
-- Aditiva e idempotente.
ALTER TABLE motor_fuel_records ADD COLUMN IF NOT EXISTS pendiente BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_motor_fuel_pendiente ON motor_fuel_records (motor_number) WHERE pendiente;
