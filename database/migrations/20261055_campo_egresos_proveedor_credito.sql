-- Transporte y Cosechadora: egresos con PROVEEDOR y modalidad CONTADO / A CRÉDITO
-- (igual que la Caja principal). Históricos: sin proveedor = contado.
--  · Contado: el egreso sale de la cuenta como siempre; guarda el proveedor.
--  · A crédito: NO sale de ninguna cuenta; se crea una CxP de Transporte
--    (campo_cxp) al proveedor con su categoría y máquina. Al abonarla, el pago
--    lleva esa categoría/máquina (los reportes lo cuentan en su rubro).
ALTER TABLE campo_movimientos ADD COLUMN IF NOT EXISTS proveedor VARCHAR(160);

ALTER TABLE campo_cxp ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES campo_categorias_gasto(id) ON DELETE SET NULL;
ALTER TABLE campo_cxp ADD COLUMN IF NOT EXISTS activo_id UUID REFERENCES campo_activos(id) ON DELETE SET NULL;
ALTER TABLE campo_cxp ADD COLUMN IF NOT EXISTS vence DATE;
ALTER TABLE campo_cxp ADD COLUMN IF NOT EXISTS origen VARCHAR(20);  -- 'EGRESO_CREDITO' si nace de un egreso a crédito
