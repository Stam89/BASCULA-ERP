-- FASE 4.3 — Mantenimiento por area/seccion (aditivo; equipment_id pasa a opcional).
ALTER TABLE equipment_maintenance
  ADD COLUMN IF NOT EXISTS area VARCHAR(40),
  ADD COLUMN IF NOT EXISTS section VARCHAR(80);
ALTER TABLE equipment_maintenance ALTER COLUMN equipment_id DROP NOT NULL;
