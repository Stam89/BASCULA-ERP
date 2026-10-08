-- Flete de VENTA con carro de Transporte y Cosechadora (pedido del dueño, 2026-10-08).
-- Cuando un carro de Transporte lleva un pedido, ese flete es un ingreso de Transporte y se le
-- cobra al accionista que vende el arroz: campo_servicios (origen 'venta_flete', origen_id = pedido)
-- = CxC de Transporte contra el accionista, y su Por Pagar espejo (reference_type 'campo_servicio').
-- Mismo modelo que el flete propio de liquidaciones y el flete de envejecido.
-- Aditiva e idempotente: solo agrega columnas al pedido para saber qué carro y cuánto.

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS flete_activo_id UUID REFERENCES campo_activos(id) ON DELETE SET NULL;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS flete_monto NUMERIC(14,2);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS flete_servicio_id UUID;
