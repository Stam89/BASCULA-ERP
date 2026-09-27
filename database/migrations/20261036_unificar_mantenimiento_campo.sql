-- Transporte/Cosechadora reutiliza el historial oficial equipment_maintenance.
-- campo_mantenimientos conserva el detalle tecnico interno, pero cada registro
-- queda enlazado a una sola fila visible en Caja principal > Mantenimiento.

ALTER TABLE equipment_maintenance
  ADD COLUMN IF NOT EXISTS campo_mantenimiento_id UUID REFERENCES campo_mantenimientos(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_maintenance_campo
  ON equipment_maintenance (campo_mantenimiento_id)
  WHERE campo_mantenimiento_id IS NOT NULL;

-- Permite registrar inspecciones o trabajos sin costo sin inventar un valor.
ALTER TABLE equipment_maintenance
  DROP CONSTRAINT IF EXISTS equipment_maintenance_amount_positive;
ALTER TABLE equipment_maintenance
  ADD CONSTRAINT equipment_maintenance_amount_nonnegative CHECK (amount >= 0);

-- Lleva cualquier registro ya creado al historial oficial, sin duplicarlo.
INSERT INTO equipment_maintenance
  (equipment_id, area, section, maquina, maintenance_type, description,
   provider, invoice_number, amount, created_by, created_at,
   work_done, next_maintenance_date, status, campo_mantenimiento_id)
SELECT NULL, 'TRANSPORTE Y COSECHADORA', a.tipo, a.nombre, mt.tipo, mt.detalle,
       mt.proveedor, mt.factura, mt.costo, mt.created_by, mt.created_at,
       mt.detalle, mt.proxima_fecha,
       CASE WHEN mt.anulado_at IS NULL THEN 'COMPLETADO' ELSE 'ANULADO' END,
       mt.id
  FROM campo_mantenimientos mt
  JOIN campo_activos a ON a.id = mt.activo_id
ON CONFLICT (campo_mantenimiento_id) WHERE campo_mantenimiento_id IS NOT NULL DO NOTHING;
