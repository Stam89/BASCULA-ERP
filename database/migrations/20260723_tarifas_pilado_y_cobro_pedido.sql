-- TARIFA DEL SERVICIO DE PILADO
--
-- CEYRO es la piladora: cuando pila el arroz de otro accionista (o de un
-- cliente externo), le cobra por quintal. El cobro sale SOLO del reporte de
-- pilado, y la presentación en que se entrega encarece el trabajo:
--   · base            $3.75 por QQ
--   · en arroba (@)   +$0.80 por QQ   (ensacar en 25 lb da más trabajo)
--   · en 10 lb        +$2.00 por QQ   (muchos más sacos por quintal)
--
-- Van en labor_rates junto al resto de precios, para que se ajusten desde
-- Configuración sin tocar el código.
ALTER TABLE labor_rates
  ADD COLUMN IF NOT EXISTS pilado_precio_qq NUMERIC(12,4) NOT NULL DEFAULT 3.75,
  ADD COLUMN IF NOT EXISTS pilado_recargo_arroba NUMERIC(12,4) NOT NULL DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS pilado_recargo_10lb NUMERIC(12,4) NOT NULL DEFAULT 2.00;

COMMENT ON COLUMN labor_rates.pilado_precio_qq IS 'Precio base del servicio de pilado por quintal.';
COMMENT ON COLUMN labor_rates.pilado_recargo_arroba IS 'Recargo por QQ cuando se entrega en arrobas (25 lb).';
COMMENT ON COLUMN labor_rates.pilado_recargo_10lb IS 'Recargo por QQ cuando se entrega en sacos de 10 lb.';

-- El detalle del cobro (qué presentación, cuántos QQ, qué recargo) queda
-- guardado para poder explicarle al cliente de dónde sale el valor.
ALTER TABLE pilado_services
  ADD COLUMN IF NOT EXISTS detalle JSONB;

-- El pedido de venta genera su cuenta por cobrar apenas se toma, sin esperar
-- al despacho: es un compromiso en firme del cliente.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS receivable_id UUID REFERENCES accounts_receivable(id) ON DELETE SET NULL;
