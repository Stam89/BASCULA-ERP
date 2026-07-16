-- 1) Se liquida el INGRESO DE MATERIA PRIMA, no el lote.
--
-- Al agricultor se le paga por lo que entregó (su pesaje), apenas ingresa, sin
-- esperar el secado. Además, desde la reestructura el lote se forma en la
-- secadora agrupando varios ingresos que pueden ser de agricultores distintos,
-- así que el lote ya no representa "el arroz de un agricultor".
ALTER TABLE liquidations ALTER COLUMN lot_id DROP NOT NULL;
ALTER TABLE liquidations ADD COLUMN IF NOT EXISTS weighing_ticket_id UUID REFERENCES weighing_tickets(id);

-- Un ingreso no se puede liquidar dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS idx_liquidations_ingreso_unico
  ON liquidations(weighing_ticket_id)
  WHERE weighing_ticket_id IS NOT NULL AND status <> 'CANCELLED';

-- 2) La caja puede ser de efectivo o de banco.
ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'EFECTIVO';
