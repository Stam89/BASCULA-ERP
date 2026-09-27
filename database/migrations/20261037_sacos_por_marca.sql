-- INVENTARIO DE SACOS POR MARCA Y PESO (aditiva e idempotente).
--
-- Regla nueva: los sacos se descuentan al VENDER (Confirmar Preparación del
-- pedido), por la marca y la presentación vendidas, y ya no al pilar. En un
-- Servicio de Pilada el operador puede elegir sacos de la planta y se cobran al
-- cliente. Cada saco tiene un stock mínimo (manual) para alertar en el Dashboard.
--
-- Nada existente se borra: los tipos antiguos ("Saco 100 LB", "Saco Negro
-- (Polvillo)"...) se conservan con su stock y su kárdex y quedan clasificados.

ALTER TABLE sack_inventory ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'MARCA';
ALTER TABLE sack_inventory ADD COLUMN IF NOT EXISTS marca TEXT;
ALTER TABLE sack_inventory ADD COLUMN IF NOT EXISTS calidad TEXT;
ALTER TABLE sack_inventory ADD COLUMN IF NOT EXISTS peso_lb NUMERIC(8,2);
ALTER TABLE sack_inventory ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE sack_inventory ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(10,0) NOT NULL DEFAULT 0;
ALTER TABLE sack_inventory ADD COLUMN IF NOT EXISTS precio_venta_cliente NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE sack_inventory ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;

-- Kárdex: enlace al pedido que consumió los sacos (para devolverlos si se
-- revierte la preparación o se anula el pedido).
ALTER TABLE sack_movements ADD COLUMN IF NOT EXISTS ref_order UUID REFERENCES sales_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sack_movements_ref_order ON sack_movements(ref_order) WHERE ref_order IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sack_movements_ref_batch ON sack_movements(ref_batch) WHERE ref_batch IS NOT NULL;

-- Clasificación de los tipos que ya existían (solo si aún no tienen marca).
UPDATE sack_inventory
   SET categoria = 'SUBPRODUCTO'
 WHERE marca IS NULL AND product_id IS NULL
   AND (tipo ILIKE '%polvillo%' OR tipo ILIKE '%arrocillo%');

UPDATE sack_inventory
   SET categoria = 'GENERICO',
       peso_lb = COALESCE(peso_lb, substring(tipo FROM '([0-9]+(?:\.[0-9]+)?)\s*LB')::numeric)
 WHERE marca IS NULL AND product_id IS NULL AND categoria = 'MARCA'
   AND tipo ~* '^saco\s+[0-9]+(\.[0-9]+)?\s*lb$';

-- Precio al cliente de servicio: arranca igual al precio de compra (editable).
UPDATE sack_inventory
   SET precio_venta_cliente = precio_compra_default
 WHERE precio_venta_cliente = 0 AND COALESCE(precio_compra_default, 0) > 0;

-- Un solo saco por marca + peso.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sack_inventory_marca_peso
  ON sack_inventory(product_id, peso_lb) WHERE product_id IS NOT NULL;

-- Marca EXTRA (0.11): se crea como producto empacado si aún no existe, con sus
-- presentaciones, para poder venderla y llevar sus sacos.
INSERT INTO products (code, name, product_type, unit, is_active)
SELECT 'ARROZ-EXTRA', 'Extra', 'PACKAGED_GOOD', 'QQ', true
WHERE NOT EXISTS (
  SELECT 1 FROM products WHERE upper(code) = 'ARROZ-EXTRA' OR upper(name) = 'EXTRA'
);

INSERT INTO product_presentations (product_id, name, weight_lb)
SELECT p.id, w.peso::int || 'lb', w.peso
FROM products p
CROSS JOIN (VALUES (100::numeric), (50), (25), (10)) AS w(peso)
WHERE upper(p.code) = 'ARROZ-EXTRA'
  AND NOT EXISTS (
    SELECT 1 FROM product_presentations pp WHERE pp.product_id = p.id AND pp.weight_lb = w.peso
  );

-- Catálogo inicial: Flor, Oso, Extra, Lira Azul (0.11) y Conejo (Corriente) en
-- 100 / 50 / 25 / 10 LB. Stock 0: se carga con la compra de sacos en Caja.
INSERT INTO sack_inventory (tipo, stock, categoria, marca, calidad, peso_lb, product_id)
SELECT m.nombre || ' ' || w.peso::int || ' LB', 0, 'MARCA', m.nombre, m.calidad, w.peso, p.id
FROM (VALUES
        ('ARROZ-FLOR', 'Flor', '0.11'),
        ('ARROZ-OSO', 'Oso', '0.11'),
        ('ARROZ-EXTRA', 'Extra', '0.11'),
        ('ARROZ-LIRA-AZUL', 'Lira Azul', '0.11'),
        ('ARROZ-CONEJO', 'Conejo', 'CORRIENTE')
     ) AS m(code, nombre, calidad)
JOIN products p ON upper(p.code) = m.code
CROSS JOIN (VALUES (100::numeric), (50), (25), (10)) AS w(peso)
WHERE NOT EXISTS (
  SELECT 1 FROM sack_inventory s WHERE s.product_id = p.id AND s.peso_lb = w.peso
);
