-- Corrige el sobrecobro histórico en 'Servicio Completo' (SECADO_PILADO): antes
-- se sumaba un rubro separado de secado ($1.50/QQ) al pilado ($3.75/QQ). La regla
-- correcta es tarifa unificada de pilado (que YA incluye el secado) + adicional
-- por sacos < 100 lb. El monto correcto = suma de los subtotales del `detalle`
-- del servicio (base + recargos, SIN secado).
--
-- Recalcula la cuenta por cobrar (y su espejo por pagar, el pilado_service y la
-- orden de maquila) PRESERVANDO lo ya pagado (paid = amount - balance). El ajuste
-- de MONTO solo toca registros sobrecobrados (idempotente). El DETALLE se
-- reescribe siempre al formato correcto (también idempotente).
--
-- `adicional` se suma de los recargos del desglose (qq × recargo_qq), no como
-- total-base, para no arrastrar redondeos de $0.01.

-- (1) MONTO de la cuenta por cobrar (solo si está sobrecobrada).
WITH svc AS (
  SELECT ps.receivable_id, ROUND(SUM((d->>'subtotal')::numeric), 2) AS pilado_only
  FROM pilado_services ps
  JOIN lots l ON l.id = ps.lot_id
  CROSS JOIN LATERAL jsonb_array_elements(ps.detalle) d
  WHERE upper(COALESCE(l.operation_type, '')) = 'SECADO_PILADO'
  GROUP BY ps.receivable_id
)
UPDATE accounts_receivable ar
SET amount = s.pilado_only,
    balance = GREATEST(0, ROUND(s.pilado_only - (ar.amount - ar.balance), 2)),
    status  = CASE WHEN GREATEST(0, ROUND(s.pilado_only - (ar.amount - ar.balance), 2)) < 0.01 THEN 'PAID' ELSE ar.status END
FROM svc s
WHERE ar.id = s.receivable_id AND ar.amount > s.pilado_only + 0.005;

-- (2) DETALLE de la cuenta por cobrar (siempre, al formato correcto).
WITH svc AS (
  SELECT ps.receivable_id, ps.lot_id, ps.quintals,
         ROUND(SUM((d->>'subtotal')::numeric), 2) AS pilado_only,
         MAX((d->>'precio_base_qq')::numeric) AS base,
         ROUND(SUM((d->>'quintals')::numeric * (d->>'recargo_qq')::numeric), 2) AS adicional
  FROM pilado_services ps
  JOIN lots l ON l.id = ps.lot_id
  CROSS JOIN LATERAL jsonb_array_elements(ps.detalle) d
  WHERE upper(COALESCE(l.operation_type, '')) = 'SECADO_PILADO'
  GROUP BY ps.receivable_id, ps.lot_id, ps.quintals
)
UPDATE accounts_receivable ar
SET description = 'Servicio Completo (Secado + Pilado) a ' || COALESCE(f.full_name, 'cliente')
      || ': ' || s.quintals::float8 || ' QQ × $' || s.base::float8 || '/QQ = $' || ROUND(s.quintals * s.base, 2)::float8
      || CASE WHEN s.adicional > 0.005
              THEN ' (+ Adicional Sacos <100lb: $' || s.adicional::float8 || ')'
              ELSE '' END
FROM svc s
LEFT JOIN lots l ON l.id = s.lot_id
LEFT JOIN farmers f ON f.id = l.farmer_id
WHERE ar.id = s.receivable_id;

-- (3) Espejo por pagar (si el cliente es otro accionista/socio), solo sobrecobrado.
WITH svc AS (
  SELECT ps.payable_id, ROUND(SUM((d->>'subtotal')::numeric), 2) AS pilado_only
  FROM pilado_services ps
  JOIN lots l ON l.id = ps.lot_id
  CROSS JOIN LATERAL jsonb_array_elements(ps.detalle) d
  WHERE upper(COALESCE(l.operation_type, '')) = 'SECADO_PILADO' AND ps.payable_id IS NOT NULL
  GROUP BY ps.payable_id
)
UPDATE accounts_payable ap
SET amount = s.pilado_only,
    balance = GREATEST(0, ROUND(s.pilado_only - (ap.amount - ap.balance), 2)),
    status  = CASE WHEN GREATEST(0, ROUND(s.pilado_only - (ap.amount - ap.balance), 2)) < 0.01 THEN 'PAID' ELSE ap.status END
FROM svc s
WHERE ap.id = s.payable_id AND ap.amount > s.pilado_only + 0.005;

-- (4) Registro del servicio de pilado (total).
WITH svc AS (
  SELECT ps.id AS ps_id, ROUND(SUM((d->>'subtotal')::numeric), 2) AS pilado_only
  FROM pilado_services ps
  JOIN lots l ON l.id = ps.lot_id
  CROSS JOIN LATERAL jsonb_array_elements(ps.detalle) d
  WHERE upper(COALESCE(l.operation_type, '')) = 'SECADO_PILADO'
  GROUP BY ps.id
)
UPDATE pilado_services ps
SET total = s.pilado_only
FROM svc s
WHERE ps.id = s.ps_id AND ps.total > s.pilado_only + 0.005;

-- (5) Orden de maquila (total del servicio) del mismo lote.
WITH svc AS (
  SELECT ps.lot_id, ROUND(SUM((d->>'subtotal')::numeric), 2) AS pilado_only
  FROM pilado_services ps
  JOIN lots l ON l.id = ps.lot_id
  CROSS JOIN LATERAL jsonb_array_elements(ps.detalle) d
  WHERE upper(COALESCE(l.operation_type, '')) = 'SECADO_PILADO'
  GROUP BY ps.lot_id
)
UPDATE maquila_orders mo
SET total_service_amount = s.pilado_only
FROM svc s
WHERE mo.lot_id = s.lot_id AND mo.service_type = 'PILADO_MAQUILA' AND mo.total_service_amount > s.pilado_only + 0.005;
