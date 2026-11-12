-- Activos fijos: la categoría del Excel («PROPIEDAD PLANTA Y EQUIPO») no cabía en 20 letras. Solo se agranda.
ALTER TABLE equipment ALTER COLUMN type TYPE VARCHAR(60);
