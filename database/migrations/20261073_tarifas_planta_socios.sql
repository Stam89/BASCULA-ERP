-- Tarifas de PLANTA (combustible y secado como servicio) son una sola: las filas de cada socio guardaban
-- copias viejas (cilindro $2.20, bombona $0.90, secado $1.50) que la pantalla mostraba al estar en un socio.
-- El servidor ya las toma siempre de la fila general (getRates); aquí se alinean las copias (idempotente).
UPDATE labor_rates s
   SET precio_gas_bombona = g.precio_gas_bombona,
       gas_bombona_kg_por_punto = g.gas_bombona_kg_por_punto,
       precio_gas_cilindro = g.precio_gas_cilindro,
       precio_diesel = g.precio_diesel,
       secado_servicio_per_qq = g.secado_servicio_per_qq,
       secado_servicio_saco_per_qq = g.secado_servicio_saco_per_qq
  FROM labor_rates g
 WHERE g.socio_id IS NULL
   AND s.socio_id IS NOT NULL
   AND (s.precio_gas_bombona, s.gas_bombona_kg_por_punto, s.precio_gas_cilindro, s.precio_diesel,
        s.secado_servicio_per_qq, s.secado_servicio_saco_per_qq)
       IS DISTINCT FROM
       (g.precio_gas_bombona, g.gas_bombona_kg_por_punto, g.precio_gas_cilindro, g.precio_diesel,
        g.secado_servicio_per_qq, g.secado_servicio_saco_per_qq);
