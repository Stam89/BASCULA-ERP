-- CAJA TIPO HOJA DE CÁLCULO (pedido del dueño 2026-10-30).
--   · cash_movements.codigo: la columna «CÓDIGO» de su Excel de caja (por defecto 001). NULL = 001 (lo de antes).
--   · Rubro flexible «Gastos varios / Donación / Contribución económica» de ingreso y de egreso, para donaciones,
--     refrigerios, aportes menores… con descripción libre. Suma o resta la caja como cualquier movimiento manual.
-- Aditiva e idempotente.
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS codigo TEXT;

INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a, activo)
SELECT 'GASTOS_VARIOS', 'Gastos varios / Donación / Contribución económica', 'EGRESO', 'AMBOS', true
 WHERE NOT EXISTS (SELECT 1 FROM cash_categories WHERE codigo = 'GASTOS_VARIOS');

-- El egreso entra al Resultado mensual con su propio rubro (como al crear una categoría con «incluir en Resultado»).
INSERT INTO costo_rubros (nombre, costo_estimado_qq, categorias, orden)
SELECT 'Gastos varios / Donación', 0, ARRAY['GASTOS_VARIOS']::text[], COALESCE((SELECT MAX(orden) FROM costo_rubros), 0) + 1
    ON CONFLICT (upper(nombre)) DO UPDATE SET
       activo = true,
       categorias = CASE WHEN 'GASTOS_VARIOS' = ANY (costo_rubros.categorias) THEN costo_rubros.categorias
                         ELSE array_append(costo_rubros.categorias, 'GASTOS_VARIOS') END;

INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a, activo)
SELECT 'INGRESOS_VARIOS', 'Ingresos varios / Donación / Contribución económica', 'INGRESO', 'AMBOS', true
 WHERE NOT EXISTS (SELECT 1 FROM cash_categories WHERE codigo = 'INGRESOS_VARIOS');
