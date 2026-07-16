-- Con el modelo anterior, cada ticket de báscula creaba su propio "lote".
-- Eso ya no es así: la báscula ingresa materia prima y el lote se forma en la
-- secadora agrupando varios ingresos. Esos lotes viejos (uno por ticket) dejan
-- a la materia prima atrapada y no aparece disponible para armar el lote.
--
-- Se deshacen: sus ingresos y el inventario quedan libres, y el lote falso se
-- elimina. Solo se tocan los lotes que NO avanzaron en el proceso (sin secado,
-- sin pilada, sin liquidación y sin venta), así no se pierde nada real.
DO $$
DECLARE
  l RECORD;
BEGIN
  FOR l IN
    SELECT lo.id
    FROM lots lo
    WHERE NOT EXISTS (SELECT 1 FROM drying_tunnel_reports d WHERE d.lot_id = lo.id)
      AND NOT EXISTS (SELECT 1 FROM drying_tunnel_report_lots dl WHERE dl.lot_id = lo.id)
      AND NOT EXISTS (SELECT 1 FROM processing_batches b WHERE b.lot_id = lo.id)
      AND NOT EXISTS (SELECT 1 FROM liquidations q WHERE q.lot_id = lo.id)
      AND NOT EXISTS (SELECT 1 FROM sale_items s WHERE s.lot_id = lo.id)
  LOOP
    -- El ingreso de materia prima y su inventario vuelven a quedar sin lote.
    UPDATE weighing_tickets SET lot_id = NULL WHERE lot_id = l.id;
    UPDATE inventory_movements SET lot_id = NULL WHERE lot_id = l.id;
    -- El ticket de báscula ya se enlaza con su ingreso (weighing_ticket_id);
    -- este lot_id es del modelo viejo y se suelta.
    UPDATE mobile_synced_tickets SET lot_id = NULL WHERE lot_id = l.id;
    DELETE FROM lot_process_reports WHERE lot_id = l.id;
    DELETE FROM lots WHERE id = l.id;
  END LOOP;
END $$;
