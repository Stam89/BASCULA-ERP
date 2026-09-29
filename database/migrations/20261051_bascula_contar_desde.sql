-- Báscula: «Contar tickets desde» (fecha de corte).
-- La app de báscula trae todo su historial; los tickets anteriores al inicio
-- real del ERP no se van a ingresar y salían como «Pendientes». Con esta fecha,
-- los anteriores dejan de contar como pendientes (siguen visibles en «Todos»).
-- Sin fecha (NULL) = se cuentan todos, como hasta ahora.
CREATE TABLE IF NOT EXISTS bascula_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  desde DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
INSERT INTO bascula_config (id, desde) VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;
