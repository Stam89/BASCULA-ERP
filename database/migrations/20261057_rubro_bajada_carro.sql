-- Resultado mensual: «🚚 Bajada de carro» pasa a ser su propio tipo de pago de
-- nómina (BAJADA_CARRO). Hasta hoy contaba dentro de CUADRILLA, así que se enlaza
-- al mismo rubro que ya tiene CUADRILLA para que el reporte no cambie y el enlace
-- se vea en «Mapeo de rubros». Idempotente: solo si ningún rubro la tiene aún.
UPDATE costo_rubros
   SET nomina = array_append(nomina, 'BAJADA_CARRO')
 WHERE id = (SELECT id FROM costo_rubros WHERE 'CUADRILLA' = ANY (nomina) ORDER BY activo DESC, orden LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM costo_rubros WHERE 'BAJADA_CARRO' = ANY (nomina));
