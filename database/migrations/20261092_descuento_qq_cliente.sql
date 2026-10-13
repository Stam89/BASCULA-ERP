-- Venta Detalle por QQ: el quintal se cobra con un descuento en DÓLARES (no un centavo)
-- que depende del cliente: $1 o $2 menos, por ejemplo.
--  · venta_detalle_config.descuento_qq_defecto: el de Consumidor Final y clientes sin el suyo.
--  · customers.descuento_qq: el de ese cliente (NULL = usa el por defecto).
-- Aditiva e idempotente: no cambia ventas ya registradas.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS descuento_qq NUMERIC(10,2);
DO $$ BEGIN
  ALTER TABLE customers ADD CONSTRAINT customers_descuento_qq_no_negativo CHECK (descuento_qq IS NULL OR descuento_qq >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS venta_detalle_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  descuento_qq_defecto NUMERIC(10,2) NOT NULL DEFAULT 1.00 CHECK (descuento_qq_defecto >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO venta_detalle_config (id, descuento_qq_defecto) VALUES (1, 1.00) ON CONFLICT (id) DO NOTHING;

-- DOWN (manual):
--   ALTER TABLE customers DROP COLUMN IF EXISTS descuento_qq;
--   DROP TABLE IF EXISTS venta_detalle_config;
