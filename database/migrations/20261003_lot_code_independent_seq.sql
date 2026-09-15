-- Secuencias de correlativo INDEPENDIENTES por categoría de lote.
--
-- Hasta ahora el correlativo [NNNNN-DD-MM-YY] era GLOBAL: compras y servicios
-- compartían la misma numeración, y algunos lotes de servicio de secado viejos
-- quedaron con el patrón de compra (sin sufijo -S). A partir de ahora cada
-- categoría numera por separado:
--   · Compra / Propio               -> sin sufijo   (00001-…, 00002-…)
--   · Servicio de Secado            -> -S           (00001-…-S, 00002-…-S)
--   · Servicio de Pilada / Completo -> -P           (00001-…-P, 00002-…-P)
--
-- Este backfill renumera los lotes con formato correlativo para que cada
-- categoría (según su operation_type real) tenga su secuencia contigua desde
-- 00001. Cada lote CONSERVA su fecha; solo cambian el número y el sufijo. Se
-- excluye el no-op (AND lot_code <> nuevo) y es idempotente: re-ejecutarlo
-- recalcula exactamente lo mismo. Referencias entre tablas son por lot_id (uuid),
-- así que renombrar lot_code no rompe relaciones.
WITH objetivo AS (
  SELECT id,
         to_char(created_at, 'DD-MM-YY') AS d,
         CASE WHEN upper(COALESCE(operation_type, '')) = 'SECADO' THEN '-S'
              WHEN upper(COALESCE(operation_type, '')) IN ('SECADO_PILADO', 'PILADO') THEN '-P'
              ELSE '' END AS suf,
         row_number() OVER (
           PARTITION BY CASE WHEN upper(COALESCE(operation_type, '')) = 'SECADO' THEN 'S'
                             WHEN upper(COALESCE(operation_type, '')) IN ('SECADO_PILADO', 'PILADO') THEN 'P'
                             ELSE 'C' END
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM lots
  WHERE lot_code ~ '^[0-9]{5}-[0-9]{2}-[0-9]{2}-[0-9]{2}(-[SP])?$'
)
UPDATE lots l
SET lot_code = lpad(o.rn::text, 5, '0') || '-' || o.d || o.suf
FROM objetivo o
WHERE l.id = o.id
  AND l.lot_code <> lpad(o.rn::text, 5, '0') || '-' || o.d || o.suf;
