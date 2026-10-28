-- 🧮 Cuadre diario de la caja SIN cerrarla (mejora 5 de la caja, pedido del dueño 2026-10-28): cada día se cuentan
-- los billetes y monedas; si no cuadra, la diferencia se registra (faltante/sobrante con su motivo) y la caja queda
-- igual a lo contado. Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS cash_cuadres (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
  fecha            DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Guayaquil')::date),
  -- Cuántos de cada denominación: {"100": 0, "50": 1, "20": 3, …, "0.25": 4}
  conteo           JSONB NOT NULL DEFAULT '{}'::jsonb,
  contado          NUMERIC(14,2) NOT NULL,
  sistema          NUMERIC(14,2) NOT NULL,
  diferencia       NUMERIC(14,2) NOT NULL,
  motivo           TEXT,
  cash_movement_id UUID REFERENCES cash_movements(id),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_cuadres_register ON cash_cuadres (cash_register_id, created_at DESC);
