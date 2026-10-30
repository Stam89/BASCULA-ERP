-- 🌾 Compra a un AGRICULTOR (pedido del dueño 2026-10-30): p. ej. producto terminado que vende un agricultor.
-- La compra guarda el agricultor; a crédito, la Por Pagar queda a su nombre (farmer_id) y se le descuenta al pagarle.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS farmer_id UUID REFERENCES farmers(id);
