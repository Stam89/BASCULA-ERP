-- «Vehículo gerencia» (VEHICULO_GERENCIA, del sistema) no tenía rubro en Resultado mensual: el dueño creó su propia
-- categoría «GASTO VEHICULOS DE GUERENCIA» (GASTOS_FIAT) con su rubro. Las dos son lo mismo: VEHICULO_GERENCIA se suma
-- al rubro que ya tiene GASTOS_FIAT. Idempotente; si ese rubro no existe, no hace nada.
UPDATE costo_rubros
   SET categorias = array_append(categorias, 'VEHICULO_GERENCIA')
 WHERE activo AND 'GASTOS_FIAT' = ANY (categorias)
   AND NOT ('VEHICULO_GERENCIA' = ANY (categorias))
   AND NOT EXISTS (SELECT 1 FROM costo_rubros r2 WHERE r2.activo AND 'VEHICULO_GERENCIA' = ANY (r2.categorias));
