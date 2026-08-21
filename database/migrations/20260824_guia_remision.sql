-- Guía de Remisión para pedidos despachados (solo visualización/impresión).
-- Aditivo: guarda los datos del transportista en el pedido. NO toca inventario
-- ni contabilidad.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS transportista_nombre VARCHAR(120),
  ADD COLUMN IF NOT EXISTS transportista_cedula VARCHAR(20),
  ADD COLUMN IF NOT EXISTS vehiculo_placa VARCHAR(15),
  ADD COLUMN IF NOT EXISTS guia_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS guia_emitida_at TIMESTAMPTZ;

-- Secuencia para el número de guía (formato 001-001-000000001).
CREATE SEQUENCE IF NOT EXISTS guia_remision_seq START 1;
