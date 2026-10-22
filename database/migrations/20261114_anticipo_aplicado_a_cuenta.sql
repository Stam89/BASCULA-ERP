-- 🌾 Anticipo aplicado contra una cuenta por pagar del agricultor que NO viene de una liquidación (p. ej. su saldo
-- inicial): antes no se registraba la aplicación (liquidation_id era obligatorio) y el anticipo quedaba con un saldo
-- que no cuadraba con lo aplicado. Ahora la aplicación guarda la cuenta (payable_id) y la liquidación es opcional.
-- Pedido del dueño 2026-10-21 (Venta Detalle «a su cuenta de agricultor»). Aditiva e idempotente.
ALTER TABLE advance_applications ADD COLUMN IF NOT EXISTS payable_id UUID REFERENCES accounts_payable(id);
ALTER TABLE advance_applications ALTER COLUMN liquidation_id DROP NOT NULL;
