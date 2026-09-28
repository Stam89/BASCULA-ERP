-- RUBROS ENLAZADOS A CAJA (aditiva e idempotente).
-- Cada rubro del Resultado mensual se enlaza a su(s) CATEGORÍA(S) de Caja y, si
-- aplica, a los TIPOS DE PAGO DE NÓMINA (la nómina usa una sola categoría,
-- PAGO_MANO_OBRA, y se reparte por tipo). Las "claves" quedan como respaldo
-- interno para egresos antiguos sin categoría propia.
ALTER TABLE costo_rubros ADD COLUMN IF NOT EXISTS categorias TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE costo_rubros ADD COLUMN IF NOT EXISTS nomina TEXT[] NOT NULL DEFAULT '{}';

UPDATE costo_rubros r SET categorias = v.cats
FROM (VALUES
  ('Gas', ARRAY['GAS']),
  ('Diesel', ARRAY['DIESEL']),
  ('Cuadrilla (bajada de camión)', ARRAY['CUADRILLA_BAJADA']),
  ('Mantenimiento piladora / selector', ARRAY['MANTENIMIENTO_EQUIPO']),
  ('Obra civil / Gasto operativo', ARRAY['GASTO_OPERATIVO']),
  ('Repuestos', ARRAY['REPUESTOS']),
  ('Guardianía / Secada', ARRAY['GUARDIANIA']),
  ('Cocinera', ARRAY['COCINERA']),
  ('Gastos administrativos', ARRAY['GASTOS_ADMINISTRATIVOS']),
  ('Alimentación', ARRAY['ALIMENTACION']),
  ('Saquillo pilado / arrocillo / polvillo', ARRAY['COMPRA_SACOS']),
  ('Vehículo gerencia', ARRAY['VEHICULO_GERENCIA']),
  ('Servicios básicos', ARRAY['SERVICIOS_BASICOS']),
  ('Gasolina / Montacarga', ARRAY['GASOLINA_MONTACARGA']),
  ('Cuadrilla Guayaquil', ARRAY['CUADRILLA_GUAYAQUIL'])
) AS v(nombre, cats)
WHERE r.nombre = v.nombre AND r.categorias = '{}';

-- Pagos de nómina: sueldo administrativo, cuadrilla y roles semanales.
-- El POLVILLO va con la Cuadrilla (indicación del usuario).
UPDATE costo_rubros r SET nomina = v.tipos
FROM (VALUES
  ('Sueldos', ARRAY['SUELDO_ADMIN']),
  ('Cuadrilla (bajada de camión)', ARRAY['CUADRILLA', 'POLVILLO']),
  ('Pilador / Estibador', ARRAY['PILADOR', 'ESTIBADOR']),
  ('Guardianía / Secada', ARRAY['SECADOR'])
) AS v(nombre, tipos)
WHERE r.nombre = v.nombre AND r.nomina = '{}';

-- "sueldos" (plural) atrapaba cualquier pago de la categoría "Nómina planta /
-- Sueldos"; ahora la nómina se reparte por tipo, así que se quita.
UPDATE costo_rubros SET claves = array_remove(claves, 'sueldos') WHERE nombre = 'Sueldos';

-- Ajuste de datos del usuario (2026-09-28): quitó el rubro "Cocinera" y creó
-- "Cocinera / Limpieza" desde el reporte esperando que Caja cambiara también.
-- Se enlaza la categoría COCINERA a ese rubro, se renombra en Caja igual y, si
-- quedó con estimado 0, hereda el 0.07 del rubro original. Solo si se da ese caso.
UPDATE costo_rubros n
   SET categorias = ARRAY['COCINERA'],
       costo_estimado_qq = CASE WHEN n.costo_estimado_qq = 0 THEN COALESCE(v.costo_estimado_qq, 0) ELSE n.costo_estimado_qq END
  FROM (SELECT costo_estimado_qq FROM costo_rubros WHERE nombre = 'Cocinera' AND NOT activo LIMIT 1) v
 WHERE n.nombre = 'Cocinera / Limpieza' AND n.activo AND n.categorias = '{}';
UPDATE costo_rubros SET categorias = '{}' WHERE nombre = 'Cocinera' AND NOT activo
   AND EXISTS (SELECT 1 FROM costo_rubros x WHERE x.nombre = 'Cocinera / Limpieza' AND x.activo AND 'COCINERA' = ANY (x.categorias));
UPDATE cash_categories SET nombre = 'Cocinera / Limpieza'
 WHERE codigo = 'COCINERA' AND nombre = 'Cocinera'
   AND EXISTS (SELECT 1 FROM costo_rubros x WHERE x.nombre = 'Cocinera / Limpieza' AND x.activo AND 'COCINERA' = ANY (x.categorias));
