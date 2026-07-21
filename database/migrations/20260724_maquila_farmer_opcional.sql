-- El servicio de pilado (maquila) se le puede prestar a un ACCIONISTA, que no
-- es un agricultor. En ese caso maquila_orders.farmer_id no aplica, pero la
-- columna era obligatoria y hacía fallar TODO el cierre de producción cuando
-- CEYRO pilaba el arroz de otro socio.
--
-- Se vuelve opcional: el cliente puede ser un agricultor (maquila externa) o
-- un accionista (servicio entre socios), y el detalle del cobro ya queda en
-- pilado_services.
ALTER TABLE maquila_orders
  ALTER COLUMN farmer_id DROP NOT NULL;
