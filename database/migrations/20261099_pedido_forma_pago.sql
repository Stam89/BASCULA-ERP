-- FORMA DE PAGO DEL PEDIDO (pedido del dueño 2026-10-14): se escoge al TOMAR el pedido (efectivo, banco o
-- crédito) y la Cola de Despachos la trae puesta al despachar (se puede cambiar si el cliente cambia).
-- Aditiva e idempotente. NULL = pedido viejo (se despacha como antes: efectivo por defecto).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS payment_method text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_orders_payment_method_chk') THEN
    ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_payment_method_chk
      CHECK (payment_method IS NULL OR payment_method IN ('CASH','TRANSFER','CARD','CHECK','CREDIT'));
  END IF;
END $$;
