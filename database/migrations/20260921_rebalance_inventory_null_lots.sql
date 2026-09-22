-- Repara saldos historicos negativos en inventory_stock con lot_id NULL.
-- Causa: salidas antiguas de ventas/seleccion se registraban sin lot_id aunque
-- el stock positivo estuviera amarrado a lotes. Esto no cambia el total del
-- producto/socio/bodega: mueve cantidad desde lotes positivos hacia el saldo
-- sin lote para neutralizar negativos visuales.

DO $$
DECLARE
  neg RECORD;
  pos RECORD;
  needed NUMERIC;
  take_qty NUMERIC;
  repair_ref UUID;
BEGIN
  FOR neg IN
    SELECT product_id, warehouse_id, ownership, accionista_id, quantity
    FROM inventory_stock
    WHERE lot_id IS NULL
      AND quantity < -0.001
  LOOP
    needed := ABS(neg.quantity);
    repair_ref := uuid_generate_v4();

    FOR pos IN
      SELECT lot_id, quantity
      FROM inventory_stock
      WHERE product_id = neg.product_id
        AND warehouse_id = neg.warehouse_id
        AND ownership = neg.ownership
        AND accionista_id IS NOT DISTINCT FROM neg.accionista_id
        AND lot_id IS NOT NULL
        AND quantity > 0.001
      ORDER BY lot_id
    LOOP
      EXIT WHEN needed <= 0.001;
      take_qty := LEAST(needed, pos.quantity);

      INSERT INTO inventory_movements
        (product_id, warehouse_id, lot_id, movement, quantity, reference_type,
         reference_id, ownership, notes, accionista_id)
      VALUES
        (neg.product_id, neg.warehouse_id, NULL, 'ADJUSTMENT', take_qty,
         'repair_lot_negative_20260921', repair_ref, neg.ownership,
         'Rebalanceo historico: neutraliza salida antigua sin lote', neg.accionista_id),
        (neg.product_id, neg.warehouse_id, pos.lot_id, 'ADJUSTMENT', -take_qty,
         'repair_lot_negative_20260921', repair_ref, neg.ownership,
         'Rebalanceo historico: aplica salida antigua al lote real', neg.accionista_id);

      needed := needed - take_qty;
    END LOOP;

    IF needed > 0.001 THEN
      RAISE NOTICE 'Quedo negativo sin cubrir para product %, warehouse %, accionista %, cantidad %',
        neg.product_id, neg.warehouse_id, neg.accionista_id, needed;
    END IF;
  END LOOP;
END $$;

