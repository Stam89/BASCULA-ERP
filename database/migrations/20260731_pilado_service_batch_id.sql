-- Vincular cada servicio de pilado con su processing_batch para poder generar
-- el informe completo (arrocillo, polvillo, merma) que se le entrega al cliente.
ALTER TABLE pilado_services ADD COLUMN IF NOT EXISTS processing_batch_id UUID REFERENCES processing_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pilado_services_processing_batch_id ON pilado_services(processing_batch_id);
