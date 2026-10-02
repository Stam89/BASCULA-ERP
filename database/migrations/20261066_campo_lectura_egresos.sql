-- Transporte y Cosechadora · Nuevo egreso: lectura de desgaste de la máquina
-- (horómetro en HORAS para cosechadoras, kilometraje en KM para vehículos) al
-- cargar DIESEL, GASOLINA o una REPARACION_MANT. Base de futuros cálculos de
-- rendimiento (galones por hora / por km). Opcional: NULL en los históricos.
-- (Las reparaciones ya la guardan en campo_mantenimientos.lectura/unidad_lectura.)
-- Aditiva e idempotente.
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS lectura NUMERIC(14,2);
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS unidad_lectura VARCHAR(10);
-- Egreso A CRÉDITO (nace como Cuenta por Pagar): la lectura no se pierde.
ALTER TABLE campo_cxp ADD COLUMN IF NOT EXISTS lectura NUMERIC(14,2);
ALTER TABLE campo_cxp ADD COLUMN IF NOT EXISTS unidad_lectura VARCHAR(10);
