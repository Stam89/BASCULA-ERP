-- Nivel de acceso "Solo Ver" vs "Editar" por módulo y accionista.
-- Convención: el nombre plano del módulo (p.ej. 'Fomentos') significa VER; la
-- clave 'EDIT:<módulo>' significa EDITAR (escribir). Hasta ahora tener el módulo
-- daba edición; para NO romper a los operadores existentes, se les agrega
-- EDIT:<módulo> por cada módulo plano que ya tuvieran. Idempotente.
UPDATE user_accionistas ua
   SET allowed_modules = (
     SELECT array_agg(DISTINCT m ORDER BY m) FROM (
       SELECT unnest(ua.allowed_modules) AS m
       UNION
       SELECT 'EDIT:' || x
         FROM unnest(ua.allowed_modules) AS x
        WHERE x NOT LIKE 'EDIT:%' AND x NOT LIKE 'PERM:%'
     ) s
   )
 WHERE COALESCE(array_length(ua.allowed_modules, 1), 0) > 0;
