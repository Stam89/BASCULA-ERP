-- ÍNDICES EN LLAVES FORÁNEAS Y COLUMNAS CALIENTES
--
-- Las FKs no traen índice automático en Postgres. Estas columnas se usan en
-- JOINs y filtros de las pantallas principales (liquidaciones, ventas, caja,
-- auditoría) y hoy provocan full-scans que crecen con los datos.
-- Todo es IF NOT EXISTS: seguro de re-aplicar y de correr en bases que ya
-- tengan alguno de estos índices creado a mano.

-- Liquidaciones y sus detalles
--
-- mobile_advance_applications consta como aplicada (20260604) pero la tabla
-- NO existe en la base: alguien la borró a mano y el código de liquidación de
-- tickets de báscula la sigue usando (mobile-tickets.ts). Se recrea con la
-- misma definición original; IF NOT EXISTS lo hace inofensivo donde sí exista.
CREATE TABLE IF NOT EXISTS mobile_advance_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advance_id UUID NOT NULL REFERENCES farmer_advances(id),
  ticket_id UUID NOT NULL REFERENCES mobile_synced_tickets(id),
  amount_applied NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mobile_advance_application_positive CHECK (amount_applied > 0)
);

CREATE INDEX IF NOT EXISTS idx_liquidations_farmer ON liquidations(farmer_id);
CREATE INDEX IF NOT EXISTS idx_liquidations_lot ON liquidations(lot_id);
CREATE INDEX IF NOT EXISTS idx_liquidation_details_liquidation ON liquidation_details(liquidation_id);
CREATE INDEX IF NOT EXISTS idx_advance_applications_advance ON advance_applications(advance_id);
CREATE INDEX IF NOT EXISTS idx_advance_applications_liquidation ON advance_applications(liquidation_id);
CREATE INDEX IF NOT EXISTS idx_mobile_advance_applications_advance ON mobile_advance_applications(advance_id);
CREATE INDEX IF NOT EXISTS idx_mobile_advance_applications_ticket ON mobile_advance_applications(ticket_id);

-- Ventas
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

-- Cuentas por pagar/cobrar y sus pagos
CREATE INDEX IF NOT EXISTS idx_accounts_payable_farmer ON accounts_payable(farmer_id);
CREATE INDEX IF NOT EXISTS idx_accounts_receivable_customer ON accounts_receivable(customer_id);
CREATE INDEX IF NOT EXISTS idx_accounts_receivable_farmer ON accounts_receivable(farmer_id);
CREATE INDEX IF NOT EXISTS idx_payments_made_payable ON payments_made(payable_id);
CREATE INDEX IF NOT EXISTS idx_payments_received_receivable ON payments_received(receivable_id);

-- Caja y gastos
CREATE INDEX IF NOT EXISTS idx_cash_movements_reference ON cash_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_expenses_register ON expenses(cash_register_id);

-- Tickets y agricultores
CREATE INDEX IF NOT EXISTS idx_weighing_tickets_farmer ON weighing_tickets(farmer_id);
-- La importación de báscula busca agricultores por nombre normalizado en cada
-- ticket (cada 3 min): sin índice de expresión es un full-scan por ticket.
CREATE INDEX IF NOT EXISTS idx_farmers_lower_trim_name ON farmers (lower(trim(full_name)));

-- Inventario y producción: reportes por fecha y detalles por lote
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_processing_outputs_batch ON processing_outputs(processing_batch_id);
CREATE INDEX IF NOT EXISTS idx_processing_losses_batch ON processing_losses(processing_batch_id);
CREATE INDEX IF NOT EXISTS idx_production_yields_lot ON production_yields(lot_id);
CREATE INDEX IF NOT EXISTS idx_insumo_movements_insumo ON insumo_movements(insumo_id);

-- Auditoría
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

-- COLUMNAS DE AUDITORÍA (antes se creaban con ALTER en runtime desde el
-- middleware audit.ts; el DDL pertenece a las migraciones).
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username VARCHAR(140);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS method VARCHAR(10);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS path TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status_code INT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS summary TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs (created_at DESC);

-- Estado de la sincronización incremental con Firebase: última marca de
-- "actualizadoEn" (epoch ms) importada por colección. Ver
-- backend/src/integrations/bascula-firebase.ts.
CREATE TABLE IF NOT EXISTS firebase_sync_state (
  collection TEXT PRIMARY KEY,
  last_updated_ms BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
