-- Categoría de caja "Compra de sacos" (EGRESO, propia de la MATRIZ). Al registrar
-- un egreso con esta categoría, la Caja captura el detalle de sacos y genera
-- automáticamente la ENTRADA en el Inventario de Sacos (kardex de la matriz). El
-- código COMPRA_SACOS ya lo usaba /sacks/purchases; ahora también existe como
-- categoría seleccionable en el movimiento de caja. Aditiva e idempotente.
INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a, activo)
VALUES ('COMPRA_SACOS', 'Compra de sacos', 'EGRESO', 'MATRIZ', true)
ON CONFLICT (codigo) DO NOTHING;
