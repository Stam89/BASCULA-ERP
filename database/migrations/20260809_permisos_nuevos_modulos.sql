-- Permisos por accionista: nuevas secciones del Sidebar como modulos propios.
--
-- Antes Por Cobrar / Por Pagar / Cuadrilla / Servicio Pilado / Seleccion / Nomina
-- se "colgaban" de Caja / Ventas / Produccion para decidir si se veian. Ahora
-- cada seccion es un PERMISO PROPIO (allowed.has(tab) en el web-admin). Para no
-- quitarle accesos a nadie, a cada vinculo (operador, accionista) se le agregan
-- los modulos nuevos equivalentes a lo que YA veia.
--
-- NO se auto-concede "Dashboard" (Panel Integral = vista del NEGOCIO COMPLETO,
-- todos los accionistas) ni "Reportes": son vistas nuevas que el admin concede
-- a proposito, no accesos que ya tuvieran.
UPDATE user_accionistas SET allowed_modules = (
  SELECT ARRAY(SELECT DISTINCT unnest(
    allowed_modules
    || CASE WHEN allowed_modules && ARRAY['Caja','Ventas']                 THEN ARRAY['Por Cobrar','Por Pagar']      ELSE ARRAY[]::text[] END
    || CASE WHEN allowed_modules && ARRAY['Caja','Produccion']             THEN ARRAY['Cuadrilla','Servicio Pilado','Nomina'] ELSE ARRAY[]::text[] END
    || CASE WHEN allowed_modules && ARRAY['Inventario','Produccion','Caja'] THEN ARRAY['Seleccion']                  ELSE ARRAY[]::text[] END
  ))
)
WHERE allowed_modules && ARRAY['Caja','Ventas','Produccion','Inventario'];
