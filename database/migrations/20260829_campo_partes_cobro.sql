-- Enlaza un Parte Diario de cosecha con el cobro que genera. Al "Generar cobro"
-- se crea un campo_servicio (tipo cosecha) desde el parte y el parte pasa a
-- estado 'cobrado', guardando el servicio_id. El cobro real (abonos/saldo) se
-- maneja con la maquinaria existente de campo_servicios / campo_servicios_saldo.
-- Aditiva. DOWN al final.
ALTER TABLE campo_partes ADD COLUMN IF NOT EXISTS servicio_id UUID REFERENCES campo_servicios(id);
CREATE INDEX IF NOT EXISTS idx_campo_partes_servicio ON campo_partes (servicio_id) WHERE servicio_id IS NOT NULL;

-- ── DOWN (reversa) ──────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_campo_partes_servicio;
--   ALTER TABLE campo_partes DROP COLUMN IF EXISTS servicio_id;
--   DELETE FROM schema_migrations WHERE filename = '20260829_campo_partes_cobro.sql';
