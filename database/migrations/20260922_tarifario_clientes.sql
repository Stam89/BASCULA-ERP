-- El tarifario de servicios deja de ser solo para SOCIOS: ahora admite también
-- CLIENTES externos (customers). socio_id pasa a ser opcional; se agrega
-- customer_id y campos denormalizados para listar/buscar. Aditiva y compatible.
ALTER TABLE tarifario_servicio DROP CONSTRAINT IF EXISTS tarifario_servicio_socio_id_fkey;
ALTER TABLE tarifario_servicio ALTER COLUMN socio_id DROP NOT NULL;
ALTER TABLE tarifario_servicio
  ADD COLUMN IF NOT EXISTS customer_id    UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS cliente_nombre TEXT,
  ADD COLUMN IF NOT EXISTS cliente_tipo   VARCHAR(10) NOT NULL DEFAULT 'SOCIO';

-- Re-crea la FK de socio_id pero permitiendo NULL (una tarifa es de un socio O de
-- un cliente). No forzamos que exactamente uno esté presente para no romper datos.
ALTER TABLE tarifario_servicio
  ADD CONSTRAINT tarifario_servicio_socio_id_fkey
  FOREIGN KEY (socio_id) REFERENCES accionistas(id);

-- Backfill de las filas existentes (todas eran de socios): nombre + tipo.
UPDATE tarifario_servicio t
   SET cliente_nombre = a.name, cliente_tipo = 'SOCIO'
  FROM accionistas a
 WHERE a.id = t.socio_id AND t.cliente_nombre IS NULL;

CREATE INDEX IF NOT EXISTS idx_tarifario_customer ON tarifario_servicio (customer_id, servicio, fecha_vigencia);
