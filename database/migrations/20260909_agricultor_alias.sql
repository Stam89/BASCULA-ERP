-- Homologación de nombres: la app EXTERNA de báscula puede mandar el nombre del
-- agricultor con variaciones/typos (ej. "AIDITA" por "AIDITHA"). Esta tabla mapea
-- un alias al agricultor oficial para vincular los tickets automáticamente. Aditiva.
CREATE TABLE IF NOT EXISTS agricultor_alias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_nombre  VARCHAR(160) NOT NULL,
  agricultor_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un alias (normalizado, sin distinguir mayúsculas/espacios) apunta a UN agricultor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agricultor_alias_nombre ON agricultor_alias (lower(trim(alias_nombre)));
CREATE INDEX IF NOT EXISTS idx_agricultor_alias_agricultor ON agricultor_alias (agricultor_id);

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS agricultor_alias;
--   DELETE FROM schema_migrations WHERE filename = '20260909_agricultor_alias.sql';
