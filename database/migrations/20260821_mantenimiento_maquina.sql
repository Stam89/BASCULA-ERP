-- Campo opcional "Maquina / Activo" en el registro de mantenimiento (aditivo).
ALTER TABLE equipment_maintenance
  ADD COLUMN IF NOT EXISTS maquina VARCHAR(120);
