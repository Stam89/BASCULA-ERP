-- SACO DEL ARROZ ENVEJECIDO EN LA VENTA (pedido del dueño 2026-10-14): el envejecido se vende en el saco
-- propio del socio que vende (p. ej. CECIBEL: se descuenta de SUS sacos al Confirmar Preparación) o en el saco
-- que entrega el proveedor (no descuenta nada). sack_id NULL = saco del proveedor / sin saco propio.
-- Aditiva e idempotente.
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS sack_id uuid REFERENCES sack_inventory(id);
