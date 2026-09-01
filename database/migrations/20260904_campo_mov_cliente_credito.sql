-- Atribución del movimiento a un cliente de Campo. Sirve para rastrear el
-- "crédito a favor" del cruce de fletes por cliente-piladora: el crédito
-- disponible = Σ(entradas − salidas) en la cuenta 'CRUCE PILADORA' de ese
-- cliente con servicio_id NULL (entrada = crédito generado, salida = crédito
-- consumido al aplicarlo a un servicio). Aditiva.
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES campo_clientes(id);
CREATE INDEX IF NOT EXISTS idx_campo_mov_cliente ON campo_movimientos (cliente_id) WHERE cliente_id IS NOT NULL;

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_campo_mov_cliente;
--   ALTER TABLE campo_movimientos DROP COLUMN IF EXISTS cliente_id;
--   DELETE FROM schema_migrations WHERE filename = '20260904_campo_mov_cliente_credito.sql';
