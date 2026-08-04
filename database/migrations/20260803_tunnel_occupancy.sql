-- Tabla de ocupación actual de túneles (solo UN accionista por túnel)
CREATE TABLE IF NOT EXISTS tunnel_status (
  tunnel_number INTEGER PRIMARY KEY CHECK (tunnel_number BETWEEN 1 AND 3),
  status VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLE' CHECK (status IN ('DISPONIBLE', 'OCUPADO')),
  current_accionista_id UUID REFERENCES users(id),
  accionista_name VARCHAR(160),
  occupied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Adaptar la tabla de reportes de gas (ya existe desde la migración de reservas)
-- para que también funcione con la ocupación directa de túneles.
ALTER TABLE gas_consumption_reports
  ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS signed_by_name VARCHAR(160);

ALTER TABLE gas_consumption_reports
  ALTER COLUMN reservation_id DROP NOT NULL;

-- Inicializar los 3 túneles como DISPONIBLES
INSERT INTO tunnel_status (tunnel_number, status, created_at, updated_at)
VALUES (1, 'DISPONIBLE', now(), now()),
       (2, 'DISPONIBLE', now(), now()),
       (3, 'DISPONIBLE', now(), now())
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_gas_reports_tunnel_date ON gas_consumption_reports(tunnel_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gas_reports_accionista ON gas_consumption_reports(accionista_id);
