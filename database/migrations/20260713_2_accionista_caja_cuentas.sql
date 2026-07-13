-- Segunda fase de multi-accionista: separa también caja, gastos y cuentas por
-- pagar/cobrar. Los movimientos de caja (cash_movements) NO llevan columna
-- propia: quedan segregados a través de su caja (cash_register_id), ya que
-- cada accionista tiene su(s) propia(s) caja(s).

ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);
ALTER TABLE accounts_receivable ADD COLUMN IF NOT EXISTS accionista_id UUID REFERENCES accionistas(id);

-- Backfill al accionista por defecto para no romper datos existentes.
UPDATE cash_registers SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;
UPDATE expenses SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;
UPDATE accounts_payable SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;
UPDATE accounts_receivable SET accionista_id = '00000000-0000-0000-0000-000000000001' WHERE accionista_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_cash_registers_accionista_id ON cash_registers(accionista_id);
CREATE INDEX IF NOT EXISTS idx_expenses_accionista_id ON expenses(accionista_id);
CREATE INDEX IF NOT EXISTS idx_accounts_payable_accionista_id ON accounts_payable(accionista_id);
CREATE INDEX IF NOT EXISTS idx_accounts_receivable_accionista_id ON accounts_receivable(accionista_id);
