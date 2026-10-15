-- TRABAJO EN UN EQUIPO EN UN SOLO FLUJO (Caja, pedido del dueño 2026-10-15): reparación, mantenimiento o
-- compra de repuesto con quién lo hizo (personal propio o técnico de afuera), quién compró y lo que se usó
-- (repuestos de bodega, repuestos comprados, insumos). Aditiva e idempotente.
ALTER TABLE equipment_maintenance ADD COLUMN IF NOT EXISTS hecho_por_tipo text;
ALTER TABLE equipment_maintenance ADD COLUMN IF NOT EXISTS comprado_por text;
