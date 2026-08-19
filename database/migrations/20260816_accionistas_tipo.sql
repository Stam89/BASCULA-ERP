-- FASE F-A — Clasificacion de accionistas: Planta/Matriz vs Socio Operativo.
-- Aditivo: agrega columna 'tipo'. No borra ni altera datos existentes.
ALTER TABLE accionistas
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'SOCIO';

-- CEYRO es la planta/matriz (id canonico usado en todo el sistema).
UPDATE accionistas SET tipo = 'MATRIZ'
  WHERE id = '00000000-0000-0000-0000-000000000001';
