-- CATÁLOGO DE SACOS PROPIO POR SOCIO (aditiva e idempotente).
--
-- La Matriz sigue siendo dueña de su catálogo (accionista_id NULL: todo lo que
-- ya existe, marcas, genéricos y subproductos; lo usan ventas y producción).
-- Un socio que maneja un proceso propio (STALYN: arroz envejecido) compra y
-- controla SUS sacos: filas con accionista_id = el socio. Nunca se mezclan.
ALTER TABLE sack_inventory ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sack_inventory_accionista ON sack_inventory(accionista_id);

-- Kárdex: enlace al lote de Selección/Envejecido que consumió los sacos propios.
ALTER TABLE sack_movements ADD COLUMN IF NOT EXISTS ref_selection UUID REFERENCES selection_batches(id) ON DELETE SET NULL;

-- Empaque con que regresó cada salida de Selección/Envejecido: TULA (por defecto,
-- no consume sacos) o SACO; y el saco propio usado (envejecido del socio).
ALTER TABLE selection_batch_outputs ADD COLUMN IF NOT EXISTS empaque TEXT;
ALTER TABLE selection_batch_outputs ADD COLUMN IF NOT EXISTS sack_id UUID REFERENCES sack_inventory(id) ON DELETE SET NULL;
