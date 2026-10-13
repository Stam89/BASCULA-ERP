-- Venta al detalle: una venta puede identificar a una persona que ya existe
-- como agricultor o trabajador, sin copiar ni alterar el registro original.
-- La tabla solo guarda el vínculo con el cliente comercial usado por sales.
CREATE TABLE IF NOT EXISTS customer_directory_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  source_type VARCHAR(30) NOT NULL,
  source_key TEXT NOT NULL,
  source_name VARCHAR(180) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_directory_links_source_type_chk
    CHECK (source_type IN ('FARMER', 'ADMIN_STAFF', 'WORKER')),
  UNIQUE (source_type, source_key)
);

CREATE INDEX IF NOT EXISTS idx_customer_directory_links_customer
  ON customer_directory_links (customer_id);

-- DOWN (manual): DROP TABLE IF EXISTS customer_directory_links;
