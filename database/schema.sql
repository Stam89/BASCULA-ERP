CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE lot_status AS ENUM ('OPEN', 'WEIGHED', 'IN_PROCESS', 'PROCESSED', 'LIQUIDATED', 'CLOSED', 'CANCELLED');
CREATE TYPE ownership_type AS ENUM ('OWNED', 'MAQUILA', 'SERVICE_ONLY');
CREATE TYPE inventory_movement_type AS ENUM ('IN', 'OUT', 'ADJUSTMENT', 'TRANSFER', 'PROCESS_INPUT', 'PROCESS_OUTPUT', 'PACKAGING_CONSUMPTION', 'REVERSAL');
CREATE TYPE cash_movement_type AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE document_status AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIAL', 'PAID', 'CANCELLED');
CREATE TYPE payment_method AS ENUM ('CASH', 'TRANSFER', 'CARD', 'CHECK', 'CREDIT');

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(120) NOT NULL,
  address TEXT,
  phone VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(120) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID REFERENCES branches(id),
  role_id UUID REFERENCES roles(id),
  name VARCHAR(140) NOT NULL,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(160) UNIQUE,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE farmers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identification VARCHAR(40) UNIQUE,
  full_name VARCHAR(180) NOT NULL,
  phone VARCHAR(40),
  address TEXT,
  bank_account VARCHAR(120),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identification VARCHAR(40) UNIQUE,
  full_name VARCHAR(180) NOT NULL,
  phone VARCHAR(40),
  address TEXT,
  customer_type VARCHAR(40) NOT NULL DEFAULT 'RETAIL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plate VARCHAR(30) NOT NULL UNIQUE,
  owner_name VARCHAR(160),
  driver_name VARCHAR(160),
  phone VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(140) NOT NULL,
  product_type VARCHAR(40) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'QQ',
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID REFERENCES branches(id),
  name VARCHAR(120) NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'GENERAL',
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE lots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lot_code VARCHAR(60) NOT NULL UNIQUE,
  print_batch_code VARCHAR(80) NOT NULL UNIQUE,
  farmer_id UUID REFERENCES farmers(id),
  rice_type VARCHAR(30) NOT NULL DEFAULT '0.11',
  ownership ownership_type NOT NULL DEFAULT 'OWNED',
  is_maquila BOOLEAN NOT NULL DEFAULT false,
  status lot_status NOT NULL DEFAULT 'OPEN',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE lot_process_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  stage VARCHAR(40) NOT NULL,
  sequence INTEGER NOT NULL,
  reference_type VARCHAR(60),
  reference_id UUID,
  report_title VARCHAR(160) NOT NULL,
  report_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lot_process_stage_valid CHECK (
    stage IN ('BASCULA', 'SECADO', 'TUNEL_1', 'TUNEL_2', 'TUNEL_3', 'PILADO', 'RENDIMIENTO', 'VENTA')
  ),
  CONSTRAINT lot_process_sequence_positive CHECK (sequence > 0)
);

CREATE TABLE lot_process_report_links (
  from_report_id UUID NOT NULL REFERENCES lot_process_reports(id) ON DELETE CASCADE,
  to_report_id UUID NOT NULL REFERENCES lot_process_reports(id) ON DELETE CASCADE,
  link_type VARCHAR(40) NOT NULL DEFAULT 'NEXT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_report_id, to_report_id),
  CONSTRAINT lot_process_link_not_self CHECK (from_report_id <> to_report_id)
);

