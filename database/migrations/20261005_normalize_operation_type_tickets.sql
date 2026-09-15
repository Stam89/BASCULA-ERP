-- Normaliza el tipo de operación LEGADO de los ingresos de báscula.
--
-- La columna weighing_tickets.operation_type traía el DEFAULT antiguo 'RECEPTION'
-- (concepto de una versión previa, sin código que lo use hoy). Los ingresos
-- viejos quedaron con ese valor, que no corresponde a ninguno de los 4 tipos de
-- negocio (COMPRA / SECADO / SECADO_PILADO / PILADO) y por eso salían en Secadoras
-- con la etiqueta genérica "SERVICIO".
--
-- Reclasificación (misma convención que el resto del sistema: un ingreso de
-- maquila sin tipo explícito es Servicio Completo, que SÍ pasa por secado):
--   · RECEPTION + compra propia (is_maquila=false) → COMPRA
--   · RECEPTION + servicio (is_maquila=true)       → SECADO_PILADO (Servicio Completo)
-- NO se marca ninguno como PILADO: los "Solo Servicio de Pilada" reales ya se
-- registran con operation_type='PILADO' y con lote formado (lot_id no nulo), así
-- que ya se excluyen del selector de Secadoras. Marcar un legado ambiguo como
-- PILADO ocultaría por error ingresos que sí necesitan secado.
UPDATE weighing_tickets SET operation_type = 'COMPRA'
 WHERE operation_type = 'RECEPTION' AND is_maquila = false;

UPDATE weighing_tickets SET operation_type = 'SECADO_PILADO'
 WHERE operation_type = 'RECEPTION' AND is_maquila = true;

-- Cualquier otro valor fuera de los 4 tipos se normaliza según is_maquila
-- (defensa ante datos sueltos de importaciones antiguas).
UPDATE weighing_tickets SET operation_type = CASE WHEN is_maquila THEN 'SECADO_PILADO' ELSE 'COMPRA' END
 WHERE operation_type IS NULL
    OR operation_type NOT IN ('COMPRA', 'SECADO', 'SECADO_PILADO', 'PILADO');

-- El DEFAULT de la columna pasa de 'RECEPTION' a 'COMPRA' (coherente con lots y
-- con la migración 20261001). Los flujos actuales ya fijan operation_type
-- explícitamente; esto solo evita que reaparezca 'RECEPTION' por defecto.
ALTER TABLE weighing_tickets ALTER COLUMN operation_type SET DEFAULT 'COMPRA';
