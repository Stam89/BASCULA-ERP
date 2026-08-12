-- FASE 3.2 — Documento de compra (modulo Compras General).
-- Aditivo. purchases + purchase_items. Se ordena despues de suppliers (FK).
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_number VARCHAR(60) NOT NULL UNIQUE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  accionista_id UUID NOT NULL REFERENCES accionistas(id),
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_type VARCHAR(10) NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  invoice_number VARCHAR(60),
  receipt_photo_url VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT purchases_payment_type_chk CHECK (payment_type IN ('CASH','CREDIT')),
  CONSTRAINT purchases_total_nonneg CHECK (total_amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_purchases_accionista ON purchases(accionista_id, purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  item_type VARCHAR(10) NOT NULL,
  insumo_id UUID REFERENCES insumos(id),
  product_id UUID REFERENCES products(id),
  warehouse_id UUID REFERENCES warehouses(id),
  ownership VARCHAR(15) DEFAULT 'OWNED',
  description TEXT,
  quantity NUMERIC(14,3) NOT NULL,
  unit VARCHAR(20),
  unit_price NUMERIC(14,4) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT purchase_items_type_chk CHECK (item_type IN ('INSUMO','PRODUCT')),
  CONSTRAINT purchase_items_qty_pos CHECK (quantity > 0),
  CONSTRAINT purchase_items_target_chk CHECK (
    (item_type = 'INSUMO'  AND insumo_id IS NOT NULL AND product_id IS NULL) OR
    (item_type = 'PRODUCT' AND product_id IS NOT NULL AND warehouse_id IS NOT NULL AND insumo_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
