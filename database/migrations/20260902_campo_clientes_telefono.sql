-- Teléfono del cliente de Campo (para el alta/edición de clientes). Aditiva.
ALTER TABLE campo_clientes ADD COLUMN IF NOT EXISTS telefono VARCHAR(40);

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   ALTER TABLE campo_clientes DROP COLUMN IF EXISTS telefono;
--   DELETE FROM schema_migrations WHERE filename = '20260902_campo_clientes_telefono.sql';
