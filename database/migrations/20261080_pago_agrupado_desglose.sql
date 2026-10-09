-- Pago/cobro de VARIAS cuentas con UN solo movimiento de caja (2026-10-08, auditoría Por Cobrar/Por Pagar).
-- Antes el movimiento apuntaba solo a la PRIMERA cuenta: al anularlo volvía a deber solo esa y las demás
-- quedaban pagadas (la deuda desaparecía). Aquí queda cuánto se abonó a cada cuenta, para revertirlas todas.
-- Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS cash_movement_cuentas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_movement_id UUID NOT NULL REFERENCES cash_movements(id) ON DELETE CASCADE,
  tabla            VARCHAR(30) NOT NULL CHECK (tabla IN ('accounts_receivable', 'accounts_payable')),
  cuenta_id        UUID NOT NULL,
  monto            NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_movement_cuentas_mov ON cash_movement_cuentas (cash_movement_id);
CREATE INDEX IF NOT EXISTS idx_cash_movement_cuentas_cuenta ON cash_movement_cuentas (cuenta_id);