CREATE TABLE drying_tunnel_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  process_report_id UUID NOT NULL UNIQUE REFERENCES lot_process_reports(id) ON DELETE CASCADE,
  tunnel_number INTEGER NOT NULL CHECK (tunnel_number BETWEEN 1 AND 3),
  rice_type VARCHAR(30) NOT NULL DEFAULT '0.11',
  input_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  total_quintals NUMERIC(14,3) NOT NULL DEFAULT 0,
  output_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  moisture_before NUMERIC(8,3),
  moisture_after NUMERIC(8,3),
  drying_hours NUMERIC(8,2),
  dry_start_at TIMESTAMPTZ,
  dry_end_at TIMESTAMPTZ,
  gas_used NUMERIC(14,3) NOT NULL DEFAULT 0,
  diesel_used NUMERIC(14,3) NOT NULL DEFAULT 0,
  dryer_name VARCHAR(160),
  status VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
  operator_name VARCHAR(160),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT drying_weights_non_negative CHECK (input_weight_kg >= 0 AND output_weight_kg >= 0),
  CONSTRAINT drying_consumption_non_negative CHECK (gas_used >= 0 AND diesel_used >= 0),
  CONSTRAINT drying_status_valid CHECK (status IN ('IN_PROGRESS', 'COMPLETED'))
);

CREATE TABLE drying_tunnel_report_lots (
  drying_report_id UUID NOT NULL REFERENCES drying_tunnel_reports(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  process_report_id UUID REFERENCES lot_process_reports(id) ON DELETE SET NULL,
  lot_code VARCHAR(60) NOT NULL,
  farmer_name VARCHAR(180),
  net_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  quintals NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (drying_report_id, lot_id),
  UNIQUE (lot_id)
);

CREATE TABLE weighing_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number VARCHAR(60) NOT NULL UNIQUE,
  lot_id UUID NOT NULL REFERENCES lots(id),
  farmer_id UUID REFERENCES farmers(id),
  vehicle_id UUID REFERENCES vehicles(id),
  operation_type VARCHAR(40) NOT NULL DEFAULT 'RECEPTION',
  is_maquila BOOLEAN NOT NULL DEFAULT false,
  gross_weight NUMERIC(14,3) NOT NULL DEFAULT 0,
  tare_weight NUMERIC(14,3) NOT NULL DEFAULT 0,
  net_weight NUMERIC(14,3) GENERATED ALWAYS AS (gross_weight - tare_weight) STORED,
  qualification NUMERIC(10,3),
  quintals NUMERIC(14,3),
  is_locked BOOLEAN NOT NULL DEFAULT false,
  print_count INTEGER NOT NULL DEFAULT 0,
  moisture NUMERIC(8,3),
  impurities NUMERIC(8,3),
  status document_status NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  weighed_in_at TIMESTAMPTZ,
  weighed_out_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT weighing_weights_non_negative CHECK (gross_weight >= 0 AND tare_weight >= 0),
  CONSTRAINT weighing_quintals_non_negative CHECK (quintals IS NULL OR quintals >= 0)
);

CREATE TABLE mobile_synced_tickets (
  id UUID PRIMARY KEY,
  device_id TEXT,
  farmer_id UUID REFERENCES farmers(id),
  farmer_name VARCHAR(180) NOT NULL DEFAULT '',
  gross_weight NUMERIC(14,3) NOT NULL DEFAULT 0,
  tare_weight NUMERIC(14,3) NOT NULL DEFAULT 0,
  net_weight NUMERIC(14,3) NOT NULL DEFAULT 0,
  qualification NUMERIC(10,3) NOT NULL DEFAULT 0,
  quintals NUMERIC(14,3) NOT NULL DEFAULT 0,
  print_count INTEGER NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  price_per_quintal NUMERIC(14,4) NOT NULL DEFAULT 0,
  gross_payable NUMERIC(14,2) NOT NULL DEFAULT 0,
  advances_discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(14,2) NOT NULL DEFAULT 0,
  liquidated_at TIMESTAMPTZ,
  mobile_created_at BIGINT NOT NULL,
  mobile_updated_at BIGINT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload JSONB NOT NULL
);

CREATE INDEX idx_mobile_synced_tickets_updated_at ON mobile_synced_tickets (mobile_updated_at);

CREATE TABLE mobile_advance_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advance_id UUID NOT NULL REFERENCES farmer_advances(id),
  ticket_id UUID NOT NULL REFERENCES mobile_synced_tickets(id),
  amount_applied NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mobile_advance_application_positive CHECK (amount_applied > 0)
);

