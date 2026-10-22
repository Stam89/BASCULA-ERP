-- 🕒 VENTA DETALLE POR ASIGNAR (pedido del dueño 2026-10-21): en el mostrador se vende al detalle sin saber todavía de
-- quién es el arroz; al final del día (o al otro) se adjudica a la Matriz o a un socio según quién tenga arroz.
-- Mientras tanto la plata ya está en la caja (ingreso VENTA_DETALLE_POR_ASIGNAR) y el inventario NO se descuenta.
-- Al asignar: nace la venta del dueño (sale de SU inventario) y el ingreso pasa a VENTA (si es de la caja) o a
-- COBRO_POR_SOCIO con su deuda entre socios (la caja se lo debe al socio). Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS ventas_detalle_por_asignar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accionista_id UUID NOT NULL REFERENCES accionistas(id),
  cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
  cash_movement_id UUID REFERENCES cash_movements(id),
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  product_name TEXT NOT NULL,
  quantity_qq NUMERIC(14,4) NOT NULL CHECK (quantity_qq > 0),
  unit_price_qq NUMERIC(14,4) NOT NULL,
  total NUMERIC(14,2) NOT NULL CHECK (total > 0),
  libras NUMERIC(14,3),
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  asignado_a UUID REFERENCES accionistas(id),
  sale_id UUID REFERENCES sales(id),
  asignado_at TIMESTAMPTZ,
  asignado_by UUID,
  anulado_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ventas_detalle_por_asignar_pend_idx
  ON ventas_detalle_por_asignar (accionista_id, created_at) WHERE asignado_at IS NULL AND anulado_at IS NULL;
