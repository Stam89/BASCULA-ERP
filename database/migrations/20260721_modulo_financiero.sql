-- MÓDULO FINANCIERO
--
-- El balance, el estado de resultados y el flujo de caja se CALCULAN a partir
-- de lo que el sistema ya registra (liquidaciones, ventas, cuentas, caja,
-- inventario, producción). No se digita nada dos veces y no se crean tablas
-- de saldos que se puedan desfasar de la operación.
--
-- Solo hacen falta dos cosas que hoy no existen en ninguna parte:
--   1) Los datos contables del activo fijo (los equipos ya están registrados,
--      pero sin costo ni fecha de compra no se pueden depreciar).
--   2) Los parámetros contables (capital aportado, vida útil por defecto y
--      precio de referencia para valorizar inventario sin costo histórico).

-- ── 1. Activos fijos: se AMPLÍA la tabla equipment que ya existe ────────────
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id),
  ADD COLUMN IF NOT EXISTS acquisition_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acquisition_date DATE,
  ADD COLUMN IF NOT EXISTS useful_life_years INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS salvage_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_depreciable BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN equipment.acquisition_cost IS 'Costo de adquisición; base de la depreciación en línea recta.';
COMMENT ON COLUMN equipment.useful_life_years IS 'Vida útil en años (Ecuador: maquinaria 10, vehículos 5, edificios 20).';

CREATE INDEX IF NOT EXISTS idx_equipment_accionista ON equipment(accionista_id);

-- ── 2. Parámetros contables (una fila por accionista) ──────────────────────
CREATE TABLE IF NOT EXISTS financial_settings (
  accionista_id UUID PRIMARY KEY REFERENCES accionistas(id) ON DELETE CASCADE,
  -- Capital aportado por el socio al negocio.
  capital_social NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Resultados de ejercicios anteriores a la puesta en marcha del sistema.
  resultados_acumulados NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Fecha desde la que el sistema es la fuente contable (corte de apertura).
  fecha_inicio_contable DATE,
  -- Precio de referencia por quintal para valorizar el inventario cuando un
  -- ingreso todavía no tiene precio de compra (aún sin liquidar).
  precio_referencia_qq NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cada accionista arranca con su fila en cero: el balance funciona desde el
-- primer día y los valores se ajustan luego en Configuración.
INSERT INTO financial_settings (accionista_id)
SELECT id FROM accionistas
ON CONFLICT (accionista_id) DO NOTHING;
