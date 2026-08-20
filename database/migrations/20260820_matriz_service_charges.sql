-- Cobro de la MATRIZ (CEYRO) a un SOCIO por servicio (Pilado/Secado/Flete/Mantenimiento/Otro).
-- Aditivo: enlaza la cuenta por cobrar (CEYRO) con la cuenta por pagar (socio) para
-- que el espejo funcione al pagarse despues. No toca cash_movements ni cuentas.
CREATE TABLE IF NOT EXISTS matriz_service_charges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_accionista_id UUID NOT NULL REFERENCES accionistas(id),
  client_accionista_id UUID NOT NULL REFERENCES accionistas(id),
  servicio VARCHAR(20) NOT NULL DEFAULT 'PILADO',
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  monto NUMERIC(14,2) NOT NULL,
  receivable_id UUID REFERENCES accounts_receivable(id),
  payable_id UUID REFERENCES accounts_payable(id),
  status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT msc_servicio_chk CHECK (servicio IN ('PILADO','SECADO','FLETE','MANTENIMIENTO','OTRO')),
  CONSTRAINT msc_monto_pos CHECK (monto > 0)
);
CREATE INDEX IF NOT EXISTS idx_msc_provider ON matriz_service_charges (provider_accionista_id, fecha);
CREATE INDEX IF NOT EXISTS idx_msc_client ON matriz_service_charges (client_accionista_id, fecha);
