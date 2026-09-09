-- Tarifario del punto de venta al detalle: precio por LIBRA configurable por
-- producto (Inventario/Productos). Aditivo e idempotente; por defecto 0 para no
-- alterar el comportamiento existente (si es 0, el cotizador cae al último precio
-- usado). No afecta a Ventas mayoristas (precios libres por saco/quintal).
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_per_pound NUMERIC(12,4) NOT NULL DEFAULT 0;
