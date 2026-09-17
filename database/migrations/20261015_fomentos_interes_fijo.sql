-- "Saldos en contra": permite congelar/fijar el interés de un fomento en lugar
-- de que corra diariamente. Aditiva y sin backfill: todos los fomentos existentes
-- quedan en 'DINAMICO' (comportamiento actual EXACTO, CERO RUPTURAS).
--   modo_interes:  DINAMICO   -> interés por días (fórmula histórica)
--                  FIJO_1_MES -> 1 mes de interés sobre el saldo deudor, congelado
--                  MANUAL     -> monto exacto escrito por el administrador
--   interes_fijo_monto: valor congelado usado cuando el modo NO es DINAMICO.
ALTER TABLE fomentos ADD COLUMN IF NOT EXISTS modo_interes text NOT NULL DEFAULT 'DINAMICO';
ALTER TABLE fomentos ADD COLUMN IF NOT EXISTS interes_fijo_monto numeric(14,2);

-- Restringe el enum a valores válidos (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fomentos_modo_interes_chk'
  ) THEN
    ALTER TABLE fomentos
      ADD CONSTRAINT fomentos_modo_interes_chk
      CHECK (modo_interes IN ('DINAMICO', 'FIJO_1_MES', 'MANUAL'));
  END IF;
END $$;
