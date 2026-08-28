-- Caja de Campo · Fondos por rendir / Vales de anticipo.
-- Un egreso puede marcarse como "dinero entregado por rendir" (anticipo). Se
-- guarda con estado='PENDIENTE_RENDICION'; al liquidarlo (rendición) se compara
-- lo entregado (monto del vale) con lo realmente gastado y se genera un
-- movimiento de AJUSTE (naturaleza='ajuste_vale') que reconcilia la caja:
--   · gastado < entregado → ENTRADA de devolución del saldo.
--   · gastado > entregado → SALIDA de reembolso adicional.
-- El vale pasa a estado='LIQUIDADO' y se guarda el monto realmente rendido.
-- Aditiva. No toca otras tablas. DOWN comentado al final.

-- estado: NULL para movimientos normales. Para vales: 'PENDIENTE_RENDICION' | 'LIQUIDADO'.
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS estado VARCHAR(30);

-- monto_rendido: en el vale, lo realmente gastado (se fija al liquidar).
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS monto_rendido NUMERIC(14,2);

-- vale_id: en el movimiento de AJUSTE, apunta al vale que reconcilia.
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS vale_id UUID REFERENCES campo_movimientos(id);

-- Índice para listar rápido los vales pendientes de rendición.
CREATE INDEX IF NOT EXISTS idx_campo_mov_vale_pend
  ON campo_movimientos (fecha DESC)
  WHERE estado = 'PENDIENTE_RENDICION';

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_campo_mov_vale_pend;
--   ALTER TABLE campo_movimientos DROP COLUMN IF EXISTS vale_id;
--   ALTER TABLE campo_movimientos DROP COLUMN IF EXISTS monto_rendido;
--   ALTER TABLE campo_movimientos DROP COLUMN IF EXISTS estado;
--   DELETE FROM schema_migrations WHERE filename = '20260828_campo_vales_anticipos.sql';
