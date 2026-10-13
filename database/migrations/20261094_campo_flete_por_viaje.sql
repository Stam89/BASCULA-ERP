-- Transporte: FLETE POR VIAJE (pedido del dueño 2026-10-13). A algunos clientes se les cobra el
-- viaje completo cuando el carro no llevó los QQ que debía: el cobro del parte es un monto fijo
-- por viaje en vez de QQ × precio. Tarifa por viaje general y propia de cada cliente (NULL = no aplica).
-- Aditiva e idempotente.
ALTER TABLE campo_clientes ADD COLUMN IF NOT EXISTS tarifa_flete_viaje NUMERIC(12,2);
DO $$ BEGIN
  ALTER TABLE campo_clientes ADD CONSTRAINT campo_clientes_flete_viaje_positivo CHECK (tarifa_flete_viaje IS NULL OR tarifa_flete_viaje > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS campo_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nombre_operacion VARCHAR(60) NOT NULL DEFAULT 'Campo',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO campo_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE campo_config ADD COLUMN IF NOT EXISTS tarifa_flete_viaje NUMERIC(12,2);

-- DOWN (manual):
--   ALTER TABLE campo_clientes DROP COLUMN IF EXISTS tarifa_flete_viaje;
--   ALTER TABLE campo_config DROP COLUMN IF EXISTS tarifa_flete_viaje;
