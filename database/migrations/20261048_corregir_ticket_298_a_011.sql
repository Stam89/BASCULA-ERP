-- Corrección puntual (error humano en la báscula): el ticket #000 298 (CUCHO,
-- 2460 kg) se registró como CORRIENTE (calificación 230) pero es GRANO 0.11
-- (calificación 225). Ya estaba ingresado y en el grupo de secado del lote
-- 00004-28-09-26, así que la báscula ya no lo actualiza.
--
-- Se pasa a 0.11 con calificación 225: QQ = 2460 × 2.2 / 225 = 24.053
-- (antes 23.530), en el ingreso, el ticket, la cáscara en bodega, el grupo de
-- secado, el informe del túnel y las labores de cuadrilla AÚN NO PAGADAS.
-- Guardas: solo corre si el ingreso sigue CORRIENTE y el túnel no se ha
-- finalizado en Producción. Idempotente (la 2.ª vez ya es 0.11 y no hace nada).
-- De paso, el informe del túnel toma los nombres de agricultor ya corregidos
-- (20261047) en su foto de ingresos.

DROP TABLE IF EXISTS _fix298;
CREATE TEMP TABLE _fix298 ON COMMIT DROP AS
SELECT w.id AS ingreso_id, m.id AS ticket_id, r.drying_report_id, w.lot_id,
       w.quintals AS qq_viejo,
       round(w.gross_weight - w.tare_weight, 3) AS neto,
       round((w.gross_weight - w.tare_weight) * 2.2 / 225, 3) AS qq_nuevo
  FROM mobile_synced_tickets m
  JOIN weighing_tickets w ON w.id = m.weighing_ticket_id
  LEFT JOIN drying_tunnel_report_lots r ON r.weighing_ticket_id = w.id
 WHERE ltrim(regexp_replace(COALESCE(m.raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '0') = '298'
   AND w.rice_type = 'CORRIENTE'
   AND round(w.gross_weight - w.tare_weight) = 2460
   AND m.liquidated_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM processing_batches pb
                    WHERE pb.drying_report_id = r.drying_report_id OR pb.lot_id = w.lot_id);

UPDATE weighing_tickets w
   SET rice_type = '0.11', qualification = 225, quintals = f.qq_nuevo,
       notes = trim(COALESCE(w.notes, '') || ' · Corregido a 0.11 (error de báscula)')
  FROM _fix298 f WHERE w.id = f.ingreso_id;

UPDATE mobile_synced_tickets m
   SET qualification = 225, quintals = f.qq_nuevo,
       raw_payload = raw_payload || jsonb_build_object('calidad', 'GRANO 0.11', 'calidadCorregidaDesde', 'CORRIENTE')
  FROM _fix298 f WHERE m.id = f.ticket_id;

UPDATE inventory_movements im
   SET product_id = (SELECT id FROM products WHERE code = 'CASCARA-011' LIMIT 1),
       quantity = f.qq_nuevo
  FROM _fix298 f
 WHERE im.reference_type = 'weighing_tickets' AND im.reference_id = f.ingreso_id AND im.movement = 'IN'
   AND EXISTS (SELECT 1 FROM products WHERE code = 'CASCARA-011');

UPDATE drying_tunnel_report_lots r
   SET quintals = f.qq_nuevo
  FROM _fix298 f WHERE r.weighing_ticket_id = f.ingreso_id;

-- Labores de cuadrilla del túnel que aún no se pagaron: cantidad = QQ del túnel.
UPDATE drying_tunnel_cuadrilla a
   SET quintals = a.quintals + (f.qq_nuevo - f.qq_viejo)
  FROM _fix298 f, drying_tunnel_reports d
 WHERE a.drying_report_id = f.drying_report_id AND d.id = f.drying_report_id
   AND a.quintals = d.total_quintals;

UPDATE cuadrilla_entries e
   SET quantity = e.quantity + (f.qq_nuevo - f.qq_viejo),
       subtotal = round((e.quantity + (f.qq_nuevo - f.qq_viejo)) * e.unit_rate, 2)
  FROM _fix298 f, drying_tunnel_reports d
 WHERE e.origen = 'SECADORA' AND e.referencia_id = f.drying_report_id AND d.id = f.drying_report_id
   AND e.paid_at IS NULL AND e.quantity = d.total_quintals;

UPDATE drying_tunnel_reports d
   SET total_quintals = d.total_quintals + (f.qq_nuevo - f.qq_viejo)
  FROM _fix298 f WHERE d.id = f.drying_report_id;

-- Informe del túnel: foto de ingresos (QQ y agricultor) y total.
UPDATE lot_process_reports p
   SET report_data = p.report_data || jsonb_build_object(
         'total_quintals', d.total_quintals::float,
         'lots', (SELECT jsonb_agg(
                    CASE WHEN r.weighing_ticket_id IS NULL THEN x
                         ELSE x || jsonb_build_object('quintals', r.quintals::float, 'farmer_name', r.farmer_name) END
                    ORDER BY ord)
                    FROM jsonb_array_elements(p.report_data->'lots') WITH ORDINALITY AS t(x, ord)
                    LEFT JOIN drying_tunnel_report_lots r
                      ON r.drying_report_id = d.id AND r.weighing_ticket_id::text = x->>'weighing_ticket_id'))
  FROM _fix298 f
  JOIN drying_tunnel_reports d ON d.id = f.drying_report_id
 WHERE p.id = d.process_report_id
   AND jsonb_typeof(p.report_data->'lots') = 'array';
