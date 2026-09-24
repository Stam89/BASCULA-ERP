-- Concilia Partes Diarios historicos con liquidaciones que ya descontaron
-- cosechadora antes de existir liquidation_harvest_details.
-- Solo enlaza coincidencias 1 a 1; los casos ambiguos quedan intactos.

WITH candidatos AS (
  SELECT p.id AS campo_parte_id,
         p.activo_id,
         p.qq,
         a.nombre AS activo_nombre,
         l.id AS liquidation_id,
         COALESCE((l.discount_breakdown->>'cosechadora')::numeric, 0) AS amount,
         COUNT(*) OVER (PARTITION BY p.id) AS liquidaciones_posibles,
         COUNT(*) OVER (PARTITION BY l.id) AS partes_posibles
    FROM campo_partes p
    JOIN campo_activos a ON a.id = p.activo_id AND a.tipo = 'cosechadora'
    JOIN liquidations l
      ON l.farmer_id = p.farmer_id
     AND l.status <> 'CANCELLED'
     AND COALESCE((l.discount_breakdown->>'cosechadora')::numeric, 0) > 0
     AND p.fecha BETWEEN l.created_at::date - 7 AND l.created_at::date + 7
   WHERE p.farmer_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM liquidation_harvest_details d WHERE d.campo_parte_id = p.id
     )
), unicos AS (
  SELECT *
    FROM candidatos
   WHERE liquidaciones_posibles = 1
     AND partes_posibles = 1
     AND qq > 0
)
INSERT INTO liquidation_harvest_details
  (liquidation_id, campo_parte_id, activo_id, provider_type, provider_name,
   quintals, price_per_quintal, amount)
SELECT liquidation_id, campo_parte_id, activo_id,
       CASE WHEN EXISTS (
         SELECT 1 FROM accounts_payable ap
          WHERE ap.liquidation_id = unicos.liquidation_id
            AND ap.reference_type = 'cosechadora_tercero'
       ) THEN 'tercero' ELSE 'propia' END,
       activo_nombre,
       qq,
       round(amount / qq, 4),
       amount
  FROM unicos
ON CONFLICT (campo_parte_id) WHERE campo_parte_id IS NOT NULL DO NOTHING;

-- DOWN manual:
--   DELETE FROM liquidation_harvest_details
--    WHERE campo_parte_id IS NOT NULL
--      AND created_at >= (SELECT applied_at FROM schema_migrations
--                          WHERE filename = '20261030_backfill_partes_liquidacion_cosechadora.sql');
--   DELETE FROM schema_migrations WHERE filename = '20261030_backfill_partes_liquidacion_cosechadora.sql';
