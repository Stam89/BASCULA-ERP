-- Nómina de operadores de Campo (cosechadoras y transporte/fletes):
-- tarifas por operador+máquina y marca de pago al operador en los partes.
-- Aditiva: los partes existentes quedan operador_pagado_at NULL (no pagados aún).
CREATE TABLE IF NOT EXISTS campo_tarifas_operador (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operador    varchar(140) NOT NULL,
  activo_id   uuid NOT NULL REFERENCES campo_activos(id) ON DELETE CASCADE,
  tarifa      numeric(14,4) NOT NULL DEFAULT 0,
  unidad      varchar(10)  NOT NULL DEFAULT 'QQ',   -- 'QQ' | 'VIAJE'
  activo      boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT campo_tarifas_operador_unidad_chk CHECK (unidad IN ('QQ','VIAJE'))
);
-- Una tarifa por par (operador, máquina), sin distinguir mayúsculas en el nombre.
CREATE UNIQUE INDEX IF NOT EXISTS campo_tarifas_operador_uniq
  ON campo_tarifas_operador (lower(operador), activo_id);

-- Marca de liquidación al operador (independiente del cobro al cliente).
ALTER TABLE campo_partes ADD COLUMN IF NOT EXISTS operador_pagado_at   timestamptz;
ALTER TABLE campo_partes ADD COLUMN IF NOT EXISTS operador_pago_monto  numeric(14,2);
