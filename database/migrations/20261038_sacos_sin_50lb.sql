-- La planta NO tiene sacos de 50 LB: un pedido en presentación de 50 LB se
-- empaca en sacos de 100 LB (1 bulto = 1 saco). Se retiran del catálogo los
-- sacos de marca de 50 LB. La presentación "50lb" de venta NO se toca.
-- Idempotente: borra solo los que nunca tuvieron stock ni movimientos; si
-- alguno tuviera historial, solo se desactiva (conserva su kárdex).
DELETE FROM sack_inventory si
 WHERE si.peso_lb = 50
   AND si.categoria = 'MARCA'
   AND si.stock = 0
   AND NOT EXISTS (SELECT 1 FROM sack_movements m WHERE m.sack_id = si.id);

UPDATE sack_inventory
   SET activo = false, updated_at = now()
 WHERE peso_lb = 50 AND categoria = 'MARCA' AND activo;
