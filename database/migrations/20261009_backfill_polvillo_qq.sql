-- Backfill de la CANTIDAD (qq) de los pagos de POLVILLO en worker_payments.
--
-- Bug: al registrar el pago del Polvillo, la columna `qq` quedaba en 0 (el valor
-- real de quintales se guardaba solo en el JSON `detail.polvillo` y en el monto
-- base = qq × tarifa). Por eso el "Rol de Pago" mostraba "0.00 QQ" para el
-- trabajador (ej. ROBERTO) aunque el subtotal fuera $3.75 con tarifa $0.25/QQ.
--
-- Este script corrige los registros existentes copiando `detail.polvillo` a `qq`.
-- Solo toca filas POLVILLO con qq = 0 y un valor de polvillo > 0 en el detalle.
-- Idempotente: al correr de nuevo, ya no hay filas que cumplan la condición.

UPDATE worker_payments
   SET qq = (detail->>'polvillo')::numeric
 WHERE worker_role = 'POLVILLO'
   AND COALESCE(qq, 0) = 0
   AND detail ? 'polvillo'
   AND (detail->>'polvillo') ~ '^[0-9]+(\.[0-9]+)?$'
   AND (detail->>'polvillo')::numeric > 0;
