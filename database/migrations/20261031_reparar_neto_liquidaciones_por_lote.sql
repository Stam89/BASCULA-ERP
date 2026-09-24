-- Repara comprobantes de liquidacion donde todos los descuentos del lote se
-- cargaron a la primera fila y el excedente se perdio al limitar su neto a 0.
-- Seguridad: solo toca lotes confirmados, sin anticipos, con descuentos menores
-- o iguales al bruto y sin pagos realizados sobre sus CxP principales.

CREATE TEMP TABLE liquidaciones_neto_reparacion ON COMMIT DROP AS
WITH totales AS (
  SELECT batch_id,
         SUM(gross_amount) AS bruto,
         SUM(other_discounts) AS descuentos,
         SUM(net_amount) AS neto_guardado,
         SUM(advances_discount) AS anticipos,
         BOOL_AND(status = 'CONFIRMED') AS confirmadas
    FROM liquidations
   WHERE batch_id IS NOT NULL
   GROUP BY batch_id
), elegibles AS (
  SELECT t.*
    FROM totales t
   WHERE t.confirmadas
     AND t.anticipos = 0
     AND t.descuentos <= t.bruto
     AND ABS((t.bruto - t.descuentos) - t.neto_guardado) > 0.01
     AND NOT EXISTS (
       SELECT 1
         FROM liquidations l
         JOIN accounts_payable ap
           ON ap.liquidation_id = l.id
          AND ap.reference_type IS NULL
         JOIN payments_made pm ON pm.payable_id = ap.id
        WHERE l.batch_id = t.batch_id
     )
), ordenadas AS (
  SELECT l.id,
         l.batch_id,
         l.gross_amount,
         e.descuentos,
         COALESCE(
           SUM(l.gross_amount) OVER (
             PARTITION BY l.batch_id
             ORDER BY l.created_at, l.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ),
           0
         ) AS bruto_anterior
    FROM liquidations l
    JOIN elegibles e ON e.batch_id = l.batch_id
)
SELECT id,
       LEAST(gross_amount, GREATEST(0, descuentos - bruto_anterior))::numeric(14,2) AS descuento_corregido,
       GREATEST(0, gross_amount - LEAST(gross_amount, GREATEST(0, descuentos - bruto_anterior)))::numeric(14,2) AS neto_corregido
  FROM ordenadas;

UPDATE liquidations l
   SET other_discounts = r.descuento_corregido,
       net_amount = r.neto_corregido
  FROM liquidaciones_neto_reparacion r
 WHERE l.id = r.id;

-- Las CxP auxiliares (flete/cosechadora) no se tocan; solo la cuenta principal
-- asociada al neto que se paga al agricultor.
DELETE FROM accounts_payable ap
 USING liquidaciones_neto_reparacion r
 WHERE ap.liquidation_id = r.id
   AND ap.reference_type IS NULL
   AND r.neto_corregido = 0;

UPDATE accounts_payable ap
   SET amount = r.neto_corregido,
       balance = r.neto_corregido,
       status = 'CONFIRMED'
  FROM liquidaciones_neto_reparacion r
 WHERE ap.liquidation_id = r.id
   AND ap.reference_type IS NULL
   AND r.neto_corregido > 0;

INSERT INTO accounts_payable
  (farmer_id, liquidation_id, amount, balance, status, accionista_id)
SELECT l.farmer_id, l.id, r.neto_corregido, r.neto_corregido, 'CONFIRMED', l.accionista_id
  FROM liquidaciones_neto_reparacion r
  JOIN liquidations l ON l.id = r.id
 WHERE r.neto_corregido > 0
   AND NOT EXISTS (
     SELECT 1
       FROM accounts_payable ap
      WHERE ap.liquidation_id = l.id
        AND ap.reference_type IS NULL
   );

