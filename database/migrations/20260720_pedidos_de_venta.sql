-- Venta en dos tiempos, como la preventa de las distribuidoras (Coca-Cola):
-- primero se TOMA EL PEDIDO (una promesa: cliente + productos + precios, sin
-- mover inventario ni plata), y después se DESPACHA Y COBRA, momento en el que
-- nace la venta real (salida de inventario + caja o crédito).
--
-- El pedido guarda dos caras de cada línea: lo que pidió el cliente tal cual
-- (marca y presentación) y el producto de inventario que lo respalda, para que
-- el despacho no dependa de mapeos en la pantalla.
CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number VARCHAR(40) NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  accionista_id UUID REFERENCES accionistas(id),
  status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'CANCELLED')),
  delivery_date DATE,
  notes TEXT,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- La venta que nació de este pedido al despacharlo.
  sale_id UUID REFERENCES sales(id),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  -- Lo pedido tal cual (la marca que ve el cliente).
  product_id UUID NOT NULL REFERENCES products(id),
  presentation_id UUID,
  presentation_name VARCHAR(60),
  -- El producto de inventario que respalda la marca (lo que sale de bodega).
  inventory_product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,4) NOT NULL,
  total NUMERIC(14,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_accionista ON sales_orders(accionista_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_order ON sales_order_items(order_id);
