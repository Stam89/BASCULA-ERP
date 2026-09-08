-- Estado intermedio de PREPARACIÓN (picking) en la cola de despachos.
-- Flujo: Pendiente por cargar -> Preparado / Listo -> Despachado.
--
-- NO se toca el CHECK de sales_orders.status (PENDING/DELIVERED/CANCELLED) para
-- no romper las consultas y filtros existentes que dependen de esos 3 valores.
-- "Preparado" se modela como un hito DERIVADO: el pedido sigue en PENDING hasta
-- despacharse; queda "Listo para cargar" cuando prepared_at IS NOT NULL.
--
-- picking_location = de qué bodega/lote/fila de Arroz Blanco se extrae el
-- producto (lo confirma o ajusta el bodeguero al preparar). Aditiva e idempotente.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS prepared_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prepared_by      UUID,
  ADD COLUMN IF NOT EXISTS picking_location TEXT;
