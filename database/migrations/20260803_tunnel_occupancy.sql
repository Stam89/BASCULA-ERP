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

-- Tabla de informes de consumo de gas (histórico)
CREATE TABLE IF NOT EXISTS gas_consumption_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tunnel_number INTEGER NOT NULL CHECK (tunnel_number BETWEEN 1 AND 3),
  accionista_id UUID NOT NULL REFERENCES users(id),
  accionista_name VARCHAR(160) NOT NULL,
  gas_used NUMERIC(14,3) NOT NULL,
  signed_by UUID NOT NULL REFERENCES users(id),
  signed_by_name VARCHAR(160) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inicializar los 3 túneles como DISPONIBLES
INSERT INTO tunnel_status (tunnel_number, status, created_at, updated_at)
VALUES (1, 'DISPONIBLE', now(), now()),
       (2, 'DISPONIBLE', now(), now()),
       (3, 'DISPONIBLE', now(), now())
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_gas_reports_tunnel_date ON gas_consumption_reports(tunnel_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gas_reports_accionista ON gas_consumption_reports(accionista_id);
