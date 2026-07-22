-- Ajuste al catálogo de selección: al selectar, el 0.11 (o corriente) regresa
-- como el MISMO producto, no como uno nuevo "0.11 Selectado". Ese producto
-- sembrado ya no se usa, así que se desactiva para no ensuciar los selectores.
-- El rechazo SÍ se mantiene: es un producto real que ingresa al inventario.
UPDATE products SET is_active = false WHERE code = 'ARROZ-PILADO-011-SEL';
