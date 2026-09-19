-- Convierte el saldo inicial de cada turno en un movimiento real de CAJA.
-- La referencia a la sesion permite aplicar el parche de forma idempotente.
ALTER TABLE campo_movimientos
  ADD COLUMN IF NOT EXISTS caja_sesion_id UUID
  REFERENCES campo_caja_sesiones(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campo_movimiento_apertura_sesion
  ON campo_movimientos (caja_sesion_id)
  WHERE caja_sesion_id IS NOT NULL AND naturaleza = 'apertura_caja';

-- Repara silenciosamente la caja que ya estaba abierta al instalar el cambio.
INSERT INTO campo_movimientos
  (fecha, cuenta_id, signo, monto, concepto, naturaleza, caja_sesion_id, created_by, created_at)
SELECT (s.fecha_apertura AT TIME ZONE 'America/Guayaquil')::date,
       c.id,
       'entrada',
       s.saldo_inicial,
       'Apertura de caja / Saldo inicial',
       'apertura_caja',
       s.id,
       s.usuario_id,
       s.fecha_apertura
  FROM campo_caja_sesiones s
 CROSS JOIN LATERAL (
   SELECT id FROM campo_cuentas WHERE upper(trim(nombre)) = 'CAJA' LIMIT 1
 ) c
 WHERE s.estado = 'ABIERTA'
   AND s.saldo_inicial > 0
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_campo_mov_caja_sesion
  ON campo_movimientos (caja_sesion_id)
  WHERE caja_sesion_id IS NOT NULL;

-- DOWN (reversa manual):
--   DROP INDEX IF EXISTS idx_campo_mov_caja_sesion;
--   DROP INDEX IF EXISTS uq_campo_movimiento_apertura_sesion;
--   ALTER TABLE campo_movimientos DROP COLUMN IF EXISTS caja_sesion_id;
--   DELETE FROM schema_migrations WHERE filename = '20261021_campo_caja_saldo_inicial.sql';
