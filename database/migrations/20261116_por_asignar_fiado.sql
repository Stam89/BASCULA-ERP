-- 📝 VENTA DETALLE «DECIDIR DESPUÉS» FIADA (pedido del dueño 2026-10-22): a conocidos se les fía aunque todavía no se sepa
-- de quién es el arroz. `pagado` = lo que pagó al comprar (NULL = pagó todo, como antes). Si pagó algo, ese ingreso
-- está en la caja; si no pagó nada, no hay ingreso (cash_movement_id NULL). Al asignar nace la venta A CRÉDITO del
-- dueño y lo pagado se abona a esa cuenta. Aditiva e idempotente.
ALTER TABLE ventas_detalle_por_asignar ADD COLUMN IF NOT EXISTS pagado NUMERIC(14,2) CHECK (pagado IS NULL OR pagado >= 0);
