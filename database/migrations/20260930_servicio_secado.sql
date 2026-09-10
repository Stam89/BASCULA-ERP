-- Tarifa global de SECADO como servicio al cliente (maquila): $ por QQ.
-- Se cobra al finalizar el pilado de un lote de servicio (Secado + Pilado) y en
-- el formulario "Solo Servicio de Secado" (lotes que solo secan, sin pilar).
-- Aditiva y idempotente: no altera datos existentes (default 0 = no cobra).
ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS secado_servicio_per_qq NUMERIC(10,4) NOT NULL DEFAULT 0;
