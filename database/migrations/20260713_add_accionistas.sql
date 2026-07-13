-- Segrega inventario, tickets de báscula, ventas y liquidaciones por accionista,
-- manteniendo una sola instalación/base de datos para los 3 socios del negocio.

CREATE TABLE IF NOT EXISTS accionistas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(120) NOT NULL,
  code VARCHAR(40) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_accionistas (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accionista_id UUID NOT NULL REFERENCES accionistas(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, accionista_id)
);

-- Accionista por defecto para no romper datos existentes.
INSERT INTO accionistas (id, name, code)
VALUES ('00000000-0000-0000-0000-000000000001', 'Accionista 1', 'ACC-1')
ON CONFLICT (id) DO NOTHING;

-- Da acceso al accionista por defecto a todos los usuarios ya existentes.
INSERT INTO user_accionistas (user_id, accionista_id)
SELECT u.id, '00000000-0000-0000-0000-000000000001'
FROM users u
ON CONFLICT DO NOTHING;

ALTER TABLE lots ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
ALTER TABLE weighing_tickets ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
ALTER TABLE mobile_synced_tickets ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
ALTER TABLE liquidations ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
ALTER TABLE farmer_advances ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
ALTER TABLE processing_batches ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);

UPDATE lots SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;
UPDATE weighing_tickets SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;
UPDATE inventory_movements SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;
UPDATE sales SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;
UPDATE liquidations SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;
UPDATE farmer_advances SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;
UPDATE processing_batches SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;
-- mobile_synced_tickets se deja NULL a propósito: los tickets importados desde
-- Firebase se asignan manualmente al vincular con el agricultor (ver mobile-tickets.ts).

CREATE INDEX IF NOT EXISTS idx_lots_accionista_id ON lots(accionista_id);
CREATE INDEX IF NOT EXISTS idx_weighing_tickets_accionista_id ON weighing_tickets(accionista_id);
CREATE INDEX IF NOT EXISTS idx_mobile_synced_tickets_accionista_id ON mobile_synced_tickets(accionista_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_accionista_id ON inventory_movements(accionista_id);
CREATE INDEX IF NOT EXISTS idx_sales_accionista_id ON sales(accionista_id);
CREATE INDEX IF NOT EXISTS idx_liquidations_accionista_id ON liquidations(accionista_id);
CREATE INDEX IF NOT EXISTS idx_farmer_advances_accionista_id ON farmer_advances(accionista_id);
CREATE INDEX IF NOT EXISTS idx_processing_batches_accionista_id ON processing_batches(accionista_id);

-- inventory_stock es una vista agregada sobre inventory_movements; se agrega
-- accionista_id para que el inventario se pueda consultar por separado.
-- Se recrea (en vez de CREATE OR REPLACE) porque agregar una columna en medio
-- de la lista de SELECT no es compatible con el reemplazo de vista de Postgres.
DROP VIEW IF EXISTS inventory_stock;
CREATE VIEW inventory_stock AS
SELECT
  product_id,
  warehouse_id,
  lot_id,
  ownership,
  accionista_id,
  SUM(quantity) AS quantity
FROM inventory_movements
GROUP BY product_id, warehouse_id, lot_id, ownership, accionista_id;
