-- CARGOS AUTOMÁTICOS POR EMPAQUE (uso de sacos) que la MATRIZ (CEYRO) cobra a
-- los SOCIOS al despachar un pedido en presentaciones de 10/25/50 lb.
-- Todo aditivo: no toca ventas, cuentas ni caja existentes.

-- 1) Tarifas de empaque de la matriz. Una fila por accionista MATRIZ.
CREATE TABLE IF NOT EXISTS matriz_packaging_rates (
  accionista_id UUID PRIMARY KEY REFERENCES accionistas(id),
  precio_saco_10lb NUMERIC(14,2) NOT NULL DEFAULT 0,
  precio_saco_25lb NUMERIC(14,2) NOT NULL DEFAULT 0,
  precio_saco_50lb NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id),
  CONSTRAINT mpr_precios_no_neg CHECK (
    precio_saco_10lb >= 0 AND precio_saco_25lb >= 0 AND precio_saco_50lb >= 0
  )
);

-- Semilla en $0.00 para la(s) matriz(ces) existentes (precio aún por definir).
INSERT INTO matriz_packaging_rates (accionista_id)
SELECT id FROM accionistas WHERE tipo = 'MATRIZ'
ON CONFLICT (accionista_id) DO NOTHING;

-- 2) Cargo generado automáticamente al DESPACHAR. Enlaza la cuenta por cobrar
-- (CEYRO) con la cuenta por pagar (socio) para que el espejo funcione al pagarse.
CREATE TABLE IF NOT EXISTS matriz_packaging_charges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_accionista_id UUID NOT NULL REFERENCES accionistas(id),
  client_accionista_id UUID NOT NULL REFERENCES accionistas(id),
  order_id UUID REFERENCES sales_orders(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  monto NUMERIC(14,2) NOT NULL,
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  receivable_id UUID REFERENCES accounts_receivable(id),
  payable_id UUID REFERENCES accounts_payable(id),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mpc_monto_pos CHECK (monto > 0)
);
CREATE INDEX IF NOT EXISTS idx_mpc_provider ON matriz_packaging_charges (provider_accionista_id, fecha);
CREATE INDEX IF NOT EXISTS idx_mpc_client ON matriz_packaging_charges (client_accionista_id, fecha);
CREATE INDEX IF NOT EXISTS idx_mpc_order ON matriz_packaging_charges (order_id);
