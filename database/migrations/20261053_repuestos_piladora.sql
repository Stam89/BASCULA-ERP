-- REPUESTOS DE LA PLANTA (piezas que se desgastan: rodillos, piedras, cribas,
-- bandas, rodamientos…). Stock propio con mínimo para alertar la compra.
--   · ENTRADA: compra (puede pagarse con la caja abierta → egreso REPUESTOS).
--   · SALIDA: se usa/cambia en una máquina → queda en su hoja de vida.
--   · AJUSTE: conteo físico.
CREATE TABLE IF NOT EXISTS repuestos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(120) NOT NULL,
  referencia VARCHAR(80),                 -- código / medida / marca
  unidad VARCHAR(20) NOT NULL DEFAULT 'UNIDAD',
  stock NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_minimo NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  costo_unitario NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0), -- último costo de compra
  equipment_id UUID REFERENCES equipment(id) ON DELETE SET NULL,          -- máquina donde se usa (opcional)
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_repuestos_nombre_ref
  ON repuestos (lower(btrim(nombre)), lower(btrim(COALESCE(referencia, ''))));

CREATE TABLE IF NOT EXISTS repuesto_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repuesto_id UUID NOT NULL REFERENCES repuestos(id) ON DELETE CASCADE,
  tipo VARCHAR(12) NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA', 'AJUSTE')),
  cantidad NUMERIC(12,2) NOT NULL,        -- con signo: + entra, − sale
  costo_unitario NUMERIC(12,2),
  stock_resultante NUMERIC(12,2) NOT NULL,
  motivo TEXT,
  equipment_id UUID REFERENCES equipment(id) ON DELETE SET NULL,
  cash_movement_id UUID,                  -- egreso de Caja que pagó la compra
  maintenance_id UUID,                    -- registro en la hoja de vida de la máquina
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_repuesto_mov_repuesto ON repuesto_movimientos (repuesto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repuesto_mov_cash ON repuesto_movimientos (cash_movement_id) WHERE cash_movement_id IS NOT NULL;
