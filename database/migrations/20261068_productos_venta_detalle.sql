-- Catálogo de productos (Configuración): marca de «se vende al detalle en el
-- mostrador». Hasta ahora Caja → Venta Detalle tenía su lista de 5 productos
-- escrita en el código; ahora se elige en el catálogo. Aditiva e idempotente: la
-- columna solo se crea una vez y, en ese momento, se marcan los 5 de siempre (así
-- nada cambia en el mostrador); volver a correr la migración no pisa lo que luego
-- se elija en el catálogo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'venta_detalle'
  ) THEN
    ALTER TABLE products ADD COLUMN venta_detalle BOOLEAN NOT NULL DEFAULT false;
    UPDATE products SET venta_detalle = true
     WHERE code IN ('ARROZ-PILADO-011', 'ARROZ-PILADO-CORRIENTE', 'ARROCILLO-34', 'ARROCILLO-FINO', 'POLVILLO');
  END IF;
END $$;
