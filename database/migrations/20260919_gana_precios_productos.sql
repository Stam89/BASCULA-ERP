-- Precio de venta MANUAL por cada producto de salida en la liquidación "Gana"
-- (antes solo arroz blanco). Ingreso Total Proyectado = Σ(QQ_producto × precio).
-- Editable por lote finalizado. Aditiva.
ALTER TABLE production_yields
  ADD COLUMN IF NOT EXISTS precio_venta_broken NUMERIC(12,4),  -- Arrocillo 3/4
  ADD COLUMN IF NOT EXISTS precio_venta_fine   NUMERIC(12,4),  -- Arrocillo Fino
  ADD COLUMN IF NOT EXISTS precio_venta_bran   NUMERIC(12,4);  -- Polvillo
