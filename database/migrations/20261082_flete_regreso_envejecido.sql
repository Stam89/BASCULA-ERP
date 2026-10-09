-- Flete de REGRESO: el viaje que trae a la piladora lo que quedó allá donde el proveedor (pedido del dueño 2026-10-08).
-- Igual que el flete de ida: carro de Transporte y Cosechadora (campo_servicios origen 'envejecido_regreso' + Por Pagar
-- espejo del socio) o carro externo (Por Pagar 'flete_envejecido_tercero'). Aditiva e idempotente.
ALTER TABLE selection_traidas ADD COLUMN IF NOT EXISTS flete_tipo VARCHAR(10);
ALTER TABLE selection_traidas ADD COLUMN IF NOT EXISTS flete_monto NUMERIC(14,2);
ALTER TABLE selection_traidas ADD COLUMN IF NOT EXISTS flete_activo_id UUID;
ALTER TABLE selection_traidas ADD COLUMN IF NOT EXISTS flete_prestador VARCHAR(120);
ALTER TABLE selection_traidas ADD COLUMN IF NOT EXISTS flete_payable_id UUID;
