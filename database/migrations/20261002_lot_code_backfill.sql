-- Backfill: unifica el código de los lotes de SERVICIO creados con el formato
-- antiguo 'LT-TIMESTAMP-RANDOM' al formato correlativo de planta
-- [NNNNN-DD-MM-YY] con sufijo según el tipo de servicio:
--   · SECADO (Solo Servicio de Secado)              -> -S
--   · SECADO_PILADO / PILADO (completo / solo pila) -> -P
-- Solo afecta lotes de servicio (is_maquila o operation_type <> 'COMPRA'); los
-- lotes de compra propia se dejan intactos. El correlativo continúa la
-- numeración GLOBAL (arranca en MAX(secuencial actual) + 1), así que no colisiona
-- con los códigos ya existentes ni entre sí. Idempotente: tras correr una vez ya
-- no quedan lotes de servicio con prefijo 'LT-', y volver a ejecutarlo no hace nada.
WITH base AS (
  SELECT COALESCE(MAX((substring(lot_code FROM '^[0-9]{5}'))::int), 0) AS maxseq
  FROM lots
  WHERE lot_code ~ '^[0-9]{5}-[0-9]{2}-[0-9]{2}-[0-9]{2}(-[SP])?$'
),
viejos AS (
  SELECT l.id,
         l.created_at,
         CASE WHEN upper(COALESCE(l.operation_type, '')) = 'SECADO' THEN '-S' ELSE '-P' END AS suf,
         row_number() OVER (ORDER BY l.created_at ASC, l.id ASC) AS rn
  FROM lots l
  WHERE l.lot_code ~ '^LT-'
    AND (l.is_maquila = true OR upper(COALESCE(l.operation_type, '')) <> 'COMPRA')
)
UPDATE lots l
SET lot_code = lpad(((SELECT maxseq FROM base) + v.rn)::text, 5, '0')
             || '-' || to_char(v.created_at, 'DD-MM-YY')
             || v.suf
FROM viejos v
WHERE l.id = v.id;
