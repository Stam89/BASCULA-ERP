-- CATEGORÍAS DE CAJA = RUBROS DEL RESULTADO MENSUAL (aditiva e idempotente).
-- Cada rubro de costo operativo tiene su categoría de EGRESO en Caja (Matriz),
-- SIN duplicar las que ya existían: esas solo se renombran (el CÓDIGO no cambia,
-- así los flujos automáticos siguen igual). Solo se renombra si el nombre sigue
-- siendo el original (respeta cambios hechos a mano).

UPDATE cash_categories SET nombre = 'Nómina planta / Sueldos'
 WHERE codigo = 'PAGO_MANO_OBRA' AND nombre = 'Nomina Planta';
-- Conserva "Gastos generales" en el nombre: la Caja muestra Subcategoría por ese texto.
UPDATE cash_categories SET nombre = 'Obra civil / Gastos generales'
 WHERE codigo = 'GASTO_OPERATIVO' AND nombre = 'Gastos Generales';
UPDATE cash_categories SET nombre = 'Mantenimiento piladora / selector'
 WHERE codigo = 'MANTENIMIENTO_EQUIPO' AND nombre = 'Mantenimiento';
UPDATE cash_categories SET nombre = 'Servicios básicos'
 WHERE codigo = 'SERVICIOS_BASICOS' AND nombre = 'SERVICIOS BASICOS';
UPDATE cash_categories SET nombre = 'Compra de sacos / saquillos'
 WHERE codigo = 'COMPRA_SACOS' AND nombre = 'Compra de sacos';

-- Nuevas (solo las que no existían por código ni por nombre).
INSERT INTO cash_categories (codigo, nombre, tipo, aplicable_a)
SELECT v.codigo, v.nombre, 'EGRESO', 'MATRIZ'
FROM (VALUES
  ('GAS',                    'Gas'),
  ('DIESEL',                 'Diésel'),
  ('CUADRILLA_BAJADA',       'Cuadrilla (bajada de camión)'),
  ('REPUESTOS',              'Repuestos'),
  ('GUARDIANIA',             'Guardianía'),
  ('COCINERA',               'Cocinera'),
  ('GASTOS_ADMINISTRATIVOS', 'Gastos administrativos'),
  ('ALIMENTACION',           'Alimentación'),
  ('VEHICULO_GERENCIA',      'Vehículo gerencia'),
  ('GASOLINA_MONTACARGA',    'Gasolina / Montacarga'),
  ('CUADRILLA_GUAYAQUIL',    'Cuadrilla Guayaquil')
) AS v(codigo, nombre)
WHERE NOT EXISTS (
  SELECT 1 FROM cash_categories c
   WHERE c.codigo = v.codigo
      OR translate(lower(c.nombre), 'áéíóú', 'aeiou') = translate(lower(v.nombre), 'áéíóú', 'aeiou')
);

-- El reporte reconoce la categoría por su nombre; se agregan además los códigos
-- (y "guardia", cargo usado en el sueldo administrativo) como claves de rubro.
UPDATE costo_rubros SET claves = claves || ARRAY['cuadrilla_bajada']
 WHERE nombre = 'Cuadrilla (bajada de camión)' AND NOT ('cuadrilla_bajada' = ANY (claves));
UPDATE costo_rubros SET claves = claves || ARRAY['guardia']
 WHERE nombre = 'Guardianía / Secada' AND NOT ('guardia' = ANY (claves));
UPDATE costo_rubros SET claves = claves || ARRAY['gastos_administrativos']
 WHERE nombre = 'Gastos administrativos' AND NOT ('gastos_administrativos' = ANY (claves));
UPDATE costo_rubros SET claves = claves || ARRAY['vehiculo_gerencia']
 WHERE nombre = 'Vehículo gerencia' AND NOT ('vehiculo_gerencia' = ANY (claves));
UPDATE costo_rubros SET claves = claves || ARRAY['gasolina_montacarga']
 WHERE nombre = 'Gasolina / Montacarga' AND NOT ('gasolina_montacarga' = ANY (claves));
UPDATE costo_rubros SET claves = claves || ARRAY['cuadrilla_guayaquil']
 WHERE nombre = 'Cuadrilla Guayaquil' AND NOT ('cuadrilla_guayaquil' = ANY (claves));
