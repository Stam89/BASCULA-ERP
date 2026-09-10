-- Nómina administrativa (personal de oficina) POR ACCIONISTA: matriz y socios.
-- Sueldo fijo quincenal + incentivo opcional − descuentos. El pago sale de la
-- caja del accionista activo (se valida el cash_register en el backend).
-- Aditivo e idempotente.
CREATE TABLE IF NOT EXISTS admin_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accionista_id UUID NOT NULL,
  cargo VARCHAR(80) NOT NULL DEFAULT '',
  worker_name VARCHAR(140) NOT NULL,
  base_salary NUMERIC(14,2) NOT NULL DEFAULT 0,   -- sueldo QUINCENAL
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_staff_acc ON admin_staff(accionista_id);

CREATE TABLE IF NOT EXISTS admin_salary_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accionista_id UUID NOT NULL,
  staff_id UUID,
  worker_name VARCHAR(140) NOT NULL,
  cargo VARCHAR(80) NOT NULL DEFAULT '',
  base_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  incentivo NUMERIC(14,2) NOT NULL DEFAULT 0,
  descuentos NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  periodo VARCHAR(40),
  cash_register_id UUID,
  created_by UUID,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_salary_pay_acc ON admin_salary_payments(accionista_id, paid_at DESC);
