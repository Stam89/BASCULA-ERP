-- Reservas de túneles de secado y reportes de gas firmados por accionista.
-- Evita que dos accionistas usen el mismo túnel al mismo tiempo y deja constancia
-- del consumo de gas asociado a cada reserva.

CREATE TABLE IF NOT EXISTS tunnel_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tunnel_number INTEGER NOT NULL CHECK (tunnel_number BETWEEN 1 AND 3),
  accionista_id UUID REFERENCES users(id) ON DELETE SET NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tunnel_reservation_status_valid CHECK (status IN ('ACTIVE', 'COMPLETED'))
);

CREATE TABLE IF NOT EXISTS gas_consumption_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tunnel_number INTEGER NOT NULL CHECK (tunnel_number BETWEEN 1 AND 3),
  reservation_id UUID NOT NULL REFERENCES tunnel_reservations(id) ON DELETE CASCADE,
  gas_used NUMERIC(14,3) NOT NULL DEFAULT 0,
  last_accionista_id UUID REFERENCES users(id) ON DELETE SET NULL,
  accionista_name VARCHAR(140),
  signed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  signed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gas_consumption_positive CHECK (gas_used >= 0)
);

-- Índices para búsquedas frecuentes por túnel, accionista, fecha y reserva.
CREATE INDEX IF NOT EXISTS idx_tunnel_reservations_tunnel ON tunnel_reservations(tunnel_number);
CREATE INDEX IF NOT EXISTS idx_tunnel_reservations_accionista ON tunnel_reservations(accionista_id);
CREATE INDEX IF NOT EXISTS idx_tunnel_reservations_start_date ON tunnel_reservations(start_date DESC);
CREATE INDEX IF NOT EXISTS idx_gas_consumption_reports_tunnel ON gas_consumption_reports(tunnel_number);
CREATE INDEX IF NOT EXISTS idx_gas_consumption_reports_reservation ON gas_consumption_reports(reservation_id);
