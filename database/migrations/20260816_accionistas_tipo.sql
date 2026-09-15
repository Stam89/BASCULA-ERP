-- FASE F-A — Clasificacion de accionistas: Planta/Matriz vs Socio Operativo.
-- Aditivo: agrega columna 'tipo'. No borra ni altera datos existentes.
ALTER TABLE accionistas
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'SOCIO';

-- El primer accionista de una instalación nueva se clasifica como Matriz. El
-- código operativo lo resuelve por tipo; no depende de este UUID.
UPDATE accionistas SET tipo = 'MATRIZ'
  WHERE id = '00000000-0000-0000-0000-000000000001';