CREATE TABLE insumos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(140) NOT NULL UNIQUE,
  stock_actual NUMERIC(14,3) NOT NULL DEFAULT 0,
  nivel_critico NUMERIC(14,3) NOT NULL DEFAULT 50,
  unidad VARCHAR(20) NOT NULL DEFAULT 'UNIDAD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT insumos_stock_non_negative CHECK (stock_actual >= 0),
  CONSTRAINT insumos_critical_non_negative CHECK (nivel_critico >= 0)
);

CREATE TABLE insumo_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  insumo_id UUID NOT NULL REFERENCES insumos(id),
  movement VARCHAR(30) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  reference_type VARCHAR(60),
  reference_id UUID,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT insumo_movement_not_zero CHECK (quantity <> 0)
);

CREATE TABLE production_yields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processing_batch_id UUID NOT NULL UNIQUE REFERENCES processing_batches(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES lots(id),
  ownership ownership_type NOT NULL,
  input_paddy_kg NUMERIC(14,3) NOT NULL,
  white_rice_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  white_rice_unit VARCHAR(20) NOT NULL DEFAULT 'QQ',
  white_rice_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  broken_rice_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  broken_rice_unit VARCHAR(20) NOT NULL DEFAULT 'KG',
  broken_rice_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  fine_broken_rice_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  fine_broken_rice_unit VARCHAR(20) NOT NULL DEFAULT 'SACK',
  fine_broken_rice_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  bran_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  bran_unit VARCHAR(20) NOT NULL DEFAULT 'KG',
  bran_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  total_output_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  process_loss_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  yield_percent NUMERIC(8,3) NOT NULL DEFAULT 0,
  packaging_supply_id UUID REFERENCES insumos(id),
  sacks_used NUMERIC(14,3) NOT NULL DEFAULT 0,
  sack_presentation_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  service_rate_per_qq NUMERIC(14,4) NOT NULL DEFAULT 0,
  service_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT production_yield_input_positive CHECK (input_paddy_kg > 0),
  CONSTRAINT production_yield_loss_non_negative CHECK (process_loss_kg >= 0)
);

CREATE TABLE third_party_custody (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processing_batch_id UUID NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES lots(id),
  farmer_id UUID REFERENCES farmers(id),
  product_id UUID NOT NULL REFERENCES products(id),
  product_label VARCHAR(80) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  presentation VARCHAR(80),
  sack_weight_lb NUMERIC(10,3),
  kg_equivalent NUMERIC(14,3) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'IN_CUSTODY',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  CONSTRAINT third_party_custody_quantity_positive CHECK (quantity > 0)
);

CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  lot_id UUID REFERENCES lots(id),
  movement inventory_movement_type NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'QQ',
  reference_type VARCHAR(60),
  reference_id UUID,
  ownership ownership_type NOT NULL DEFAULT 'OWNED',
  cost_unit NUMERIC(14,4) NOT NULL DEFAULT 0,
  total_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_quantity_not_zero CHECK (quantity <> 0)
);

CREATE TABLE farmer_advances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farmer_id UUID NOT NULL REFERENCES farmers(id),
  advance_number VARCHAR(60) NOT NULL UNIQUE,
  amount NUMERIC(14,2) NOT NULL,
  balance NUMERIC(14,2) NOT NULL,
  concept TEXT NOT NULL,
  status document_status NOT NULL DEFAULT 'CONFIRMED',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  CONSTRAINT advance_amount_positive CHECK (amount > 0),
  CONSTRAINT advance_balance_valid CHECK (balance >= 0 AND balance <= amount)
);

CREATE TABLE processing_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_number VARCHAR(60) NOT NULL UNIQUE,
  lot_id UUID NOT NULL REFERENCES lots(id),
  drying_report_id UUID UNIQUE REFERENCES drying_tunnel_reports(id),
  process_type VARCHAR(40) NOT NULL,
  ownership ownership_type NOT NULL,
  input_product_id UUID NOT NULL REFERENCES products(id),
  input_quantity NUMERIC(14,3) NOT NULL,
  status document_status NOT NULL DEFAULT 'DRAFT',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT processing_input_positive CHECK (input_quantity > 0)
);

