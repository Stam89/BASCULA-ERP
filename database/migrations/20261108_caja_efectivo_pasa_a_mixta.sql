-- COBRO POR TRANSFERENCIA EN UNA CAJA DE SOLO EFECTIVO (pedido del dueño 2026-10-16: «en ese abono no existe si fue
-- en efectivo, transferencia»). Antes, si la caja era de EFECTIVO, lo que llegaba al banco se guardaba como efectivo.
-- Ahora, cuando la operación dice BANCO y la caja es de EFECTIVO, la caja pasa sola a MIXTA (efectivo + banco, banco
-- inicial 0) y el movimiento entra por el BANCO. Los movimientos que ya tenía quedan como efectivo.
-- Idempotente (reemplaza la función de 20261086; mismo disparador BEFORE INSERT).
CREATE OR REPLACE FUNCTION cash_movements_medio_default() RETURNS trigger AS $$
DECLARE
  tipo_caja text;
  elegido text;
BEGIN
  IF NEW.medio IS NULL AND NEW.reversal_of IS NOT NULL THEN
    SELECT medio INTO NEW.medio FROM cash_movements WHERE id = NEW.reversal_of;
  END IF;
  IF NEW.medio IS NULL THEN
    SELECT tipo INTO tipo_caja FROM cash_registers WHERE id = NEW.cash_register_id;
    elegido := NULLIF(current_setting('app.medio_pago', true), '');
    IF tipo_caja = 'EFECTIVO' AND elegido = 'BANCO' THEN
      UPDATE cash_movements SET medio = 'EFECTIVO' WHERE cash_register_id = NEW.cash_register_id AND medio IS NULL;
      UPDATE cash_registers
         SET tipo = 'MIXTO',
             opening_balance_cash = COALESCE(opening_balance_cash, opening_balance, 0),
             opening_balance_bank = COALESCE(opening_balance_bank, 0)
       WHERE id = NEW.cash_register_id;
      tipo_caja := 'MIXTO';
    END IF;
    NEW.medio := CASE
      WHEN tipo_caja = 'BANCO' THEN 'BANCO'
      WHEN tipo_caja = 'EFECTIVO' THEN 'EFECTIVO'
      WHEN elegido IN ('EFECTIVO', 'BANCO') THEN elegido
      ELSE 'EFECTIVO'
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
