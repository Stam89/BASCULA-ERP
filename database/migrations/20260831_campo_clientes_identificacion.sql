-- Estado de Cuenta de clientes (Campo): se agrega la identificación (RUC/cédula)
-- al cliente para el buscador y la ficha imprimible. Aditiva. DOWN al final.
ALTER TABLE campo_clientes ADD COLUMN IF NOT EXISTS identificacion VARCHAR(40);

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   ALTER TABLE campo_clientes DROP COLUMN IF EXISTS identificacion;
--   DELETE FROM schema_migrations WHERE filename = '20260831_campo_clientes_identificacion.sql';
