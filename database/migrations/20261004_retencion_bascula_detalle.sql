-- Humaniza el detalle de las RETENCIONES DE BÁSCULA existentes: reemplaza la
-- referencia cruda al número de liquidación (#LIQ-…) por un texto legible con el
-- peso/ticket de báscula y el agricultor de origen. Aplica tanto a la cuenta por
-- COBRAR de la Matriz (CEYRO) como a la cuenta por PAGAR espejo del socio.
-- La agrupación por socio se resuelve en el endpoint (join a la liquidación), no
-- depende de este texto. Idempotente: re-ejecutar recalcula el mismo detalle.

UPDATE accounts_receivable ar
SET description = 'Retención de báscula - Ticket/Peso #'
  || COALESCE(NULLIF(btrim(sub.ticket_nro), ''), 's/n')
  || ' - Agricultor: ' || COALESCE(sub.farmer_name, 'sin agricultor')
FROM (
  SELECT liq.id AS liq_id,
         f.full_name AS farmer_name,
         COALESCE(m.raw_payload->>'numeroTicket', w.ticket_number) AS ticket_nro
  FROM liquidations liq
  LEFT JOIN farmers f ON f.id = liq.farmer_id
  LEFT JOIN weighing_tickets w ON w.id = liq.weighing_ticket_id
  LEFT JOIN mobile_synced_tickets m ON m.weighing_ticket_id = w.id
) sub
WHERE ar.reference_type = 'retencion_matriz' AND ar.reference_id = sub.liq_id;

UPDATE accounts_payable ap
SET description = 'Retención de báscula - Ticket/Peso #'
  || COALESCE(NULLIF(btrim(sub.ticket_nro), ''), 's/n')
  || ' - Agricultor: ' || COALESCE(sub.farmer_name, 'sin agricultor')
FROM (
  SELECT liq.id AS liq_id,
         f.full_name AS farmer_name,
         COALESCE(m.raw_payload->>'numeroTicket', w.ticket_number) AS ticket_nro
  FROM liquidations liq
  LEFT JOIN farmers f ON f.id = liq.farmer_id
  LEFT JOIN weighing_tickets w ON w.id = liq.weighing_ticket_id
  LEFT JOIN mobile_synced_tickets m ON m.weighing_ticket_id = w.id
) sub
WHERE ap.reference_type = 'retencion_matriz' AND ap.reference_id = sub.liq_id;
