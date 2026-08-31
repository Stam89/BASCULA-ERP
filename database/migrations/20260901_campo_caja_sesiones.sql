-- Apertura / Arqueo / Cierre de Caja por turno (cuenta CAJA de Campo).
-- Una sesión ABIERTA a la vez; los ingresos/egresos (y transferencias) sobre la
-- cuenta CAJA se bloquean si no hay sesión abierta. Aditiva. DOWN al final.
CREATE TABLE IF NOT EXISTS campo_caja_sesiones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  fecha_apertura TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_cierre   TIMESTAMPTZ,
  saldo_inicial  NUMERIC(14,2) NOT NULL DEFAULT 0,
  saldo_teorico  NUMERIC(14,2),
  saldo_real     NUMERIC(14,2),
  diferencia     NUMERIC(14,2),
  estado         VARCHAR(10) NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA', 'CERRADA')),
  observaciones  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Garantiza una sola sesión ABIERTA a la vez (índice único parcial).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campo_caja_una_abierta
  ON campo_caja_sesiones ((estado)) WHERE estado = 'ABIERTA';
CREATE INDEX IF NOT EXISTS idx_campo_caja_ses_apertura ON campo_caja_sesiones (fecha_apertura DESC);

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_campo_caja_ses_apertura;
--   DROP INDEX IF EXISTS uniq_campo_caja_una_abierta;
--   DROP TABLE IF EXISTS campo_caja_sesiones;
--   DELETE FROM schema_migrations WHERE filename = '20260901_campo_caja_sesiones.sql';
