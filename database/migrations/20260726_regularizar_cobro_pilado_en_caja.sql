-- REGULARIZA COBROS DE PILADO QUE SE SALDARON SIN SUBIR (COMPLETO) A CAJA
--
-- El endpoint viejo POST /pilado/services/:id/settle bajaba el saldo de la
-- cuenta por cobrar (y por pagar) pero NO registraba el movimiento de caja.
-- Además, algunos servicios se cobraron en parte por el flujo bueno (Por Cobrar)
-- y en parte por el settle roto, quedando la caja de CEYRO con MENOS ingreso del
-- que realmente se cobró.
--
-- Esta migración inserta el FALTANTE por cada cuenta:
--   faltante = (monto cobrado)  −  (lo que ya está registrado en caja)
--   cobrado  = amount − balance ;  registrado = suma de movimientos de esa cuenta
--
-- Es SEGURA e IDEMPOTENTE: si ya está todo en caja el faltante es 0 y no inserta;
-- si se corre de nuevo, lo recién insertado ya cuenta como "registrado". Solo
-- toca cuentas cuyo accionista tiene una caja ABIERTA (JOIN LATERAL sin match la
-- excluye). No se conoce la fecha real del pago, así que el movimiento queda con
-- la fecha de hoy: es cuando se está regularizando en caja.

-- 1) INGRESO faltante en la caja de CEYRO (lado por cobrar).
WITH cobros AS (
  SELECT ar.id AS ar_id,
         ps.provider_accionista_id AS ceyro_id,
         COALESCE(a.name, ps.client_name, 'Cliente') AS cliente,
         (ar.amount - ar.balance) AS cobrado,
         COALESCE((
           SELECT SUM(cm.amount) FROM cash_movements cm
           WHERE cm.reference_type = 'accounts_receivable'
             AND cm.reference_id = ar.id
             AND cm.movement = 'INCOME'
         ), 0) AS ya_en_caja
  FROM pilado_services ps
  JOIN accounts_receivable ar ON ar.id = ps.receivable_id
  LEFT JOIN accionistas a ON a.id = ps.client_accionista_id
)
INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description)
SELECT cr.id, 'INCOME', 'COBRO_SERVICIO_PILADO', 'accounts_receivable', cobros.ar_id,
       ROUND(cobros.cobrado - cobros.ya_en_caja, 2),
       'Cobro servicio de pilado (regularización) a ' || cobros.cliente
FROM cobros
JOIN LATERAL (
  SELECT id FROM cash_registers
  WHERE accionista_id = cobros.ceyro_id AND status = 'OPEN'
  ORDER BY (tipo = 'EFECTIVO') DESC, opened_at DESC
  LIMIT 1
) cr ON true
WHERE (cobros.cobrado - cobros.ya_en_caja) > 0.005;

-- 2) EGRESO faltante en la caja del cliente accionista (lado por pagar).
--    Los clientes externos no tienen cuenta por pagar y se ignoran.
WITH pagos AS (
  SELECT ap.id AS ap_id,
         ap.accionista_id AS cliente_id,
         (ap.amount - ap.balance) AS pagado,
         COALESCE((
           SELECT SUM(cm.amount) FROM cash_movements cm
           WHERE cm.reference_type = 'accounts_payable'
             AND cm.reference_id = ap.id
             AND cm.movement = 'EXPENSE'
         ), 0) AS ya_en_caja
  FROM pilado_services ps
  JOIN accounts_payable ap ON ap.id = ps.payable_id
  WHERE ps.payable_id IS NOT NULL
)
INSERT INTO cash_movements (cash_register_id, movement, category, reference_type, reference_id, amount, description)
SELECT cr.id, 'EXPENSE', 'PAGO_SERVICIO_PILADO', 'accounts_payable', pagos.ap_id,
       ROUND(pagos.pagado - pagos.ya_en_caja, 2),
       'Pago servicio de pilado a CEYRO (regularización)'
FROM pagos
JOIN LATERAL (
  SELECT id FROM cash_registers
  WHERE accionista_id = pagos.cliente_id AND status = 'OPEN'
  ORDER BY (tipo = 'EFECTIVO') DESC, opened_at DESC
  LIMIT 1
) cr ON true
WHERE (pagos.pagado - pagos.ya_en_caja) > 0.005;
