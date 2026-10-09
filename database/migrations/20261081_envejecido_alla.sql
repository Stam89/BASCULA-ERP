-- Envejecido/selección: lo que el proveedor ya procesó pero QUEDÓ ALLÁ (no se trajo a la piladora) — pedido del dueño 2026-10-08.
-- Cada proveedor externo tiene una bodega propia («Allá: <proveedor>», tipo EXTERNO): lo que queda allá sigue siendo del
-- socio (cuenta en su inventario y su balance) pero no se puede despachar desde la piladora hasta traerlo.
-- Aditiva e idempotente.
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS external_provider_id UUID REFERENCES external_providers(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_external_provider ON warehouses (external_provider_id) WHERE external_provider_id IS NOT NULL;

-- Cuánto de cada salida del lote quedó allá al registrar el informe.
ALTER TABLE selection_batch_outputs ADD COLUMN IF NOT EXISTS qty_alla NUMERIC(14,3) NOT NULL DEFAULT 0;

-- Cada viaje que trae producto del proveedor a la piladora.
CREATE TABLE IF NOT EXISTS selection_traidas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accionista_id UUID NOT NULL REFERENCES accionistas(id),
  provider_id   UUID NOT NULL REFERENCES external_providers(id),
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  items         JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_qq      NUMERIC(14,3) NOT NULL DEFAULT 0,
  notes         TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_selection_traidas_acc ON selection_traidas (accionista_id, fecha);
