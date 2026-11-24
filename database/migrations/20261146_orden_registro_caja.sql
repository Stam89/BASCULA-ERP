-- 🔢 Orden real en que se REGISTRÓ cada movimiento de caja (la fecha puede ser de un día anterior). Lo ya guardado toma el
-- orden de su fecha; lo nuevo, el de llegada. Solo sirve para ordenar la hoja: no cambia montos ni fechas.
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS registro BIGINT;
CREATE SEQUENCE IF NOT EXISTS cash_movements_registro_seq;
UPDATE cash_movements m SET registro = x.n
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, ctid) AS n FROM cash_movements) x
 WHERE x.id = m.id AND NOT EXISTS (SELECT 1 FROM cash_movements y WHERE y.registro IS NOT NULL);
SELECT setval('cash_movements_registro_seq', GREATEST((SELECT COALESCE(max(registro), 0) FROM cash_movements), 1));
ALTER TABLE cash_movements ALTER COLUMN registro SET DEFAULT nextval('cash_movements_registro_seq');
