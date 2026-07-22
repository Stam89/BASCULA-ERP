-- SELECCIÓN Y ENVEJECIMIENTO DE PRODUCTO TERMINADO
--
-- El arroz pilado a veces sale con impureza. Todos los accionistas mandan su
-- producto terminado a SELECTAR (una persona externa lo limpia y le quita las
-- impurezas). Solo el accionista que envejece manda además a ENVEJECER. Ambos
-- son servicios que cobra una persona ajena al negocio, por quintal.
--
-- Cómo se mueve la plata y el inventario en cada servicio:
--   · El producto SALE del inventario (movimiento OUT) por los QQ enviados.
--   · Lo limpio REINGRESA (movimiento IN); como se le quitó impureza, puede
--     volver menos: la diferencia queda como MERMA (baja neta del inventario).
--   · El costo (QQ enviados × tarifa) se registra como una CUENTA POR PAGAR a
--     la persona externa. No sale de caja hasta que se le pague en "Por Pagar".
--
-- El costo (1.25 selección / 3.5 envejecido) se cobra sobre lo que SALE, y el
-- envejecido se cobra EN LUGAR de la selección (no se suman). Por eso cada
-- servicio es de un solo tipo con una sola tarifa.

-- ── 1. Quién puede envejecer ────────────────────────────────────────────────
-- Regla del negocio: solo un accionista envejece. Se marca con una bandera en
-- vez de amarrar el código a un nombre; así se administra desde Configuración.
ALTER TABLE accionistas ADD COLUMN IF NOT EXISTS puede_envejecer BOOLEAN NOT NULL DEFAULT false;

UPDATE accionistas SET puede_envejecer = true
WHERE puede_envejecer = false AND (name ILIKE '%stalyn%' OR code ILIKE '%stalyn%');

-- ── 2. Personas externas que prestan el servicio ────────────────────────────
CREATE TABLE IF NOT EXISTS external_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(160) NOT NULL,
  identification VARCHAR(60),
  phone VARCHAR(40),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_providers_name ON external_providers (lower(name));

-- ── 3. Tarifas por defecto (una sola fila global, editable) ─────────────────
-- Cada servicio guarda además la tarifa que usó (rate_per_qq), así el historial
-- no se altera si luego se cambia la tarifa por defecto.
CREATE TABLE IF NOT EXISTS selection_rates (
  singleton BOOLEAN PRIMARY KEY DEFAULT true,
  seleccion_rate NUMERIC(12,4) NOT NULL DEFAULT 1.25,
  envejecimiento_rate NUMERIC(12,4) NOT NULL DEFAULT 3.5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT selection_rates_single_row CHECK (singleton)
);
INSERT INTO selection_rates (singleton) VALUES (true) ON CONFLICT DO NOTHING;

-- ── 4. Servicios de selección / envejecimiento ──────────────────────────────
CREATE TABLE IF NOT EXISTS selection_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_number VARCHAR(60) NOT NULL UNIQUE,           -- SEL-XXXXX
  service_date DATE NOT NULL DEFAULT CURRENT_DATE,
  accionista_id UUID NOT NULL REFERENCES accionistas(id),   -- dueño del producto
  provider_id UUID NOT NULL REFERENCES external_providers(id),
  service_type VARCHAR(20) NOT NULL,                    -- SELECCION | ENVEJECIMIENTO
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  lot_id UUID REFERENCES lots(id),
  ownership ownership_type NOT NULL DEFAULT 'OWNED',
  input_qq NUMERIC(14,3) NOT NULL,                      -- lo que sale del inventario
  output_qq NUMERIC(14,3) NOT NULL,                     -- lo limpio que reingresa
  merma_qq NUMERIC(14,3) NOT NULL DEFAULT 0,            -- input - output (impureza)
  rate_per_qq NUMERIC(12,4) NOT NULL,
  total_cost NUMERIC(14,2) NOT NULL,                    -- input_qq × rate_per_qq
  payable_id UUID REFERENCES accounts_payable(id),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT selection_qq_positive CHECK (input_qq > 0 AND output_qq > 0 AND output_qq <= input_qq),
  CONSTRAINT selection_type_valid CHECK (service_type IN ('SELECCION','ENVEJECIMIENTO'))
);
CREATE INDEX IF NOT EXISTS idx_selection_services_accionista ON selection_services(accionista_id);
CREATE INDEX IF NOT EXISTS idx_selection_services_date ON selection_services(service_date);
CREATE INDEX IF NOT EXISTS idx_selection_services_provider ON selection_services(provider_id);
