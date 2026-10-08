-- «Contar tickets desde» por NÚMERO DE TICKET (pedido del dueño, 2026-10-08).
-- Antes el corte de la Báscula y el de la Bajada de carro era una FECHA; ahora es el
-- número de ticket de la báscula (raw_payload->>'numeroTicket', p. ej. «000 300» = 300),
-- que es único y correlativo. Si `desde_numero` está vacío se sigue usando la fecha
-- (`desde`), como antes (lo usa el borrado de datos de prueba).
-- Aditiva e idempotente: solo agrega columnas y las llena UNA vez con el número del
-- primer ticket desde la fecha vigente (mismo resultado que el corte por fecha).

ALTER TABLE bascula_config ADD COLUMN IF NOT EXISTS desde_numero BIGINT;
ALTER TABLE bajada_carro_config ADD COLUMN IF NOT EXISTS desde_numero BIGINT;

UPDATE bascula_config c
   SET desde_numero = x.n
  FROM (
    SELECT min(NULLIF(regexp_replace(coalesce(t.raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '')::bigint) AS n
      FROM mobile_synced_tickets t, bascula_config c2
     WHERE c2.id = 1 AND c2.desde IS NOT NULL
       AND lower(coalesce(t.raw_payload->>'modo', 'principal')) = 'principal'
       AND COALESCE(
             CASE WHEN t.raw_payload->>'fecha' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}'
                  THEN to_date(split_part(t.raw_payload->>'fecha', ' ', 1), 'DD/MM/YYYY') END,
             (to_timestamp(t.mobile_created_at / 1000.0) AT TIME ZONE 'America/Guayaquil')::date) >= c2.desde
  ) x
 WHERE c.id = 1 AND c.desde IS NOT NULL AND c.desde_numero IS NULL AND x.n IS NOT NULL;

UPDATE bajada_carro_config c
   SET desde_numero = x.n
  FROM (
    SELECT min(NULLIF(regexp_replace(coalesce(t.raw_payload->>'numeroTicket', ''), '[^0-9]', '', 'g'), '')::bigint) AS n
      FROM mobile_synced_tickets t, bajada_carro_config c2
     WHERE c2.id = 1 AND c2.desde IS NOT NULL
       AND lower(coalesce(t.raw_payload->>'modo', 'principal')) = 'principal'
       AND COALESCE(
             CASE WHEN t.raw_payload->>'fecha' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}'
                  THEN to_date(split_part(t.raw_payload->>'fecha', ' ', 1), 'DD/MM/YYYY') END,
             (to_timestamp(t.mobile_created_at / 1000.0) AT TIME ZONE 'America/Guayaquil')::date) >= c2.desde
  ) x
 WHERE c.id = 1 AND c.desde IS NOT NULL AND c.desde_numero IS NULL AND x.n IS NOT NULL;
