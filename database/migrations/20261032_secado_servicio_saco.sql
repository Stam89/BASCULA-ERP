-- Tarifa de SECADO como servicio al cliente diferenciada por empaque de salida:
--   · secado_servicio_per_qq       → A granel / Directo a Producción (ya existía).
--   · secado_servicio_saco_per_qq  → En saco (NUEVA).
-- Aditiva e idempotente. Cada fila (maestro y overrides por socio) arranca con su
-- MISMA tarifa a granel, así ningún cobro cambia hasta que el admin la edite.

ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS secado_servicio_saco_per_qq NUMERIC(10,4);

UPDATE labor_rates
   SET secado_servicio_saco_per_qq = secado_servicio_per_qq
 WHERE secado_servicio_saco_per_qq IS NULL
    OR (secado_servicio_saco_per_qq = 0 AND secado_servicio_per_qq > 0);

ALTER TABLE labor_rates ALTER COLUMN secado_servicio_saco_per_qq SET DEFAULT 0;
ALTER TABLE labor_rates ALTER COLUMN secado_servicio_saco_per_qq SET NOT NULL;
