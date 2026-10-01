-- Caja · Compra de repuestos y Materiales consumibles con equipo / máquina.
--  · repuestos.ubicacion: dónde se guarda en bodega (Ej: Estante 3, Cajón A).
--  · equipment_maintenance.cash_movement_id / payable_id: la hoja de vida que
--    nace de una compra (repuesto de USO INMEDIATO o materiales consumibles)
--    queda enlazada a su egreso o a su Cuenta por Pagar, para anularse con ellos.
-- Aditiva e idempotente.
ALTER TABLE repuestos ADD COLUMN IF NOT EXISTS ubicacion VARCHAR(80);
ALTER TABLE equipment_maintenance ADD COLUMN IF NOT EXISTS cash_movement_id UUID;
ALTER TABLE equipment_maintenance ADD COLUMN IF NOT EXISTS payable_id UUID;
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_cash_movement
  ON equipment_maintenance (cash_movement_id) WHERE cash_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_maintenance_payable
  ON equipment_maintenance (payable_id) WHERE payable_id IS NOT NULL;
