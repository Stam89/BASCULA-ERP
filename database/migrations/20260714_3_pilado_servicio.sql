-- CEYRO (la piladora) es el accionista principal y presta el servicio de
-- secado + pilado a los otros accionistas, cobrando por quintal. Cada servicio
-- es un ingreso/cuenta por cobrar para CEYRO y una cuenta por pagar para el
-- accionista al que se le procesó.

-- 1) Renombra el accionista por defecto a CEYRO (si aún es el nombre inicial).
UPDATE accionistas
SET name = 'CEYRO', code = 'CEYRO'
WHERE id = '00000000-0000-0000-0000-000000000001'
  AND name = 'Accionista 1';

-- 2) Cuentas por pagar entre accionistas: el que debe puede ser otro accionista
-- (no un agricultor), así que farmer_id deja de ser obligatorio y se agregan
-- campos de referencia.
ALTER TABLE accounts_payable ALTER COLUMN farmer_id DROP NOT NULL;
ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS reference_type VARCHAR(60);
ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS reference_id UUID;
ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS description TEXT;

-- 3) Registro de los servicios de pilado (secado + pilado) entre accionistas.
CREATE TABLE IF NOT EXISTS pilado_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_date DATE NOT NULL DEFAULT CURRENT_DATE,
  provider_accionista_id UUID NOT NULL REFERENCES accionistas(id),   -- CEYRO
  client_accionista_id UUID NOT NULL REFERENCES accionistas(id),     -- accionista servido
  lot_id UUID REFERENCES lots(id),
  quintals NUMERIC(14,3) NOT NULL DEFAULT 0,
  rate_per_qq NUMERIC(12,4) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  receivable_id UUID REFERENCES accounts_receivable(id),
  payable_id UUID REFERENCES accounts_payable(id),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pilado_services_provider ON pilado_services(provider_accionista_id);
CREATE INDEX IF NOT EXISTS idx_pilado_services_client ON pilado_services(client_accionista_id);
CREATE INDEX IF NOT EXISTS idx_pilado_services_date ON pilado_services(service_date);