CREATE TABLE processing_batch_drying_lots (
  processing_batch_id UUID NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
  drying_report_id UUID NOT NULL REFERENCES drying_tunnel_reports(id) ON DELETE RESTRICT,
  lot_id UUID NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  lot_code VARCHAR(60) NOT NULL,
  farmer_name VARCHAR(180),
  net_weight_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
  quintals NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (processing_batch_id, lot_id)
);

CREATE TABLE processing_outputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processing_batch_id UUID NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  quantity NUMERIC(14,3) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'QQ',
  presentation VARCHAR(80),
  sack_weight_lb NUMERIC(10,3),
  is_byproduct BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT processing_output_positive CHECK (quantity > 0)
);

CREATE TABLE processing_losses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processing_batch_id UUID NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
  loss_type VARCHAR(80) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  notes TEXT,
  CONSTRAINT processing_loss_positive CHECK (quantity >= 0)
);

CREATE TABLE maquila_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lot_id UUID NOT NULL REFERENCES lots(id),
  farmer_id UUID NOT NULL REFERENCES farmers(id),
  service_type VARCHAR(60) NOT NULL,
  input_quantity NUMERIC(14,3) NOT NULL,
  price_per_quintal NUMERIC(14,4) NOT NULL,
  total_service_amount NUMERIC(14,2) NOT NULL,
  status document_status NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT maquila_amounts_positive CHECK (input_quantity > 0 AND price_per_quintal >= 0)
);

CREATE TABLE liquidations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  liquidation_number VARCHAR(60) NOT NULL UNIQUE,
  farmer_id UUID NOT NULL REFERENCES farmers(id),
  lot_id UUID NOT NULL REFERENCES lots(id),
  quintals NUMERIC(14,3) NOT NULL,
  price_per_quintal NUMERIC(14,4) NOT NULL,
  gross_amount NUMERIC(14,2) NOT NULL,
  advances_discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_discounts NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(14,2) NOT NULL,
  status document_status NOT NULL DEFAULT 'CONFIRMED',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT liquidation_values_positive CHECK (quintals > 0 AND price_per_quintal >= 0 AND net_amount >= 0)
);

CREATE TABLE liquidation_details (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  liquidation_id UUID NOT NULL REFERENCES liquidations(id) ON DELETE CASCADE,
  concept VARCHAR(160) NOT NULL,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,4) NOT NULL DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE advance_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  advance_id UUID NOT NULL REFERENCES farmer_advances(id),
  liquidation_id UUID NOT NULL REFERENCES liquidations(id),
  amount_applied NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT advance_application_positive CHECK (amount_applied > 0)
);

CREATE TABLE accounts_payable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farmer_id UUID NOT NULL REFERENCES farmers(id),
  liquidation_id UUID REFERENCES liquidations(id),
  amount NUMERIC(14,2) NOT NULL,
  balance NUMERIC(14,2) NOT NULL,
  status document_status NOT NULL DEFAULT 'CONFIRMED',
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cash_registers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id UUID REFERENCES branches(id),
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  opened_by UUID REFERENCES users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(14,2)
);

CREATE TABLE cash_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
  movement cash_movement_type NOT NULL,
  category VARCHAR(80) NOT NULL,
  reference_type VARCHAR(60),
  reference_id UUID,
  amount NUMERIC(14,2) NOT NULL,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_amount_positive CHECK (amount > 0)
);

CREATE TABLE payments_made (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payable_id UUID NOT NULL REFERENCES accounts_payable(id),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
  method payment_method NOT NULL DEFAULT 'CASH',
  amount NUMERIC(14,2) NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  CONSTRAINT payment_made_positive CHECK (amount > 0)
);

CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_number VARCHAR(60) NOT NULL UNIQUE,
  customer_id UUID REFERENCES customers(id),
  cash_register_id UUID REFERENCES cash_registers(id),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_status document_status NOT NULL DEFAULT 'DRAFT',
  sale_status document_status NOT NULL DEFAULT 'DRAFT',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  lot_id UUID REFERENCES lots(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  quantity NUMERIC(14,3) NOT NULL,
  unit_price NUMERIC(14,4) NOT NULL,
  total NUMERIC(14,2) NOT NULL,
  CONSTRAINT sale_item_positive CHECK (quantity > 0 AND unit_price >= 0)
);

CREATE TABLE accounts_receivable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id),
  farmer_id UUID REFERENCES farmers(id),
  sale_id UUID REFERENCES sales(id),
  reference_type VARCHAR(60),
  reference_id UUID,
  description TEXT,
  amount NUMERIC(14,2) NOT NULL,
  balance NUMERIC(14,2) NOT NULL,
  status document_status NOT NULL DEFAULT 'CONFIRMED',
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments_received (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receivable_id UUID REFERENCES accounts_receivable(id),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
  method payment_method NOT NULL DEFAULT 'CASH',
  amount NUMERIC(14,2) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id),
  CONSTRAINT payment_received_positive CHECK (amount > 0)
);

CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID REFERENCES expense_categories(id),
  cash_register_id UUID REFERENCES cash_registers(id),
  amount NUMERIC(14,2) NOT NULL,
  description TEXT NOT NULL,
  reference_type VARCHAR(60),
  reference_id UUID,
  paid_to VARCHAR(160),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expense_amount_positive CHECK (amount > 0)
);

CREATE TABLE labor_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cash_register_id UUID REFERENCES cash_registers(id),
  worker_group VARCHAR(120) NOT NULL,
  sacks_moved NUMERIC(14,3) NOT NULL,
  price_per_sack NUMERIC(14,4) NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL,
  related_operation VARCHAR(60),
  related_id UUID,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE print_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_type VARCHAR(60) NOT NULL,
  reference_id UUID NOT NULL,
  printer_type VARCHAR(60) NOT NULL DEFAULT 'BLUETOOTH_58MM',
  device_name VARCHAR(120),
  printed_by UUID REFERENCES users(id),
  printed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(30) NOT NULL DEFAULT 'PRINTED'
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(80) NOT NULL,
  table_name VARCHAR(80) NOT NULL,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lots_farmer_status ON lots(farmer_id, status);
CREATE INDEX idx_lot_process_reports_lot_sequence ON lot_process_reports(lot_id, sequence);
CREATE INDEX idx_lot_process_reports_stage ON lot_process_reports(lot_id, stage);
CREATE INDEX idx_drying_tunnel_reports_lot ON drying_tunnel_reports(lot_id, tunnel_number, created_at);
CREATE INDEX idx_drying_tunnel_report_lots_report ON drying_tunnel_report_lots(drying_report_id);
CREATE INDEX idx_weighing_lot ON weighing_tickets(lot_id);
CREATE INDEX idx_inventory_stock ON inventory_movements(product_id, warehouse_id, ownership);
CREATE INDEX idx_advances_farmer_status ON farmer_advances(farmer_id, status);
CREATE INDEX idx_cash_movements_register ON cash_movements(cash_register_id, created_at);
CREATE INDEX idx_sales_created ON sales(created_at);

CREATE VIEW inventory_stock AS
SELECT
  product_id,
  warehouse_id,
  lot_id,
  ownership,
  SUM(quantity) AS quantity
FROM inventory_movements
GROUP BY product_id, warehouse_id, lot_id, ownership;

CREATE VIEW farmer_pending_advances AS
SELECT
  farmer_id,
  SUM(balance) AS pending_balance
FROM farmer_advances
WHERE status IN ('CONFIRMED', 'PARTIAL')
GROUP BY farmer_id;

-- Configuración general del negocio (fila única)
CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name VARCHAR(160) NOT NULL DEFAULT 'BASCULA ERP',
  business_subtitle VARCHAR(160) NOT NULL DEFAULT 'Piladora de Arroz',
  ruc VARCHAR(20) NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  receipt_footer TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
