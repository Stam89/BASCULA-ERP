-- 💸 Por qué no se descontaron los anticipos en esa liquidación (arroz de un pariente, pedido del dueño 2026-11-25).
ALTER TABLE liquidations ADD COLUMN IF NOT EXISTS nota_anticipo TEXT;
