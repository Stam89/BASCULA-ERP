-- El "cliente" que llega de la app de báscula es el agricultor. Vincula los
-- tickets del modo PRINCIPAL que quedaron sin agricultor, reutilizando el
-- agricultor existente con ese nombre o creándolo si no existe.
-- Seguro de re-ejecutar (solo toca los que siguen sin vincular).
DO $$
DECLARE
  t RECORD;
  fid UUID;
BEGIN
  FOR t IN
    SELECT id, trim(farmer_name) AS nm
    FROM mobile_synced_tickets
    WHERE farmer_id IS NULL
      AND length(trim(coalesce(farmer_name, ''))) >= 2
      AND lower(coalesce(raw_payload->>'modo', 'principal')) = 'principal'
  LOOP
    fid := NULL;
    SELECT f.id INTO fid
    FROM farmers f
    WHERE lower(trim(f.full_name)) = lower(t.nm)
    ORDER BY f.created_at ASC
    LIMIT 1;

    IF fid IS NULL THEN
      INSERT INTO farmers (full_name) VALUES (t.nm) RETURNING id INTO fid;
    END IF;

    UPDATE mobile_synced_tickets
    SET farmer_id = fid,
        accionista_id = COALESCE(accionista_id, (SELECT accionista_id FROM farmers WHERE id = fid))
    WHERE id = t.id;
  END LOOP;
END $$;
