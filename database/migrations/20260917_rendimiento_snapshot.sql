-- "Foto" del cuadro de rendimiento del lote al finalizar el pilado (estilo Excel
-- de la piladora): cáscara de entrada, arroz blanco total (tulas + sacos),
-- desglose de subproductos con libras, y porcentajes de rendimiento — todo
-- congelado al cierre. Independiente por accionista (el lote ya guarda su dueño;
-- el snapshot incluye accionista para la foto). Aditiva.
ALTER TABLE production_yields
  ADD COLUMN IF NOT EXISTS rendimiento_snapshot JSONB;
