-- V2 Reportes de Campo — FUENTE ÚNICA del saldo por servicio.
-- Vista derivada (no guarda nada): por cada servicio expone cobrado, saldo
-- pendiente y estado, con la MISMA fórmula que usaba el endpoint. Reporte y
-- endpoint de servicios leen de aquí para no duplicar lógica.
-- Solo CREA una vista sobre tablas campo_ existentes. No toca datos. Reversible.
CREATE OR REPLACE VIEW campo_servicios_saldo AS
SELECT
  s.id, s.fecha, s.cliente_id, s.activo_id, s.tipo, s.qq, s.precio_unitario,
  s.valor, s.notas, s.created_by, s.created_at,
  COALESCE(mov.cobrado, 0)                      AS cobrado,
  (s.valor - COALESCE(mov.cobrado, 0))          AS saldo_pendiente,
  CASE
    WHEN COALESCE(mov.cobrado, 0) <= 0                THEN 'pendiente'
    WHEN COALESCE(mov.cobrado, 0) + 0.005 >= s.valor  THEN 'pagado'
    ELSE 'abonado'
  END                                           AS estado
FROM campo_servicios s
LEFT JOIN (
  SELECT servicio_id, SUM(monto) AS cobrado
  FROM campo_movimientos
  WHERE signo = 'entrada' AND servicio_id IS NOT NULL
  GROUP BY servicio_id
) mov ON mov.servicio_id = s.id;

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP VIEW IF EXISTS campo_servicios_saldo;
--   DELETE FROM schema_migrations WHERE filename = '20260827_campo_servicios_saldo_view.sql';
