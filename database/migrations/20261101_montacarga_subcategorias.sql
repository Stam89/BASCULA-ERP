-- MONTACARGA COMO RUBRO APARTE (pedido del dueño 2026-10-14): la categoría de Caja «Montacarga»
-- (GASOLINA_MONTACARGA) tiene subcategorías para registrar ahí todo lo del montacarga. El mantenimiento,
-- repuestos o combustible que nombran al montacarga también se cargan a su rubro en Costos operativos
-- (regla en services/resultado-mensual.ts: rubroDeEquipoPropio). Aditiva e idempotente.
INSERT INTO subcategorias_gastos (nombre, categoria)
SELECT v.nombre, 'GASOLINA_MONTACARGA'
  FROM (VALUES ('Combustible montacarga'), ('Reparación montacarga'), ('Repuestos montacarga'),
               ('Llantas montacarga'), ('Batería montacarga'), ('Aceite / lubricantes montacarga'),
               ('Otros montacarga')) AS v(nombre)
 WHERE NOT EXISTS (SELECT 1 FROM subcategorias_gastos s WHERE lower(btrim(s.nombre)) = lower(btrim(v.nombre)));
-- El rubro reconoce la palabra «montacarga» (y su categoría de Caja) aunque lo hayan renombrado.
UPDATE costo_rubros SET claves = claves || ARRAY['montacarga']
 WHERE 'GASOLINA_MONTACARGA' = ANY (categorias) AND NOT ('montacarga' = ANY (claves));
