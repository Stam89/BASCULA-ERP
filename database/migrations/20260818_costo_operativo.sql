-- FASE F-C — Costo operativo por corrida/lote (Modelo 2).
-- Aditivo: nueva tabla. No toca processing_batches, inventario ni Dashboard.
-- Registra el costo real de operar una corrida (luz, mantenimiento, mano de obra,
-- combustible, desgaste, otros) para calcular el costo por QQ producido de CEYRO.
CREATE TABLE IF NOT EXISTS costo_operativo (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  accionista_id UUID NOT NULL REFERENCES accionistas(id),
  processing_batch_id UUID REFERENCES processing_batches(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  qq_producidos NUMERIC(14,3) NOT NULL,
  luz NUMERIC(14,2) NOT NULL DEFAULT 0,
  mantenimiento NUMERIC(14,2) NOT NULL DEFAULT 0,
  mano_obra NUMERIC(14,2) NOT NULL DEFAULT 0,
  combustible NUMERIC(14,2) NOT NULL DEFAULT 0,
  desgaste NUMERIC(14,2) NOT NULL DEFAULT 0,
  otros NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT costo_operativo_qq_pos CHECK (qq_producidos > 0)
);
CREATE INDEX IF NOT EXISTS idx_costo_operativo_acc ON costo_operativo (accionista_id, fecha);
