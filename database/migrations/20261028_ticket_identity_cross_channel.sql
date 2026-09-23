-- Un mismo ticket puede llegar al ERP por WiFi directo, Firebase o un reintento.
-- El canal/dispositivo no forma parte de su identidad de negocio.
-- Identidad definitiva: negocio Firebase (o principal) + modo + numero canonico.

-- Consolida solamente copias todavia no procesadas. Si existiera mas de una
-- copia ya convertida/liquidada, la creacion del indice se detendra para exigir
-- revision manual en vez de borrar datos contables reales.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        COALESCE(NULLIF(raw_payload->>'firebaseNegocioId', ''), 'principal'),
        lower(COALESCE(NULLIF(raw_payload->>'modo', ''), 'principal')),
        COALESCE(
          NULLIF(ltrim(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '0'), ''),
          '0'
        )
      ORDER BY
        (weighing_ticket_id IS NOT NULL) DESC,
        (liquidated_at IS NOT NULL) DESC,
        mobile_updated_at DESC,
        synced_at DESC,
        id DESC
    ) AS position
  FROM mobile_synced_tickets
  WHERE NULLIF(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '') IS NOT NULL
)
DELETE FROM mobile_synced_tickets ticket
USING ranked duplicate
WHERE ticket.id = duplicate.id
  AND duplicate.position > 1
  AND ticket.weighing_ticket_id IS NULL
  AND ticket.liquidated_at IS NULL;

DROP INDEX IF EXISTS uq_mobile_synced_tickets_identity_v2;

CREATE UNIQUE INDEX uq_mobile_synced_tickets_identity_v2
ON mobile_synced_tickets (
  (COALESCE(NULLIF(raw_payload->>'firebaseNegocioId', ''), 'principal')),
  (lower(COALESCE(NULLIF(raw_payload->>'modo', ''), 'principal'))),
  (COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '0'), ''), '0'))
)
WHERE NULLIF(regexp_replace(COALESCE(raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '') IS NOT NULL;
