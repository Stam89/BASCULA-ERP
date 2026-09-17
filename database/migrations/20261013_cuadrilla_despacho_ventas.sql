-- Pago automático de cuadrilla al confirmar despachos de Ventas.
-- Idempotente: un pedido/guía despachado genera una sola estibada automática.
-- Si el despacho se anula antes de pagar la cuadrilla, el backend elimina esta
-- fila por referencia para no pagar trabajo no realizado.

ALTER TABLE cuadrilla_entries
  ALTER COLUMN origen TYPE VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuadrilla_auto_venta
  ON cuadrilla_entries (referencia_id, momento)
  WHERE origen = 'VENTA';

-- DOWN:
--   DROP INDEX IF EXISTS uq_cuadrilla_auto_venta;
--   DELETE FROM schema_migrations WHERE filename = '20261013_cuadrilla_despacho_ventas.sql';
