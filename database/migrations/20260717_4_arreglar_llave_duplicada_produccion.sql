-- "Llave duplicada viola restricción de unicidad" al finalizar el lote.
--
-- Causa: cuando el lote pasó a nacer en la secadora, drying_tunnel_report_lots
-- pasó a guardar UNA FILA POR PESO DE MATERIA PRIMA (por ticket de báscula), y
-- todas esas filas comparten el mismo lote. Pero processing_batch_drying_lots
-- se quedó con la forma vieja (una fila por lote): su llave primaria es
-- (processing_batch_id, lot_id).
--
-- Al finalizar, el cierre recorre los pesos del túnel e inserta uno por uno; a
-- partir del segundo peso repite el mismo lot_id y Postgres rechaza la fila.
-- Por eso solo falla en túneles con 2 o más pesos (túnel 1 de STALYN y túnel 3
-- de ROVINSON), y un túnel de un solo peso sí cierra.
--
-- Solución: darle a esta tabla la misma forma que a la del secado — llave
-- propia y una fila por peso — para que conserve el detalle de cada agricultor.
ALTER TABLE processing_batch_drying_lots
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT uuid_generate_v4(),
  ADD COLUMN IF NOT EXISTS weighing_ticket_id UUID REFERENCES weighing_tickets(id) ON DELETE SET NULL;

ALTER TABLE processing_batch_drying_lots
  DROP CONSTRAINT IF EXISTS processing_batch_drying_lots_pkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processing_batch_drying_lots_pkey'
  ) THEN
    ALTER TABLE processing_batch_drying_lots ADD PRIMARY KEY (id);
  END IF;
END $$;

-- Sigue sin poder entrar dos veces el mismo peso al mismo proceso: eso sí sería
-- un duplicado real.
CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_batch_drying_lots_ticket
  ON processing_batch_drying_lots(processing_batch_id, weighing_ticket_id)
  WHERE weighing_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_processing_batch_drying_lots_lot
  ON processing_batch_drying_lots(lot_id);
