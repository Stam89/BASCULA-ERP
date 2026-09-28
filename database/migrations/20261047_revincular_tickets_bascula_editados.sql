-- Tickets de báscula a los que en la app le CAMBIARON el cliente después de
-- sincronizar: el ERP actualizaba el nombre pero conservaba el agricultor
-- anterior (p. ej. ticket "CUCHO" enlazado a DON FORTA), y al ingresarlo a
-- Secado aparecía con el otro nombre.
--
-- Se re-vinculan SOLO los que:
--   * no están liquidados (ni el ticket ni el lote donde ya entró),
--   * su agricultor enlazado no coincide con el nombre de la báscula (ni por alias),
--   * y el nombre de la báscula SÍ corresponde a un agricultor (exacto o alias).
-- Si ya se ingresó (y aun si ya está en un grupo de secado), se corrige también
-- el ingreso y el nombre guardado en el reporte de secado.
-- Idempotente: al re-vincular, la condición deja de cumplirse.

DROP TABLE IF EXISTS _revincular;
CREATE TEMP TABLE _revincular ON COMMIT DROP AS
SELECT m.id, m.farmer_id AS viejo, m.weighing_ticket_id,
       COALESCE(
         (SELECT f.id FROM farmers f
           WHERE lower(trim(f.full_name)) = lower(trim(m.farmer_name))
           ORDER BY f.created_at ASC LIMIT 1),
         (SELECT a.agricultor_id FROM agricultor_alias a
           WHERE lower(trim(a.alias_nombre)) = lower(trim(m.farmer_name)) LIMIT 1)
       ) AS nuevo
  FROM mobile_synced_tickets m
  JOIN farmers fv ON fv.id = m.farmer_id
  LEFT JOIN weighing_tickets w ON w.id = m.weighing_ticket_id
 WHERE m.liquidated_at IS NULL
   AND lower(trim(m.farmer_name)) <> lower(trim(fv.full_name))
   AND NOT EXISTS (
     SELECT 1 FROM agricultor_alias a
      WHERE a.agricultor_id = m.farmer_id
        AND lower(trim(a.alias_nombre)) = lower(trim(m.farmer_name))
   )
   AND (w.lot_id IS NULL OR NOT EXISTS (SELECT 1 FROM liquidations lq WHERE lq.lot_id = w.lot_id));

DELETE FROM _revincular WHERE nuevo IS NULL OR nuevo = viejo;

UPDATE weighing_tickets w
   SET farmer_id = v.nuevo
  FROM _revincular v
 WHERE w.id = v.weighing_ticket_id
   AND w.farmer_id = v.viejo;

UPDATE drying_tunnel_report_lots r
   SET farmer_name = f.full_name
  FROM _revincular v
  JOIN farmers f ON f.id = v.nuevo
 WHERE r.weighing_ticket_id = v.weighing_ticket_id;

UPDATE mobile_synced_tickets m
   SET farmer_id = v.nuevo
  FROM _revincular v
 WHERE m.id = v.id;
