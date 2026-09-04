-- Precio de venta MANUAL del arroz blanco para la liquidación financiera "Gana"
-- (ingreso proyectado = QQ arroz blanco × precio). Se guarda por lote finalizado
-- (una fila de production_yields por batch). Editable en cualquier momento.
ALTER TABLE production_yields
  ADD COLUMN IF NOT EXISTS precio_venta_blanco NUMERIC(12,4);
