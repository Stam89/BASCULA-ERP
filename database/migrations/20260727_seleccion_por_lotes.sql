-- SELECCIÓN/ENVEJECIDO COMO PROCESO POR LOTES (DOS FASES, VARIOS PRODUCTOS)
--
-- El modelo anterior (selection_services: 1 producto entra, el mismo sale con
-- merma, todo de una) no refleja la realidad:
--   · Se mandan a selectar VARIOS productos terminados (0.11, corriente,
--     arrocillo 3/4, arrocillo fino) que salen de la bodega de producto
--     terminado.
--   · El proceso TARDA. Primero se registra lo que se manda a selectar; días
--     después, lo que regresa.
--   · Lo que regresa son VARIOS productos distintos: 0.11 selectado, arrocillo
--     3/4, arrocillo fino, polvillo y rechazo.
--
-- Por eso se modela como un LOTE con líneas de entrada y de salida, y dos
-- momentos: se abre (IN_PROCESS, baja las entradas del inventario y genera la
-- cuenta por pagar sobre lo que sale) y se cierra (COMPLETED, ingresa las
-- salidas). El costo se cobra sobre los QQ enviados (lo que sale).

-- La tabla vieja está vacía (nunca se usó); se reemplaza por el modelo por lotes.
DROP TABLE IF EXISTS selection_services;

CREATE TABLE IF NOT EXISTS selection_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_number VARCHAR(60) NOT NULL UNIQUE,             -- SEL-XXXXX
  accionista_id UUID NOT NULL REFERENCES accionistas(id),
  provider_id UUID NOT NULL REFERENCES external_providers(id),
  service_type VARCHAR(20) NOT NULL,                    -- SELECCION | ENVEJECIMIENTO
  warehouse_id UUID NOT NULL REFERENCES warehouses(id), -- bodega de producto terminado
  status VARCHAR(20) NOT NULL DEFAULT 'IN_PROCESS',     -- IN_PROCESS | COMPLETED | CANCELLED
  rate_per_qq NUMERIC(12,4) NOT NULL,
  input_qq NUMERIC(14,3) NOT NULL DEFAULT 0,            -- total enviado a selectar
  output_qq NUMERIC(14,3) NOT NULL DEFAULT 0,           -- total que regresó (al cerrar)
  merma_qq NUMERIC(14,3) NOT NULL DEFAULT 0,            -- input - output
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,          -- input_qq * rate_per_qq
  payable_id UUID REFERENCES accounts_payable(id),
  notes TEXT,
  service_date DATE NOT NULL DEFAULT CURRENT_DATE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT selection_batch_type CHECK (service_type IN ('SELECCION','ENVEJECIMIENTO')),
  CONSTRAINT selection_batch_status CHECK (status IN ('IN_PROCESS','COMPLETED','CANCELLED'))
);
CREATE INDEX IF NOT EXISTS idx_selection_batches_accionista ON selection_batches(accionista_id);
CREATE INDEX IF NOT EXISTS idx_selection_batches_status ON selection_batches(status);
CREATE INDEX IF NOT EXISTS idx_selection_batches_date ON selection_batches(service_date);

-- Lo que se manda a selectar (una línea por producto).
CREATE TABLE IF NOT EXISTS selection_batch_inputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES selection_batches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(14,3) NOT NULL,
  CONSTRAINT selection_input_positive CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_selection_inputs_batch ON selection_batch_inputs(batch_id);

-- Lo que regresa procesado (una línea por producto). is_reject marca el rechazo.
CREATE TABLE IF NOT EXISTS selection_batch_outputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES selection_batches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  quantity NUMERIC(14,3) NOT NULL,
  is_reject BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT selection_output_positive CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_selection_outputs_batch ON selection_batch_outputs(batch_id);

-- Productos de salida que hoy no existen en el catálogo pero el proceso genera.
-- Se agregan para que aparezcan en el selector; si ya existen no se tocan.
INSERT INTO products (code, name, product_type, unit) VALUES
  ('ARROZ-PILADO-011-SEL', '0.11 Selectado', 'FINISHED_GOOD', 'QQ'),
  ('RECHAZO', 'Rechazo', 'BYPRODUCT', 'QQ')
ON CONFLICT (code) DO NOTHING;
