-- Hoja de vida tecnica de la flota de Transporte y Cosechadora.
-- Migracion aditiva: no modifica ni elimina movimientos existentes.

CREATE TABLE IF NOT EXISTS campo_mantenimientos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  activo_id       UUID NOT NULL REFERENCES campo_activos(id),
  tipo            VARCHAR(24) NOT NULL CHECK (tipo IN (
                    'CAMBIO_ACEITE', 'PREVENTIVO', 'CORRECTIVO',
                    'REPUESTO', 'LLANTAS', 'INSPECCION', 'OTRO'
                  )),
  componente      VARCHAR(180),
  detalle         TEXT NOT NULL,
  lectura         NUMERIC(14,2) CHECK (lectura IS NULL OR lectura >= 0),
  unidad_lectura  VARCHAR(10) CHECK (unidad_lectura IS NULL OR unidad_lectura IN ('KM', 'HORAS')),
  proxima_fecha   DATE,
  proxima_lectura NUMERIC(14,2) CHECK (proxima_lectura IS NULL OR proxima_lectura >= 0),
  proveedor       VARCHAR(180),
  factura         VARCHAR(80),
  costo           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),
  cuenta_id       UUID REFERENCES campo_cuentas(id),
  movimiento_id   UUID UNIQUE REFERENCES campo_movimientos(id),
  observaciones   TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((lectura IS NULL AND unidad_lectura IS NULL) OR (lectura IS NOT NULL AND unidad_lectura IS NOT NULL)),
  CHECK (proxima_lectura IS NULL OR unidad_lectura IS NOT NULL),
  CHECK ((costo = 0 AND cuenta_id IS NULL AND movimiento_id IS NULL) OR
         (costo > 0 AND cuenta_id IS NOT NULL AND movimiento_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_campo_mant_activo_fecha
  ON campo_mantenimientos (activo_id, fecha DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campo_mant_proxima_fecha
  ON campo_mantenimientos (proxima_fecha)
  WHERE proxima_fecha IS NOT NULL;

-- Recupera como historial basico los egresos de mantenimiento ya existentes.
-- Es idempotente gracias al UNIQUE de movimiento_id.
INSERT INTO campo_mantenimientos
  (fecha, activo_id, tipo, detalle, costo, cuenta_id, movimiento_id, created_by, created_at)
SELECT m.fecha, m.activo_id, 'CORRECTIVO', COALESCE(NULLIF(trim(m.concepto), ''), 'Mantenimiento registrado'),
       m.monto, m.cuenta_id, m.id, m.created_by, m.created_at
  FROM campo_movimientos m
  JOIN campo_categorias_gasto cat ON cat.id = m.categoria_id
 WHERE cat.nombre = 'REPARACION_MANT'
   AND m.signo = 'salida'
   AND m.activo_id IS NOT NULL
ON CONFLICT (movimiento_id) DO NOTHING;
