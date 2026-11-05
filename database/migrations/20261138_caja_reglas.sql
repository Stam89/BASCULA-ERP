-- Reglas de la Caja: lo que el dueño define para que la hoja ponga sola la categoría.
-- quien = persona, proveedor o máquina del primer recuadro; palabra = lo que dice «qué se hizo». Una de las dos basta.
CREATE TABLE IF NOT EXISTS caja_reglas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quien TEXT NOT NULL DEFAULT '',
  palabra TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (quien <> '' OR palabra <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS caja_reglas_unica ON caja_reglas (lower(quien), lower(palabra));
