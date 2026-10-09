-- Pago que hace un socio (casi siempre la Matriz) POR OTRO: p. ej. la Matriz paga a los cosechadores que debe
-- STALYN con la plata que un cliente de STALYN le depositó (pedido del dueño 2026-10-09).
-- Lo que la Matriz ya le debía al socio por esos cobros (cuentas 'cobro_por_socio') se DESCUENTA sin mover caja:
-- cada descuento queda aquí para poder deshacerlo si se anula el pago. Lo que sobra es deuda nueva 'pago_por_socio'.
-- Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS cruces_entre_socios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_movement_id UUID NOT NULL REFERENCES cash_movements(id),
  payable_id UUID NOT NULL REFERENCES accounts_payable(id),
  receivable_id UUID NOT NULL REFERENCES accounts_receivable(id),
  monto NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  anulado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cruces_entre_socios_mov ON cruces_entre_socios (cash_movement_id);
