-- Cuenta consolidada de Transporte/Cosechadora.
-- Vincula una CxP con la misma persona del directorio de clientes y registra
-- compensaciones auditables sin borrar los cargos originales de CxC ni CxP.

ALTER TABLE campo_cxp
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES campo_clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campo_cxp_cliente
  ON campo_cxp (cliente_id) WHERE cliente_id IS NOT NULL;

-- Solo se enlazan coincidencias exactas normalizadas. El indice unico vigente
-- de campo_clientes evita que un mismo nombre normalizado sea ambiguo.
UPDATE campo_cxp p
   SET cliente_id = c.id
  FROM campo_clientes c
 WHERE p.cliente_id IS NULL
   AND lower(trim(p.acreedor)) = lower(trim(c.nombre));

CREATE TABLE IF NOT EXISTS campo_compensaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha          DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id     UUID NOT NULL REFERENCES campo_clientes(id),
  monto          NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  cxc_antes      NUMERIC(14,2) NOT NULL CHECK (cxc_antes >= 0),
  cxp_antes      NUMERIC(14,2) NOT NULL CHECK (cxp_antes >= 0),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campo_compensaciones_cliente
  ON campo_compensaciones (cliente_id, fecha DESC, created_at DESC);

ALTER TABLE campo_movimientos
  ADD COLUMN IF NOT EXISTS compensacion_id UUID REFERENCES campo_compensaciones(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_campo_mov_compensacion
  ON campo_movimientos (compensacion_id) WHERE compensacion_id IS NOT NULL;

-- DOWN (reversa manual; no ejecutar si ya existen compensaciones):
--   DROP INDEX IF EXISTS idx_campo_mov_compensacion;
--   ALTER TABLE campo_movimientos DROP COLUMN IF EXISTS compensacion_id;
--   DROP TABLE IF EXISTS campo_compensaciones;
--   DROP INDEX IF EXISTS idx_campo_cxp_cliente;
--   ALTER TABLE campo_cxp DROP COLUMN IF EXISTS cliente_id;
--   DELETE FROM schema_migrations WHERE filename = '20261090_campo_cuentas_consolidadas.sql';
