-- 📦 Empacado por presentación (pedido del dueño 2026-10-29): los bultos YA LLENOS de cada marca
-- (Flor, Oso…) se llevan por peso del saco (25 lb, 10 lb…). Cada movimiento de inventario guarda
-- el peso del saco; los QQ siguen siendo la unidad (bultos = QQ × 100 / peso). NULL = sin presentación.
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS sack_weight_lb numeric(8,2);

-- Saldos iniciales de marcas ya cargados con su presentación en el detalle («700 bultos de 25 lb …»).
UPDATE inventory_movements m
   SET sack_weight_lb = substring(m.notes FROM 'bultos de ([0-9]+(?:\.[0-9]+)?) lb')::numeric
  FROM products p
 WHERE p.id = m.product_id
   AND p.product_type = 'PACKAGED_GOOD'
   AND m.reference_type = 'saldo_inicial'
   AND m.sack_weight_lb IS NULL
   AND m.notes ~ 'bultos de [0-9]+(\.[0-9]+)? lb';

-- Sus anulaciones llevan el mismo peso que el ingreso que anulan.
UPDATE inventory_movements a
   SET sack_weight_lb = o.sack_weight_lb
  FROM inventory_movements o
 WHERE a.reference_type = 'saldo_inicial_anulado'
   AND o.reference_type = 'saldo_inicial'
   AND o.reference_id = a.reference_id
   AND o.product_id = a.product_id
   AND o.sack_weight_lb IS NOT NULL
   AND a.sack_weight_lb IS NULL;
