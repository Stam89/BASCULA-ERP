-- Campo (operación de CEYRO): configuración editable + soporte de transferencias.
-- Aditiva. No toca otras tablas. DOWN comentado al final.

-- 1) Config de la operación (una sola fila). El nombre de la operación es
--    editable y persistente; default = el actual ('Campo').
CREATE TABLE IF NOT EXISTS campo_config (
  id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nombre_operacion VARCHAR(60) NOT NULL DEFAULT 'Campo',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO campo_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2) Transferencias entre cuentas: se guardan como un PAR de movimientos (salida
--    en origen + entrada en destino) con naturaleza='transferencia' y un par_id
--    común que enlaza ambos. Los movimientos normales quedan 'operativo'.
--    La naturaleza sirve para EXCLUIR las transferencias de ingresos/egresos en
--    los reportes (pero SÍ cuentan en el saldo de cada cuenta).
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS naturaleza VARCHAR(20) NOT NULL DEFAULT 'operativo';
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS par_id UUID;
CREATE INDEX IF NOT EXISTS idx_campo_mov_par ON campo_movimientos (par_id) WHERE par_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campo_mov_naturaleza ON campo_movimientos (naturaleza);

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_campo_mov_naturaleza;
--   DROP INDEX IF EXISTS idx_campo_mov_par;
--   ALTER TABLE campo_movimientos DROP COLUMN IF EXISTS par_id;
--   ALTER TABLE campo_movimientos DROP COLUMN IF EXISTS naturaleza;
--   DROP TABLE IF EXISTS campo_config;
--   DELETE FROM schema_migrations WHERE filename = '20260827_campo_config_transferencias.sql';
