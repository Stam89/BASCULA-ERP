-- Refinamiento de la nómina de operadores de Campo:
--  (1) nueva unidad de tarifa '$ / Día' (DIA);
--  (2) registro de cada pago de nómina con el valor final y el motivo del ajuste.
-- Aditiva: no altera datos existentes (tarifas QQ/VIAJE y partes ya liquidados
-- quedan igual).

-- (1) Ampliar el CHECK de unidad para admitir 'DIA'.
ALTER TABLE campo_tarifas_operador DROP CONSTRAINT IF EXISTS campo_tarifas_operador_unidad_chk;
ALTER TABLE campo_tarifas_operador
  ADD CONSTRAINT campo_tarifas_operador_unidad_chk CHECK (unidad IN ('QQ','VIAJE','DIA'));

-- (2) Registro de pagos de nómina (valor sugerido, valor final, ajuste y motivo).
CREATE TABLE IF NOT EXISTS campo_nomina_pagos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operador       varchar(140) NOT NULL,
  activo_id      uuid REFERENCES campo_activos(id) ON DELETE SET NULL,
  unidad         varchar(10)  NOT NULL,
  base           numeric(14,4) NOT NULL DEFAULT 0,   -- qq / viajes / días
  tarifa         numeric(14,4),
  monto_sugerido numeric(14,2),
  monto          numeric(14,2) NOT NULL,             -- valor final pagado
  ajustado       boolean      NOT NULL DEFAULT false,
  motivo         text,
  desde          date,
  hasta          date,
  partes_count   integer      NOT NULL DEFAULT 0,
  created_by     uuid,
  created_at     timestamptz  NOT NULL DEFAULT now()
);

-- Enlace del parte al pago de nómina que lo liquidó.
ALTER TABLE campo_partes ADD COLUMN IF NOT EXISTS operador_pago_id uuid
  REFERENCES campo_nomina_pagos(id) ON DELETE SET NULL;
