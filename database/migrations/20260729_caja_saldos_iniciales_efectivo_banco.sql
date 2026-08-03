-- Apertura de caja con saldo inicial separado en efectivo y banco.
ALTER TABLE cash_registers
  ADD COLUMN IF NOT EXISTS opening_balance_cash NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance_bank NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Para las cajas existentes, el saldo inicial total se conserva en efectivo.
UPDATE cash_registers SET opening_balance_cash = opening_balance WHERE opening_balance_cash = 0 AND opening_balance > 0;

-- Asegurar que el saldo total sigue siendo la suma de ambos (para compatibilidad).
UPDATE cash_registers SET opening_balance = COALESCE(opening_balance_cash, 0) + COALESCE(opening_balance_bank, 0)
  WHERE opening_balance <> COALESCE(opening_balance_cash, 0) + COALESCE(opening_balance_bank, 0);
