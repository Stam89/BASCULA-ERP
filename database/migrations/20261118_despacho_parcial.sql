-- 🚚 DESPACHO PARCIAL (pedido del dueño 2026-10-23: «a veces el camión no se lleva todo el pedido»). Al despachar se
-- indica cuánto cargó el camión; lo que no subió queda como un pedido SALDO (PED-…-S1) del mismo cliente, ya preparado,
-- en la Cola de Despachos. `parent_order_id` = el pedido original (raíz). Aditiva e idempotente.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS parent_order_id UUID REFERENCES sales_orders(id);
CREATE INDEX IF NOT EXISTS sales_orders_parent_idx ON sales_orders (parent_order_id) WHERE parent_order_id IS NOT NULL;
