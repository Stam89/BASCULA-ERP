-- Cuentas por Pagar propias de Transporte y Cosechadora (deudas operativas:
-- talleres, repuestos, gasolinera, pago a choferes, etc.). Independiente de la
-- piladora. El SALDO/estado se DERIVAN sumando los abonos (campo_movimientos con
-- cxp_id, signo 'salida'), igual que los servicios: no se guarda el saldo.
CREATE TABLE IF NOT EXISTS campo_cxp (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  acreedor    VARCHAR(160) NOT NULL,
  concepto    TEXT,
  monto       NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un abono de CxP = campo_movimiento 'salida' con cxp_id (sale de la Caja de
-- Transporte). Aditiva sobre la tabla existente.
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS cxp_id UUID REFERENCES campo_cxp(id);
CREATE INDEX IF NOT EXISTS idx_campo_mov_cxp ON campo_movimientos (cxp_id) WHERE cxp_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campo_cxp_fecha ON campo_cxp (fecha DESC);

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_campo_cxp_fecha;
--   DROP INDEX IF EXISTS idx_campo_mov_cxp;
--   ALTER TABLE campo_movimientos DROP COLUMN IF EXISTS cxp_id;
--   DROP TABLE IF EXISTS campo_cxp;
--   DELETE FROM schema_migrations WHERE filename = '20260908_campo_cxp.sql';
