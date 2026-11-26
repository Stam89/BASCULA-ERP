-- 📒 Estado de cuenta con historial (pedido del dueño 2026-11-26): cuentas corrientes como «CECILIA SUELDO», préstamos o
-- anticipos, donde el saldo sube (cargos) y baja (abonos, cruces). Aditiva e idempotente: no reescribe ninguna cuenta.
--
-- 1) Bitácora de cada cambio de monto, saldo o estado de una cuenta por cobrar o por pagar. Así cada abono (también los
--    que no pasan por caja: cruces, anticipos aplicados, descuentos) queda con su fecha exacta en el estado de cuenta.
--    La llenan los disparadores; nadie la edita.
CREATE TABLE IF NOT EXISTS cuenta_saldo_eventos (
  id             BIGSERIAL PRIMARY KEY,
  tabla          VARCHAR(30) NOT NULL,
  cuenta_id      UUID NOT NULL,
  monto_antes    NUMERIC(14,2),
  monto_despues  NUMERIC(14,2),
  saldo_antes    NUMERIC(14,2),
  saldo_despues  NUMERIC(14,2),
  estado_antes   TEXT,
  estado_despues TEXT,
  creado         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cuenta_saldo_eventos_cuenta ON cuenta_saldo_eventos (cuenta_id, id);

CREATE OR REPLACE FUNCTION registrar_evento_de_saldo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.balance IS DISTINCT FROM OLD.balance OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO cuenta_saldo_eventos (tabla, cuenta_id, monto_antes, monto_despues, saldo_antes, saldo_despues, estado_antes, estado_despues)
    VALUES (TG_TABLE_NAME, NEW.id, OLD.amount, NEW.amount, OLD.balance, NEW.balance, OLD.status::text, NEW.status::text);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_ap_evento_de_saldo ON accounts_payable;
CREATE TRIGGER trg_ap_evento_de_saldo AFTER UPDATE ON accounts_payable
  FOR EACH ROW EXECUTE FUNCTION registrar_evento_de_saldo();
DROP TRIGGER IF EXISTS trg_ar_evento_de_saldo ON accounts_receivable;
CREATE TRIGGER trg_ar_evento_de_saldo AFTER UPDATE ON accounts_receivable
  FOR EACH ROW EXECUTE FUNCTION registrar_evento_de_saldo();

-- 2) «+ Aumentar deuda / Cargo» usa la deuda manual: comprobante (factura, rol, recibo…) y, en Por Pagar, la categoría
--    de Caja cuando el cargo es un gasto a crédito (sueldo del mes, servicio): al pagarlo cuenta como gasto de ese rubro.
ALTER TABLE deudas_manuales ADD COLUMN IF NOT EXISTS comprobante TEXT;
ALTER TABLE deudas_manuales ADD COLUMN IF NOT EXISTS categoria VARCHAR(60);
ALTER TABLE deudas_manuales ADD COLUMN IF NOT EXISTS editado_at TIMESTAMPTZ;
ALTER TABLE deudas_manuales ADD COLUMN IF NOT EXISTS editado_nota TEXT;
