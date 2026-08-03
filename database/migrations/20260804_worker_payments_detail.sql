-- Detalle de cálculo para pagos de pilador/estibador, para poder revisar
-- en Nómina exactamente de dónde sale cada monto (QQ, sacas, arrocillo, tulas).
ALTER TABLE worker_payments ADD COLUMN IF NOT EXISTS detail JSONB DEFAULT NULL;
