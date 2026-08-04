-- Asocia cada fomento al accionista logueado, evitando que un accionista
-- vea o modifique los fomentos de otro.

ALTER TABLE fomentos
  ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);

-- Los fomentos existentes sin dueño se asignan al accionista principal (CEYRO)
-- para no perderlos; el administrador puede reasignarlos después si es necesario.
UPDATE fomentos
  SET accionista_id = '00000000-0000-0000-0000-000000000001'
WHERE accionista_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_fomentos_accionista_id ON fomentos(accionista_id);
