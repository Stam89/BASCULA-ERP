-- Fusiona agricultores duplicados (mismo nombre, sin distinguir mayúsculas ni
-- espacios): conserva el más antiguo y repunta todas las referencias hacia él,
-- luego elimina los duplicados. Defensivo: solo actualiza tablas que existan y
-- tengan columna farmer_id. Seguro de re-ejecutar.
DO $$
DECLARE
  grp RECORD;
  keep_id UUID;
  dup_id UUID;
  tbl TEXT;
  tablas TEXT[] := ARRAY[
    'lots','weighing_tickets','farmer_advances','liquidations',
    'accounts_payable','accounts_receivable','mobile_synced_tickets',
    'maquila_orders','third_party_custody'
  ];
BEGIN
  FOR grp IN
    SELECT array_agg(id ORDER BY created_at ASC) AS ids
    FROM farmers
    GROUP BY lower(trim(full_name))
    HAVING count(*) > 1
  LOOP
    keep_id := grp.ids[1];
    FOREACH dup_id IN ARRAY grp.ids[2:cardinality(grp.ids)] LOOP
      FOREACH tbl IN ARRAY tablas LOOP
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'farmer_id'
        ) THEN
          EXECUTE format('UPDATE %I SET farmer_id = $1 WHERE farmer_id = $2', tbl) USING keep_id, dup_id;
        END IF;
      END LOOP;
      DELETE FROM farmers WHERE id = dup_id;
    END LOOP;
  END LOOP;
END $$;
