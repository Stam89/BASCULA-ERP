-- Regla aclarada de "Saldos en contra": el interés FIJO aplica por FILA, sólo al
-- registro del saldo arrastrado de la cosecha anterior (N meses de penalidad),
-- mientras que los desembolsos normales siguen corriendo por días.
-- Aditiva: las entregas existentes quedan es_saldo_anterior=false (interés diario
-- normal, comportamiento EXACTO actual → CERO RUPTURAS).
ALTER TABLE fomento_entregas ADD COLUMN IF NOT EXISTS es_saldo_anterior boolean NOT NULL DEFAULT false;
ALTER TABLE fomento_entregas ADD COLUMN IF NOT EXISTS meses_interes_fijo integer;
