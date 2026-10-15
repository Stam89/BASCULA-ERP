-- GASTO DE UN SOCIO PAGADO CON LA CAJA DE LA MATRIZ (Caja › «¿De quién es este gasto?», pedido del dueño 2026-10-15).
-- La plata sale de la caja de CEYRO (egreso GASTO_POR_SOCIO, no es costo suyo); el gasto es del socio:
--   · por_cuenta_de        = el socio dueño del gasto (sale en SUS informes de gastos),
--   · categoria_por_cuenta = la categoría real del gasto (combustible, alimentación…).
-- Se descuenta de lo que la Matriz le debía al socio (cruces_entre_socios) y el resto es deuda 'pago_por_socio'.
-- Aditiva e idempotente.
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS por_cuenta_de UUID REFERENCES accionistas(id);
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS categoria_por_cuenta TEXT;
CREATE INDEX IF NOT EXISTS idx_cash_movements_por_cuenta_de ON cash_movements (por_cuenta_de) WHERE por_cuenta_de IS NOT NULL;

INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a, activo)
SELECT 'GASTO_POR_SOCIO', 'Gasto de un socio pagado por esta caja', 'EGRESO', 'AMBOS', false
 WHERE NOT EXISTS (SELECT 1 FROM cash_categories WHERE codigo = 'GASTO_POR_SOCIO');
