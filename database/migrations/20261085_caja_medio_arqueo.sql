-- Caja (auditoría 2026-10-08):
--  1) MEDIO de cada movimiento (EFECTIVO o BANCO): en una caja MIXTA el sistema no sabía cuánto efectivo debía haber
--     en la gaveta. Si el que registra no lo dice, se toma del tipo de caja (BANCO → BANCO; resto → EFECTIVO) y un
--     contra-asiento copia el medio del movimiento que anula. Así no hay que tocar cada lugar que registra dinero.
--  2) ARQUEO al cerrar: efectivo contado, diferencia y quién cerró (closing_balance/closed_by ya existían sin usarse).
-- Aditiva e idempotente.
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS medio VARCHAR(10);
ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS closing_cash_counted NUMERIC(14,2);
ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS closing_bank_counted NUMERIC(14,2);
ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS closing_diferencia NUMERIC(14,2);
ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS closing_notas TEXT;

CREATE OR REPLACE FUNCTION cash_movements_medio_default() RETURNS trigger AS $$
BEGIN
  IF NEW.medio IS NULL AND NEW.reversal_of IS NOT NULL THEN
    SELECT medio INTO NEW.medio FROM cash_movements WHERE id = NEW.reversal_of;
  END IF;
  IF NEW.medio IS NULL THEN
    SELECT CASE WHEN tipo = 'BANCO' THEN 'BANCO' ELSE 'EFECTIVO' END INTO NEW.medio FROM cash_registers WHERE id = NEW.cash_register_id;
  END IF;
  IF NEW.medio IS NULL THEN NEW.medio := 'EFECTIVO'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cash_movements_medio ON cash_movements;
CREATE TRIGGER trg_cash_movements_medio BEFORE INSERT ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION cash_movements_medio_default();

-- Movimientos que ya existían: mismo criterio.
UPDATE cash_movements m SET medio = CASE WHEN r.tipo = 'BANCO' THEN 'BANCO' ELSE 'EFECTIVO' END
  FROM cash_registers r WHERE r.id = m.cash_register_id AND m.medio IS NULL;

DO $$ BEGIN
  ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_medio_chk CHECK (medio IN ('EFECTIVO', 'BANCO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Categorías del arqueo: solo las usa el cierre de caja (inactivas = no salen en el formulario de movimientos).
INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a, activo)
SELECT v.codigo, v.nombre, v.tipo, 'AMBOS', false FROM (VALUES
  ('FALTANTE_CAJA', 'Faltante de caja (arqueo)', 'EGRESO'),
  ('SOBRANTE_CAJA', 'Sobrante de caja (arqueo)', 'INGRESO')
) AS v(codigo, nombre, tipo)
WHERE NOT EXISTS (SELECT 1 FROM cash_categories c WHERE c.codigo = v.codigo);
