-- Anular una venta YA despachada (pedido del dueño, 2026-10-08): el pedido guarda quién, cuándo y por qué.
-- Aditiva e idempotente.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS anulado_motivo TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS anulado_by UUID;
