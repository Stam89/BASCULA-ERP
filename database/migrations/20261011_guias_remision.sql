-- Guías de Remisión (formato legal EC) del módulo de Ventas. Tabla NUEVA e
-- independiente: no toca sales_orders ni facturas. CERO RUPTURAS.
CREATE TABLE IF NOT EXISTS guias_remision (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  accionista_id         UUID,
  numero                VARCHAR(40),
  -- Bloque 1: datos de traslado
  fecha_emision         DATE,
  fecha_inicio_traslado DATE,
  fecha_llegada         DATE,
  punto_partida         TEXT,
  motivo_traslado       TEXT,
  -- Bloque 2: destinatario
  customer_id           UUID REFERENCES customers(id),
  destinatario_nombre   TEXT,
  destinatario_ruc      TEXT,
  destino_direccion     TEXT,
  -- Bloque 3: transportista
  transportista_nombre  TEXT,
  transportista_ruc     TEXT,
  transportista_placa   TEXT,
  -- Bloque 4: bienes transportados [{cantidad, unidad, descripcion}]
  items                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Bloque 5: adicionales
  observaciones         TEXT,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guias_remision_acc ON guias_remision (accionista_id, created_at DESC);
