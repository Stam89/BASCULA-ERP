-- Integridad contable e idempotencia para Transporte y Cosechadora.
-- Aditiva: no modifica importes ni estados historicos.

ALTER TABLE campo_nomina_pagos
  ADD COLUMN IF NOT EXISTS cuenta_id uuid REFERENCES campo_cuentas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS movimiento_id uuid REFERENCES campo_movimientos(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS campo_nomina_pagos_movimiento_uniq
  ON campo_nomina_pagos (movimiento_id)
  WHERE movimiento_id IS NOT NULL;

-- Identidad estable para partes generados desde Bascula. Los historicos unicos
-- se enlazan; si una instalacion ya contiene duplicados, se conservan intactos.
ALTER TABLE campo_partes ADD COLUMN IF NOT EXISTS origen_uid varchar(300);

WITH referencias_unicas AS (
  SELECT observaciones
  FROM campo_partes
  WHERE origen = 'bascula' AND observaciones IS NOT NULL
  GROUP BY observaciones
  HAVING COUNT(*) = 1
)
UPDATE campo_partes p
SET origen_uid = p.observaciones
FROM referencias_unicas u
WHERE p.origen = 'bascula'
  AND p.observaciones = u.observaciones
  AND p.origen_uid IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS campo_partes_origen_uid_uniq
  ON campo_partes (origen_uid)
  WHERE origen_uid IS NOT NULL;
