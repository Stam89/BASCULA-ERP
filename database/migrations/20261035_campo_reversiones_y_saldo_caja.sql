-- Reversion auditada de movimientos manuales de Campo y proteccion de Caja.
-- No se eliminan registros: la correccion siempre crea el asiento contrario.

ALTER TABLE campo_movimientos
  ADD COLUMN IF NOT EXISTS movimiento_origen_id UUID REFERENCES campo_movimientos(id),
  ADD COLUMN IF NOT EXISTS motivo_reversion TEXT,
  ADD COLUMN IF NOT EXISTS reversado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversado_por UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campo_mov_una_reversion
  ON campo_movimientos (movimiento_origen_id)
  WHERE movimiento_origen_id IS NOT NULL;

ALTER TABLE campo_mantenimientos
  ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anulado_por UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campo_mov_reversado
  ON campo_movimientos (reversado_at)
  WHERE reversado_at IS NOT NULL;
