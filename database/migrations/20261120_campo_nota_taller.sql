-- 🧾 NOTA DEL TALLER CON VARIOS RENGLONES (pedido del dueño 2026-10-26): una nota de venta del taller (repuestos +
-- mano de obra) se registra de una vez en Transporte y Cosechadora. Cada renglón queda en la hoja de vida de la
-- máquina (campo_mantenimientos) pero de la caja sale UN solo egreso por el total (o una sola Cuenta por Pagar), así que
-- varios mantenimientos comparten el mismo movimiento. nota_id agrupa los renglones de la misma nota.
-- Aditiva e idempotente.
ALTER TABLE campo_mantenimientos DROP CONSTRAINT IF EXISTS campo_mantenimientos_movimiento_id_key;
CREATE INDEX IF NOT EXISTS idx_campo_mant_movimiento ON campo_mantenimientos (movimiento_id) WHERE movimiento_id IS NOT NULL;
ALTER TABLE campo_mantenimientos ADD COLUMN IF NOT EXISTS nota_id UUID;
ALTER TABLE campo_mantenimientos ADD COLUMN IF NOT EXISTS clase VARCHAR(12);
CREATE INDEX IF NOT EXISTS idx_campo_mant_nota ON campo_mantenimientos (nota_id) WHERE nota_id IS NOT NULL;
