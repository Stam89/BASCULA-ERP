-- Mantenimiento de Caja: una sola factura puede traer repuestos para varias
-- máquinas. Cada máquina recibe un registro HIJO (parent_id → la reparación
-- principal) con su parte; un solo egreso de caja. Aditiva e idempotente.
ALTER TABLE equipment_maintenance ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES equipment_maintenance(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_parent ON equipment_maintenance (parent_id) WHERE parent_id IS NOT NULL;

-- Un mantenimiento cuyo egreso de caja ya se anuló sale de la hoja de vida
-- (igual que lo hace ahora la anulación).
UPDATE equipment_maintenance em
   SET status = 'ANULADO'
 WHERE em.status <> 'ANULADO'
   AND EXISTS (SELECT 1 FROM cash_movements cm
                WHERE cm.reference_type = 'equipment_maintenance' AND cm.reference_id = em.id AND cm.reversed_at IS NOT NULL);
