-- Bajada de carro (descarga del camión en báscula).
-- Cada ticket de báscula paga QQ × tarifa a quien bajó el carro (campo
-- `bajadaX` que manda la app de báscula). Se registra como una labor de
-- CUADRILLA (origen 'BASCULA', una por ticket) para que aparezca en
-- Nómina → Pagos junto con lo demás de esa persona y se pague por Caja.
-- Semana de pago: sábado a viernes; lo no pagado se acumula a la siguiente.

-- Nombre corregido/puesto a mano cuando el ticket no lo trae ('__NO__' = no se paga).
ALTER TABLE mobile_synced_tickets ADD COLUMN IF NOT EXISTS bajada_manual VARCHAR(80);

-- Desde qué fecha se cuentan los tickets (lo anterior ya se pagó por fuera).
CREATE TABLE IF NOT EXISTS bajada_carro_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  desde DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
INSERT INTO bajada_carro_config (id, desde) VALUES (1, DATE '2026-09-26')
ON CONFLICT (id) DO NOTHING;

-- Actividad de cuadrilla con la tarifa (editable en Configuración → Actividades y tarifas).
INSERT INTO cuadrilla_activities (name, unit_rate, is_active, categoria)
SELECT 'BAJADA DE CARRO', 0.10, true, 'GENERAL'
WHERE NOT EXISTS (SELECT 1 FROM cuadrilla_activities WHERE upper(btrim(name)) = 'BAJADA DE CARRO');

-- Un solo registro de bajada por ticket.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuadrilla_auto_bascula
  ON cuadrilla_entries (referencia_id) WHERE origen = 'BASCULA';
