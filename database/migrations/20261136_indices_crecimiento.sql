-- 📈 Índices para cuando crezcan los datos: hoy las tablas son pequeñas y no se nota, pero estas columnas se cruzan en casi
-- todas las pantallas (agricultores con fomentos y tickets, cuentas con ventas y liquidaciones) y con un año de operación
-- cada consulta recorrería la tabla completa. Solo agregan índices: no cambian ningún dato.
CREATE INDEX IF NOT EXISTS idx_mst_farmer ON mobile_synced_tickets (farmer_id);
CREATE INDEX IF NOT EXISTS idx_mst_lot ON mobile_synced_tickets (lot_id);
CREATE INDEX IF NOT EXISTS idx_fomentos_farmer ON fomentos (farmer_id);
CREATE INDEX IF NOT EXISTS idx_fomento_entregas_fomento ON fomento_entregas (fomento_id);
CREATE INDEX IF NOT EXISTS idx_fomento_pagos_fomento ON fomento_pagos (fomento_id);
CREATE INDEX IF NOT EXISTS idx_ap_supplier ON accounts_payable (supplier_id);
CREATE INDEX IF NOT EXISTS idx_ap_liquidation ON accounts_payable (liquidation_id);
CREATE INDEX IF NOT EXISTS idx_ap_status ON accounts_payable (status);
CREATE INDEX IF NOT EXISTS idx_ar_sale ON accounts_receivable (sale_id);
CREATE INDEX IF NOT EXISTS idx_ar_status ON accounts_receivable (status);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_caja ON sales (cash_register_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders (status);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_lot ON inventory_movements (lot_id);
CREATE INDEX IF NOT EXISTS idx_processing_batches_lot ON processing_batches (lot_id);
CREATE INDEX IF NOT EXISTS idx_dtrl_lot ON drying_tunnel_report_lots (lot_id);
CREATE INDEX IF NOT EXISTS idx_prestamo_cuotas_movimiento ON prestamo_cuotas (cash_movement_id);
CREATE INDEX IF NOT EXISTS idx_campo_movimientos_activo ON campo_movimientos (activo_id);
CREATE INDEX IF NOT EXISTS idx_campo_servicios_activo ON campo_servicios (activo_id);
CREATE INDEX IF NOT EXISTS idx_campo_partes_estado ON campo_partes (estado);
CREATE INDEX IF NOT EXISTS idx_worker_payments_status ON worker_payments (status);
CREATE INDEX IF NOT EXISTS idx_worker_payments_caja ON worker_payments (cash_register_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_fecha ON cash_movements (created_at);
