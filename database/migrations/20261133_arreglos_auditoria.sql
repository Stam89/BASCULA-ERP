-- 🔍 Arreglos de la auditoría (2026-11-03).
-- La llave maestra del borrado quedó en claro en la auditoría: ya no se guarda y la que había se oculta.
UPDATE audit_logs SET new_data = jsonb_set(new_data, '{llave_maestra}', '"[oculto]"'::jsonb)
 WHERE new_data ? 'llave_maestra' AND new_data->>'llave_maestra' IS DISTINCT FROM '[oculto]';
-- Los socios también traen dinero del banco: sin esta categoría lo registraban como «Aporte del socio».
UPDATE cash_categories SET aplicable_a = 'AMBOS' WHERE codigo = 'RETIRO_BANCO' AND aplicable_a = 'MATRIZ';
-- El arranque ya no es una fecha fija: al «Borrar datos de prueba» queda el día anterior al borrado (saldos iniciales a ese corte).
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS corte_arranque DATE;
