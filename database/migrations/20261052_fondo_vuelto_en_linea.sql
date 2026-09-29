-- Fondos a rendir cuentas: el vuelto se registra EN LA MISMA LÍNEA.
-- Al liquidar un fondo de la sesión abierta, el egreso pasa al GASTO REAL y el
-- monto entregado queda guardado aquí (trazabilidad: entregado − gasto = vuelto).
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS monto_entregado NUMERIC(12,2);

-- Reparación: fondos marcados LIQUIDADO cuyo ajuste de vuelto/faltante se anuló
-- después (el fondo quedaba «colgado» como liquidado sin ajuste vigente). Vuelven
-- a «Por Liquidar» con su descripción original. Idempotente.
UPDATE cash_movements f
   SET fondo_estado = 'POR_LIQUIDAR',
       description = NULLIF(btrim(regexp_replace(COALESCE(f.description, ''), '\s*·\s*Liquidado: gasto real.*$', '')), '')
 WHERE f.es_fondo
   AND f.fondo_estado = 'LIQUIDADO'
   AND f.reversed_at IS NULL
   AND f.monto_entregado IS NULL
   AND EXISTS (SELECT 1 FROM cash_movements a WHERE a.reference_type = 'fondo_liquidacion' AND a.reference_id = f.id)
   AND NOT EXISTS (SELECT 1 FROM cash_movements a WHERE a.reference_type = 'fondo_liquidacion' AND a.reference_id = f.id AND a.reversed_at IS NULL);
