-- Anular en Caja el pago de un sueldo administrativo lo deja otra vez por pagar
-- en Nómina: el pago se marca anulado (no se borra) y deja de contar para el
-- período y el historial. Aditiva e idempotente.
ALTER TABLE admin_salary_payments ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ;
