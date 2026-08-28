-- Flota y Maquinaria (Centros de Costo) en la operación Campo. Reusa la tabla
-- existente campo_activos como catálogo de maquinaria (la FK "maquinaria_id" ya
-- existe: campo_movimientos.activo_id → campo_activos). Aditiva.
--  · placa_codigo: matrícula / código del vehículo o cosechadora.
--  · tipo: se amplía de (cosechadora|transporte) a la flota completa.
ALTER TABLE campo_activos ADD COLUMN IF NOT EXISTS placa_codigo VARCHAR(40);

ALTER TABLE campo_activos DROP CONSTRAINT IF EXISTS campo_activos_tipo_check;
ALTER TABLE campo_activos ADD CONSTRAINT campo_activos_tipo_check
  CHECK (tipo IN ('cosechadora', 'camion', 'vehiculo', 'transporte', 'otro'));

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   ALTER TABLE campo_activos DROP CONSTRAINT IF EXISTS campo_activos_tipo_check;
--   ALTER TABLE campo_activos ADD CONSTRAINT campo_activos_tipo_check CHECK (tipo IN ('cosechadora','transporte'));
--   ALTER TABLE campo_activos DROP COLUMN IF EXISTS placa_codigo;
--   DELETE FROM schema_migrations WHERE filename = '20260828_campo_maquinaria.sql';
