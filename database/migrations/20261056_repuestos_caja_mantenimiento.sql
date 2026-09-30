-- Repuestos de planta conectados con CAJA y MANTENIMIENTO.
--  · Compra desde Caja (categoría Repuestos) → entra al stock. A crédito: la
--    entrada queda enlazada a su Cuenta por Pagar (payable_id) para revertirla
--    si se anula.
--  · Mantenimiento de Caja puede usar repuestos del stock: salen del inventario
--    y el mantenimiento guarda su valor aparte (ya se pagaron al comprarlos).
ALTER TABLE repuesto_movimientos ADD COLUMN IF NOT EXISTS payable_id UUID REFERENCES accounts_payable(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_repuesto_mov_payable ON repuesto_movimientos (payable_id) WHERE payable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repuesto_mov_mant ON repuesto_movimientos (maintenance_id) WHERE maintenance_id IS NOT NULL;

-- Valor de los repuestos tomados del inventario en un mantenimiento: NO es plata
-- que sale hoy de la caja (amount = lo pagado ahora), es costo de la máquina.
ALTER TABLE equipment_maintenance ADD COLUMN IF NOT EXISTS repuestos_stock_valor NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE equipment_maintenance ADD COLUMN IF NOT EXISTS repuestos_detalle TEXT;

-- Los usos registrados desde Repuestos → «Usar» guardaban el valor como monto
-- pagado (se contaba dos veces: al comprar y al usar). Pasan a repuestos_stock_valor.
UPDATE equipment_maintenance em
   SET repuestos_stock_valor = em.amount, amount = 0, parts_cost = 0,
       repuestos_detalle = COALESCE(em.repuestos_detalle, regexp_replace(em.description, '^Cambio de repuesto:\s*', ''))
 WHERE em.maintenance_type = 'REPUESTO'
   AND em.description LIKE 'Cambio de repuesto:%(del stock)'
   AND em.repuestos_stock_valor = 0
   AND EXISTS (SELECT 1 FROM repuesto_movimientos m WHERE m.maintenance_id = em.id);
