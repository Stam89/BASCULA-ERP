-- PEDIDO PAGADO POR TRANSFERENCIA / CHEQUE: el dinero no entra a la caja al despachar; queda «por confirmar» hasta
-- que el de caja vea que la transferencia llegó (pedido del dueño 2026-10-16). Mientras tanto la cuenta del pedido
-- sigue viva en Por Cobrar con esta marca. Aditiva e idempotente.
ALTER TABLE accounts_receivable ADD COLUMN IF NOT EXISTS por_confirmar TEXT;
ALTER TABLE accounts_receivable ADD COLUMN IF NOT EXISTS por_confirmar_desde TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_ar_por_confirmar ON accounts_receivable (accionista_id) WHERE por_confirmar IS NOT NULL;
