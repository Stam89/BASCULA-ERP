-- Clasificación visual de inventario:
-- FINISHED_GOOD queda para arroz base a granel; PACKAGED_GOOD para marcas o
-- presentaciones comerciales empacadas/selectadas.

UPDATE products
SET product_type = 'PACKAGED_GOOD'
WHERE (
    code IN ('ARROZ-PILADO-011-SEL')
    OR upper(name) IN ('CONEJO', 'FLOR', 'LIRA AZUL', 'LIRA VERDE', 'OSO', '0.11 SELECTADO')
    OR upper(code) IN ('CONEJO', 'FLOR', 'LIRA-AZUL', 'LIRA-VERDE', 'OSO')
  );
