-- 🚚 El saldo de un despacho parcial YA ESTÁ COBRADO (pedido del dueño 2026-10-23: «el cobro al cliente déjalo como
-- estaba, así no se lleven todo el producto»). El pedido original se vende y cobra completo; el saldo (PED-…-S1) es solo
-- la ENTREGA pendiente: sin cuenta por cobrar y, al despacharlo, sin venta ni cobro. Aditiva e idempotente.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS ya_cobrado BOOLEAN NOT NULL DEFAULT false;
