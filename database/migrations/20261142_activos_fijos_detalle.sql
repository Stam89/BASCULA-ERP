-- 🏭 Activos fijos desde el Excel del dueño (pedido 2026-11-12: «súbelos y pon una forma de subirlos uno mismo»).
-- El Excel trae descripción (cuántos hay, dónde), condición (BUENO/JUSTO/DEFICIENTE/MALO) y notas: se guardan con el equipo.
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS descripcion TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS condicion VARCHAR(20);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS notas TEXT;
