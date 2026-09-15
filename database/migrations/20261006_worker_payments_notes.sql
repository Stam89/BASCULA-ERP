-- Detalle legible del pago de nómina. Lo usa la automatización del SECADOR para
-- guardar el ancla temporal de INICIO del secado (ej.
-- "Secado - Inicio: 15/09/2026 18:30 · Guardianía + 2 túnel(es)") y mostrarlo en
-- el Rol de Pago. Idempotente.
ALTER TABLE worker_payments ADD COLUMN IF NOT EXISTS notes TEXT;
