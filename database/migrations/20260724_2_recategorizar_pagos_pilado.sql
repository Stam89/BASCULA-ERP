-- Los pagos de servicio de pilado y de traspaso entre socios se registraron en
-- caja con categoría PAGO_AGRICULTOR, aunque no son a un agricultor. Se
-- recategorizan los movimientos ya existentes segun la cuenta que pagaron,
-- para que el reporte de caja diga la verdad.
UPDATE cash_movements cm
SET category = CASE ap.reference_type
                 WHEN 'pilado_service' THEN 'PAGO_SERVICIO_PILADO'
                 WHEN 'lot_transfer' THEN 'PAGO_ENTRE_SOCIOS'
                 ELSE cm.category
               END
FROM accounts_payable ap
WHERE cm.reference_type = 'accounts_payable'
  AND cm.reference_id = ap.id
  AND cm.category = 'PAGO_AGRICULTOR'
  AND ap.reference_type IN ('pilado_service', 'lot_transfer');
