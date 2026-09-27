-- Saco elegido por el CLIENTE para el SOBRANTE de una línea de pedido (p. ej.
-- 6 QQ en 98 LB sobran 12 lb: el cliente pide ponerlas en sacos de 10 LB).
-- NULL = automático (el saco más pequeño de la marca donde cabe el sobrante).
-- Aditiva e idempotente: los pedidos existentes quedan en automático.
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS sobrante_saco_lb NUMERIC(8,2);
