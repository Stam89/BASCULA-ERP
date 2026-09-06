-- Inmutabilidad histórica: se CONGELA la tarifa de servicio de pilado vigente al
-- finalizar el lote, en el propio cuadro de rendimiento. Si luego cambia la
-- tarifa en Configuración, los lotes anteriores conservan su valor. Aditiva.
ALTER TABLE production_yields
  ADD COLUMN IF NOT EXISTS tarifa_pilada_aplicada NUMERIC(12,4);

-- Backfill de lotes existentes: se congela la tarifa PILADO vigente HOY del socio
-- dueño del lote (mejor aproximación retroactiva; a futuro se guarda al cerrar).
UPDATE production_yields y
   SET tarifa_pilada_aplicada = ts.precio_por_qq
  FROM processing_batches b
  JOIN lots l ON l.id = b.lot_id
  JOIN LATERAL (
    SELECT t.precio_por_qq FROM tarifario_servicio t
     WHERE t.socio_id = l.accionista_id AND t.servicio = 'PILADO' AND t.is_active = true
       AND t.fecha_vigencia <= CURRENT_DATE
     ORDER BY t.fecha_vigencia DESC, t.created_at DESC LIMIT 1
  ) ts ON true
 WHERE b.id = y.processing_batch_id AND y.tarifa_pilada_aplicada IS NULL;
