-- Nómina → Cuadrilla · «CAMBIO DE SACO»: el saco que se recupera y su destino.
--  · cuadrilla_entries: qué tipo de saco se recuperó (id del catálogo + su nombre
--    al momento) y a dónde fue (BODEGA = segunda/usados, DESCARTE = basura).
--    Todo NULL en los registros históricos y en las demás actividades.
--  · sack_movements.ref_cuadrilla: la ENTRADA de sacos usados que generó ese
--    registro (para revertirla si se edita o elimina).
-- Los sacos recuperados entran a un tipo APARTE «<tipo> (Usado)», categoría
-- USADO y sin product_id: nunca se mezclan con los nuevos ni se usan para empacar.
-- Aditiva e idempotente.
ALTER TABLE cuadrilla_entries ADD COLUMN IF NOT EXISTS saco_recuperado_id UUID;
ALTER TABLE cuadrilla_entries ADD COLUMN IF NOT EXISTS marca_saco_recuperado TEXT;
ALTER TABLE cuadrilla_entries ADD COLUMN IF NOT EXISTS destino_saco VARCHAR(20);
ALTER TABLE sack_movements ADD COLUMN IF NOT EXISTS ref_cuadrilla UUID;
CREATE INDEX IF NOT EXISTS idx_sack_movements_ref_cuadrilla
  ON sack_movements (ref_cuadrilla) WHERE ref_cuadrilla IS NOT NULL;
