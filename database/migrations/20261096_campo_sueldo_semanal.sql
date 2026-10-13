-- Sueldo semanal fijo para los trabajadores de Transporte y Cosechadora.
-- Aditiva e idempotente: quien tenga sueldo_semanal = 0 conserva el pago por
-- produccion (QQ, viaje o dia) que ya existia.

ALTER TABLE campo_operadores
  ADD COLUMN IF NOT EXISTS cargo varchar(80),
  ADD COLUMN IF NOT EXISTS sueldo_semanal numeric(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campo_operadores_sueldo_semanal_chk') THEN
    ALTER TABLE campo_operadores
      ADD CONSTRAINT campo_operadores_sueldo_semanal_chk CHECK (sueldo_semanal >= 0);
  END IF;
END $$;

ALTER TABLE campo_nomina_pagos
  ADD COLUMN IF NOT EXISTS operador_id uuid REFERENCES campo_operadores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS es_sueldo_semanal boolean NOT NULL DEFAULT false;

-- Vincula historicos solo cuando el nombre identifica a un unico trabajador.
WITH nombres_unicos AS (
  SELECT lower(btrim(nombre)) AS nombre_normalizado, min(id::text)::uuid AS operador_id
  FROM campo_operadores
  GROUP BY lower(btrim(nombre))
  HAVING count(*) = 1
)
UPDATE campo_nomina_pagos p
SET operador_id = n.operador_id
FROM nombres_unicos n
WHERE p.operador_id IS NULL
  AND lower(btrim(p.operador)) = n.nombre_normalizado;

-- Un sueldo fijo solo puede pagarse una vez por trabajador y semana. Al anular
-- el pago, el indice deja libre el periodo para poder procesarlo nuevamente.
CREATE UNIQUE INDEX IF NOT EXISTS campo_nomina_sueldo_semanal_uniq
  ON campo_nomina_pagos (operador_id, desde, hasta)
  WHERE es_sueldo_semanal = true AND anulado_at IS NULL;

