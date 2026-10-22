-- 📴 PEDIDOS SIN CONEXIÓN (pedido del dueño 2026-10-22): en un apagón (o con la PC hibernando) el personal toma el
-- pedido en el celular y se envía solo cuando vuelve el servidor. Cada pedido trae una llave única del celular
-- (client_key): si el envío se repite (se cortó la respuesta), el servidor devuelve el MISMO pedido y no crea otro.
-- tomado_sin_conexion_at = cuándo se tomó en el celular. Aditiva e idempotente.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS client_key TEXT;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tomado_sin_conexion_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_client_key_uq ON sales_orders (client_key) WHERE client_key IS NOT NULL;
