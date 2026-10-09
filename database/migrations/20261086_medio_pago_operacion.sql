-- Efectivo o banco elegido en cada cobro, pago o venta (pedido del dueño 2026-10-09). El servidor lo pasa a la
-- transacción como `app.medio_pago`; el disparador lo usa cuando el movimiento no trae su medio. Una caja de EFECTIVO o
-- de BANCO tiene un solo medio; solo la MIXTA usa lo elegido. Un contra-asiento sigue copiando el medio del original.
-- Idempotente (reemplaza la función de 20261085).
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
