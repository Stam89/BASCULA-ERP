-- La materia prima (cáscara) debe estar SIEMPRE en una bodega de materia prima.
-- Antes de la regla automática, la pantalla dejaba elegir la bodega a mano y
-- algunos ingresos quedaron en la Bodega de Producto Terminado, descuadrando el
-- stock (aparecía cáscara donde va el arroz pilado).
--
-- Se mueven esos movimientos a la bodega de materia prima. Solo afecta a
-- productos RAW_MATERIAL que estén en una bodega que no es de materia prima.
UPDATE inventory_movements m
SET warehouse_id = (
  SELECT id FROM warehouses
  WHERE type = 'RAW_MATERIAL' AND is_active = true
  ORDER BY name ASC LIMIT 1
)
FROM products p, warehouses w
WHERE m.product_id = p.id
  AND m.warehouse_id = w.id
  AND p.product_type = 'RAW_MATERIAL'
  AND w.type <> 'RAW_MATERIAL'
  AND EXISTS (SELECT 1 FROM warehouses WHERE type = 'RAW_MATERIAL' AND is_active = true);
