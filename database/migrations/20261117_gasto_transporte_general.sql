-- 🚜 GASTO DE TRANSPORTE SIN MÁQUINA PAGADO POR LA MATRIZ (pedido del dueño 2026-10-22): diésel, viáticos… de
-- Transporte y Cosechadora que paga la caja de CEYRO. Como no hay hoja de vida (campo_mantenimientos), el cruce
-- automático con lo que la Matriz le debía a Transporte se guarda en la misma cuenta, para deshacerlo al anular.
-- Aditiva e idempotente.
ALTER TABLE campo_cxp ADD COLUMN IF NOT EXISTS compensacion_id UUID REFERENCES campo_compensaciones(id) ON DELETE SET NULL;
