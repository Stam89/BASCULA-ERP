-- Configuracion por socio operativo para habilitar visualmente el flujo de
-- Envejecido y permitir tarifas personalizadas de Seleccion/Envejecido.
-- Aditiva: conserva `puede_envejecer` por compatibilidad con versiones previas.
ALTER TABLE accionistas
  ADD COLUMN IF NOT EXISTS modulo_envejecido_habilitado BOOLEAN NOT NULL DEFAULT false;

UPDATE accionistas
   SET modulo_envejecido_habilitado = true
 WHERE puede_envejecer = true
   AND modulo_envejecido_habilitado = false;

UPDATE accionistas
   SET modulo_envejecido_habilitado = true,
       puede_envejecer = true
 WHERE (name ILIKE '%stalyn%' OR code ILIKE '%stalyn%')
   AND (modulo_envejecido_habilitado = false OR puede_envejecer = false);

ALTER TABLE tarifario_servicio DROP CONSTRAINT IF EXISTS tarifario_servicio_chk;
ALTER TABLE tarifario_servicio
  ADD CONSTRAINT tarifario_servicio_chk
  CHECK (servicio IN ('PILADO','SECADO','FLETE','SELECCION','ENVEJECIMIENTO'));

CREATE INDEX IF NOT EXISTS idx_tarifario_servicio_socio_lookup
  ON tarifario_servicio (socio_id, servicio, fecha_vigencia)
  WHERE is_active = true;

-- DOWN (reversa manual):
--   ALTER TABLE tarifario_servicio DROP CONSTRAINT IF EXISTS tarifario_servicio_chk;
--   ALTER TABLE tarifario_servicio ADD CONSTRAINT tarifario_servicio_chk CHECK (servicio IN ('PILADO','SECADO','FLETE'));
--   ALTER TABLE accionistas DROP COLUMN IF EXISTS modulo_envejecido_habilitado;
--   DELETE FROM schema_migrations WHERE filename = '20261024_envejecido_por_socio_y_tarifario.sql';
