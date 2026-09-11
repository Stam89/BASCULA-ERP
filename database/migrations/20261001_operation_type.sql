-- Tipo de operación del lote (4 destinos definidos por el cliente en Báscula):
--   COMPRA        = Compra / Producción propia (arroz propio, sí a producción).
--   SECADO        = Solo Servicio de Secado (va a secadoras y se entrega; NO a producción).
--   SECADO_PILADO = Servicio Completo (secado + pilado; sí pasa a producción).
--   PILADO        = Solo Servicio de Pilada (ya viene seco; salta secadoras y va directo a producción).
-- Se guarda en el lote y en el ticket de báscula. is_maquila/ownership se mantienen
-- (derivados) por compatibilidad. Aditiva e idempotente.
ALTER TABLE lots            ADD COLUMN IF NOT EXISTS operation_type VARCHAR(20) NOT NULL DEFAULT 'COMPRA';
ALTER TABLE weighing_tickets ADD COLUMN IF NOT EXISTS operation_type VARCHAR(20) NOT NULL DEFAULT 'COMPRA';

-- Backfill conservador: los lotes/tickets de maquila existentes se marcan como
-- 'SECADO' (mantiene el comportamiento vigente de excluirlos de Producción).
UPDATE lots             SET operation_type = 'SECADO' WHERE is_maquila = true AND operation_type = 'COMPRA';
UPDATE weighing_tickets SET operation_type = 'SECADO' WHERE is_maquila = true AND operation_type = 'COMPRA';
