-- Catálogo de Operadores de la operación Campo. Se usa en Partes Diarios (el
-- campo Operador pasa de texto libre a selector alimentado por este catálogo).
-- En campo_partes.operador se sigue guardando el NOMBRE (texto) del operador
-- elegido (snapshot del día); no se migra esa columna. Aditiva. DOWN al final.
CREATE TABLE IF NOT EXISTS campo_operadores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         VARCHAR(140) NOT NULL,
  identificacion VARCHAR(40),
  telefono       VARCHAR(40),
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campo_operadores_activo ON campo_operadores (activo, nombre);

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS campo_operadores;
--   DELETE FROM schema_migrations WHERE filename = '20260831_campo_operadores.sql';
