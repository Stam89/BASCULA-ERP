-- Mantenimiento de Caja: repuestos COMPRADOS en la reparación. Los «usados ya»
-- son costo de la reparación (parts_cost, dentro de amount) y no entran a bodega;
-- los «para el inventario» entran al stock como compra de repuestos aparte.
-- Aquí queda el detalle legible para la hoja de vida. Aditiva e idempotente.
ALTER TABLE equipment_maintenance ADD COLUMN IF NOT EXISTS repuestos_comprados TEXT;
