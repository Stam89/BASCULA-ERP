-- 🔢 Hoja del día: el renglón usa la misma numeración de registro que los movimientos de caja (20261146), para que los que no
-- mueven la gaveta también queden en su orden real. No cambia montos ni fechas.
ALTER TABLE caja_renglones ADD COLUMN IF NOT EXISTS registro BIGINT;
UPDATE caja_renglones r
   SET registro = COALESCE((SELECT min(m.registro) FROM cash_movements m WHERE m.renglon_id = r.id AND m.reversal_of IS NULL),
                           (SELECT max(m.registro) FROM cash_movements m WHERE m.created_at <= r.created_at), 0)
 WHERE r.registro IS NULL;
ALTER TABLE caja_renglones ALTER COLUMN registro SET DEFAULT nextval('cash_movements_registro_seq');
