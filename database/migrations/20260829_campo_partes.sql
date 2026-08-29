-- Partes Diarios de Cosecha (reporte de operadores) de la operación Campo.
-- Registro diario del trabajo de cada cosechadora para cobrar a clientes y
-- controlar operadores. Aditiva; tabla nueva con prefijo campo_. DOWN al final.
CREATE TABLE IF NOT EXISTS campo_partes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Máquina = flota real (campo_activos). Operador se copia del activo pero es
  -- editable por parte (puede variar día a día).
  activo_id     UUID NOT NULL REFERENCES campo_activos(id),
  operador      VARCHAR(140),
  cliente       VARCHAR(160) NOT NULL,
  qq            NUMERIC(14,2) NOT NULL CHECK (qq > 0),
  observaciones TEXT,
  -- Estado del cobro del parte. 'por_cobrar' por defecto; 'cobrado' a futuro.
  estado        VARCHAR(20) NOT NULL DEFAULT 'por_cobrar' CHECK (estado IN ('por_cobrar', 'cobrado')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campo_partes_fecha  ON campo_partes (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_campo_partes_activo ON campo_partes (activo_id);

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS campo_partes;
--   DELETE FROM schema_migrations WHERE filename = '20260829_campo_partes.sql';
