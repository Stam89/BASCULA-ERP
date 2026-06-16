WITH target_products AS (
  SELECT
    (SELECT id FROM products WHERE code = 'CASCARA-011') AS cascara_011_id,
    (SELECT id FROM products WHERE code = 'CASCARA-CORRIENTE') AS cascara_corriente_id
)
UPDATE inventory_movements m
SET product_id = CASE
  WHEN l.rice_type = 'CORRIENTE' THEN tp.cascara_corriente_id
  ELSE tp.cascara_011_id
END
FROM lots l, products p, target_products tp
WHERE m.lot_id = l.id
  AND m.product_id = p.id
  AND p.code = 'ARROZ-CASCARA'
  AND CASE
    WHEN l.rice_type = 'CORRIENTE' THEN tp.cascara_corriente_id
    ELSE tp.cascara_011_id
  END IS NOT NULL;

UPDATE inventory_movements m
SET quantity = -t.quintals
FROM weighing_tickets t, products p
WHERE m.lot_id = t.lot_id
  AND m.product_id = p.id
  AND p.product_type = 'RAW_MATERIAL'
  AND m.movement = 'PROCESS_INPUT'
  AND ABS(m.quantity) > ABS(t.quintals) * 10;

WITH ranked_inputs AS (
  SELECT
    m.id,
    m.product_id,
    m.warehouse_id,
    m.lot_id,
    m.quantity,
    m.ownership,
    m.created_by,
    ROW_NUMBER() OVER (
      PARTITION BY m.lot_id, m.product_id, m.warehouse_id, m.ownership
      ORDER BY m.created_at ASC, m.id ASC
    ) AS input_order
  FROM inventory_movements m
  JOIN products p ON p.id = m.product_id
  WHERE m.movement = 'PROCESS_INPUT'
    AND p.product_type = 'RAW_MATERIAL'
)
INSERT INTO inventory_movements
  (product_id, warehouse_id, lot_id, movement, quantity, reference_type, reference_id, ownership, notes, created_by)
SELECT
  r.product_id,
  r.warehouse_id,
  r.lot_id,
  'REVERSAL',
  -r.quantity,
  'stock_repair',
  r.id,
  r.ownership,
  'Reverso automatico de consumo duplicado de cascara',
  r.created_by
FROM ranked_inputs r
WHERE r.input_order > 1
  AND NOT EXISTS (
    SELECT 1
    FROM inventory_movements existing
    WHERE existing.reference_type = 'stock_repair'
      AND existing.reference_id = r.id
  );
