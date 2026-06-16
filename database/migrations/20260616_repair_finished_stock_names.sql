WITH target_products AS (
  SELECT
    (SELECT id FROM products WHERE code = 'ARROZ-PILADO-011') AS producto_011_id,
    (SELECT id FROM products WHERE code = 'ARROZ-PILADO-CORRIENTE') AS producto_corriente_id
)
UPDATE inventory_movements m
SET product_id = CASE
  WHEN l.rice_type = 'CORRIENTE' THEN tp.producto_corriente_id
  ELSE tp.producto_011_id
END
FROM lots l, products p, target_products tp
WHERE m.lot_id = l.id
  AND m.product_id = p.id
  AND p.code IN ('ARROZ-BLANCO', 'ARROZ-PILADO', 'ARROZ-PILADO-SACO')
  AND CASE
    WHEN l.rice_type = 'CORRIENTE' THEN tp.producto_corriente_id
    ELSE tp.producto_011_id
  END IS NOT NULL;

WITH target_products AS (
  SELECT
    (SELECT id FROM products WHERE code = 'ARROZ-PILADO-011') AS producto_011_id,
    (SELECT id FROM products WHERE code = 'ARROZ-PILADO-CORRIENTE') AS producto_corriente_id
)
UPDATE processing_outputs po
SET product_id = CASE
  WHEN l.rice_type = 'CORRIENTE' THEN tp.producto_corriente_id
  ELSE tp.producto_011_id
END
FROM processing_batches b, lots l, products p, target_products tp
WHERE po.processing_batch_id = b.id
  AND b.lot_id = l.id
  AND po.product_id = p.id
  AND p.code IN ('ARROZ-BLANCO', 'ARROZ-PILADO', 'ARROZ-PILADO-SACO')
  AND CASE
    WHEN l.rice_type = 'CORRIENTE' THEN tp.producto_corriente_id
    ELSE tp.producto_011_id
  END IS NOT NULL;
