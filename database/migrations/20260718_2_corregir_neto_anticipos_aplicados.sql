-- Cuando un anticipo se aplicaba a una cuenta por pagar (vía "aplicar a
-- pendientes"), se bajaba el saldo por pagar pero NO el net_amount de la
-- liquidación. Resultado: el comprobante mostraba el neto sin restar el
-- anticipo, aunque la deuda real (saldo por pagar) sí estaba bien.
--
-- El código ya quedó arreglado; esto corrige las liquidaciones que quedaron
-- con el neto inflado. Se recalcula el descuento por anticipos y el neto a
-- partir de lo que realmente se aplicó (advance_applications), sin tocar el
-- saldo por pagar, que ya era correcto.
WITH aplicado AS (
  SELECT aa.liquidation_id, SUM(aa.amount_applied) AS total_anticipos
  FROM advance_applications aa
  GROUP BY aa.liquidation_id
)
UPDATE liquidations l
SET advances_discount = ap.total_anticipos,
    net_amount = GREATEST(0, l.gross_amount - ap.total_anticipos - l.other_discounts)
FROM aplicado ap
WHERE ap.liquidation_id = l.id
  -- Solo las que quedaron inconsistentes: neto aún sin restar el anticipo.
  AND l.advances_discount < ap.total_anticipos;
