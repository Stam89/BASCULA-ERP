-- FASE F-B — Tarifario dinamico de servicios (Pilado/Secado/Flete) por socio y fecha.
-- Aditivo: nueva tabla. No altera pilado_services ni datos existentes.
CREATE TABLE IF NOT EXISTS tarifario_servicio (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  socio_id UUID NOT NULL REFERENCES accionistas(id),
  servicio VARCHAR(20) NOT NULL DEFAULT 'PILADO',
  precio_por_qq NUMERIC(12,4) NOT NULL,
  fecha_vigencia DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tarifario_servicio_chk CHECK (servicio IN ('PILADO','SECADO','FLETE')),
  CONSTRAINT tarifario_precio_nonneg CHECK (precio_por_qq >= 0)
);
CREATE INDEX IF NOT EXISTS idx_tarifario_lookup ON tarifario_servicio (socio_id, servicio, fecha_vigencia);
