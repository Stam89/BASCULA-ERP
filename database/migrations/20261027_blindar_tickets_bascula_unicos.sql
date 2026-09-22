-- Blindaje definitivo contra duplicados de tickets importados desde Bascula.
-- La importacion ya usa un ID estable, pero estos indices protegen la base aun
-- si una fuente externa envia el mismo ticket con otro id.

CREATE UNIQUE INDEX IF NOT EXISTS uq_mobile_synced_tickets_identity_v2
ON mobile_synced_tickets (
  (COALESCE(NULLIF(raw_payload->>'firebaseNegocioId', ''), device_id, 'sin-negocio')),
  (lower(COALESCE(NULLIF(raw_payload->>'modo', ''), 'principal'))),
  (COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '0'), ''), '0'))
)
WHERE NULLIF(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mobile_synced_tickets_weighing_ticket_id
ON mobile_synced_tickets (weighing_ticket_id)
WHERE weighing_ticket_id IS NOT NULL;
