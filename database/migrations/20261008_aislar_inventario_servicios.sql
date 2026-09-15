-- Aislamiento de Inventario Propio vs. Servicios (limpieza retroactiva).
--
-- Bug: los lotes de servicio (SECADO / PILADO / SECADO_PILADO) generaban
-- movimientos de inventario en el stock PATRIMONIAL de la empresa. En concreto,
-- al procesarlos se registraba un PROCESS_INPUT que descontaba cáscara del
-- inventario propio SIN que hubiera existido nunca un ingreso (el grano es del
-- cliente). Esto dejó el stock de Cáscara en un valor irreal negativo
-- (~ -3406 QQ). El producto terminado y el consumo propio (COMPRA) son
-- correctos y NO se tocan.
--
-- Este script ELIMINA únicamente los movimientos de inventario de MATERIA PRIMA
-- y PRODUCTO TERMINADO vinculados a lotes de servicio. Los SUBPRODUCTOS
-- (polvillo / arrocillo), que la planta sí se queda, se PRESERVAN.
--
-- El alcance se define por el `operation_type` del lote unido (JOIN preciso),
-- NUNCA por patrones de código de lote, para no tocar datos reales de compras.
-- Idempotente: si ya se corrió, no hay filas que borrar.

-- Diagnóstico previo (queda en el log de la migración): cuánto se va a limpiar.
DO $$
DECLARE
  v_movs INT;
  v_qq   NUMERIC;
BEGIN
  SELECT COUNT(*), COALESCE(ROUND(SUM(m.quantity), 2), 0)
    INTO v_movs, v_qq
  FROM inventory_movements m
  JOIN products p ON p.id = m.product_id
  JOIN lots l ON l.id = m.lot_id
  WHERE upper(COALESCE(l.operation_type, 'COMPRA')) IN ('SECADO', 'PILADO', 'SECADO_PILADO')
    AND p.product_type IN ('RAW_MATERIAL', 'FINISHED_GOOD');
  RAISE NOTICE 'Aislamiento inventario servicios: se eliminarán % movimientos (neto % QQ) de materia prima/producto terminado de lotes de servicio.', v_movs, v_qq;
END $$;

-- Eliminación de los movimientos patrimoniales indebidos de lotes de servicio.
-- Solo RAW_MATERIAL y FINISHED_GOOD; los BYPRODUCT se conservan.
DELETE FROM inventory_movements m
USING products p, lots l
WHERE m.product_id = p.id
  AND m.lot_id = l.id
  AND upper(COALESCE(l.operation_type, 'COMPRA')) IN ('SECADO', 'PILADO', 'SECADO_PILADO')
  AND p.product_type IN ('RAW_MATERIAL', 'FINISHED_GOOD');

-- `inventory_stock` es una VISTA (SUM sobre inventory_movements), de modo que el
-- Stock Actual se recalcula solo al eliminar los movimientos. No hay tabla
-- materializada que actualizar.
