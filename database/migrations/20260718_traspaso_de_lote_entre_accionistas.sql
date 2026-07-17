-- Traspaso de un lote de un accionista a otro cuando ya empezó a liquidarse.
--
-- Antes se bloqueaba: "Este lote ya tiene liquidación: no se puede cambiar de
-- accionista". Pero en el trabajo pasa que un lote se compra a nombre de uno y
-- termina siendo de otro, y para entonces ya se le adelantó plata al agricultor.
--
-- Cómo queda la plata (ejemplo real del lote LT-...J7G8, liquidado en $5.051,70
-- a Melany, de los cuales ROVINSON ya canceló $1.000):
--   · Lo YA CANCELADO por quien entrega ($1.000) se convierte en una cuenta por
--     cobrar suya y una cuenta por pagar del que recibe. Así recupera lo que
--     puso de su caja.
--   · Lo PENDIENTE con el agricultor ($4.051,70) pasa al que recibe, que le
--     paga directo de ahí en adelante.
-- El que recibe termina desembolsando $1.000 + $4.051,70 = $5.051,70, que es el
-- costo real del lote; y el que entrega queda en cero.
--
-- Esta tabla es el registro del traspaso: sin ella no habría forma de saber de
-- dónde salió esa deuda entre accionistas.
CREATE TABLE IF NOT EXISTS lot_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  from_accionista_id UUID NOT NULL REFERENCES accionistas(id),
  to_accionista_id UUID NOT NULL REFERENCES accionistas(id),
  -- Lo que el que entrega ya había pagado de su caja: la deuda entre accionistas.
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Lo que aún se le debe al agricultor y se traslada al que recibe.
  amount_pending NUMERIC(14,2) NOT NULL DEFAULT 0,
  receivable_id UUID REFERENCES accounts_receivable(id) ON DELETE SET NULL,
  payable_id UUID REFERENCES accounts_payable(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lot_transfers_accionistas_distintos CHECK (from_accionista_id <> to_accionista_id)
);

CREATE INDEX IF NOT EXISTS idx_lot_transfers_lot ON lot_transfers(lot_id);
CREATE INDEX IF NOT EXISTS idx_lot_transfers_from ON lot_transfers(from_accionista_id);
CREATE INDEX IF NOT EXISTS idx_lot_transfers_to ON lot_transfers(to_accionista_id);
