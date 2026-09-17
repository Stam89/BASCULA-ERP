-- Corrección del cálculo de la ESTIBADA: se elimina el término por saca física
-- (sacas × estibador_per_saca), que sumaba magnitudes heterogéneas e inflaba el
-- pago (ej. 51 QQ con 204 sacas pagaba $57.50 en vez de $6.50). La estibada por
-- sacos se cobra SOLO por QQ de arroz blanco + QQ de arrocillo (+ tulas por volumen).
-- Solo se recalculan los pagos PENDIENTES (los ya liquidados/PAID no se tocan).
UPDATE worker_payments wp
SET base_amount = ROUND(wp.qq * lr.estibador_per_qq + wp.arrocillo * lr.estibador_per_arrocillo + (wp.tulas / 3.0) * lr.estibador_por_3tulas, 2),
    net_amount  = ROUND(GREATEST(0, wp.qq * lr.estibador_per_qq + wp.arrocillo * lr.estibador_per_arrocillo + (wp.tulas / 3.0) * lr.estibador_por_3tulas - COALESCE(wp.discount, 0)), 2),
    detail = jsonb_set(jsonb_set(COALESCE(wp.detail, '{}'::jsonb), '{saca_amount}', '0'::jsonb, true), '{saca_rate}', '0'::jsonb, true)
FROM labor_rates lr
WHERE lr.id = 1
  AND wp.worker_role = 'ESTIBADOR'
  AND wp.status = 'PENDING';
