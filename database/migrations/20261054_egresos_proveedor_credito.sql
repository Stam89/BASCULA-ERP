-- Egresos de Caja con PROVEEDOR y modalidad CONTADO / A CRÉDITO.
--  · Contado (lo de siempre): el egreso es un cash_movement y descuenta la caja;
--    ahora puede llevar el proveedor (supplier_id). Históricos: sin proveedor = contado.
--  · A crédito: NO es un cash_movement (no toca el saldo de la caja). Se crea una
--    Cuenta por Pagar al proveedor (reference_type 'gasto_credito') que recuerda la
--    categoría del gasto y la sesión de caja donde se registró (para verla en su
--    historial). Al pagarla desde Por Pagar, el egreso entra a Caja con esa categoría.
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS categoria VARCHAR(80);
ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS subcategoria VARCHAR(120);
ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS origen_cash_register_id UUID REFERENCES cash_registers(id) ON DELETE SET NULL;
ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS created_by UUID;

CREATE INDEX IF NOT EXISTS idx_ap_origen_caja ON accounts_payable (origen_cash_register_id) WHERE origen_cash_register_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_mov_supplier ON cash_movements (supplier_id) WHERE supplier_id IS NOT NULL;
