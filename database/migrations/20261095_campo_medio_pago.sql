-- Transporte: MEDIO DE PAGO de los cobros (pedido del dueño 2026-10-14). El cobro de una cuenta por
-- cobrar puede ser en efectivo (CAJA), por transferencia o con cheque (BANCO), con su número de
-- referencia. NULL = registros anteriores (se leen como efectivo si entraron a CAJA).
-- Aditiva e idempotente.
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS medio_pago VARCHAR(20);
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS referencia VARCHAR(60);
DO $$ BEGIN
  ALTER TABLE campo_movimientos ADD CONSTRAINT campo_movimientos_medio_pago_chk
    CHECK (medio_pago IS NULL OR medio_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'CHEQUE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- DOWN (manual):
--   ALTER TABLE campo_movimientos DROP CONSTRAINT IF EXISTS campo_movimientos_medio_pago_chk;
--   ALTER TABLE campo_movimientos DROP COLUMN IF EXISTS medio_pago, DROP COLUMN IF EXISTS referencia;
