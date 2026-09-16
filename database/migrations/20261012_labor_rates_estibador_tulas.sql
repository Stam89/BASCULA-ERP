-- Columnas de nómina que antes se creaban de forma perezosa (ensureLaborTables)
-- DENTRO de la transacción de finish-production, provocando un deadlock a nivel
-- de app (el ALTER en el pool esperaba locks que la transacción del cierre
-- sostenía, y Node esperaba al ALTER). Se materializan aquí y ensureLaborTables
-- se precarga al arranque, así el DDL nunca corre dentro de una petición.
ALTER TABLE labor_rates    ADD COLUMN IF NOT EXISTS estibador_por_3tulas   NUMERIC(10,4) NOT NULL DEFAULT 5;
ALTER TABLE labor_rates    ADD COLUMN IF NOT EXISTS secado_servicio_per_qq NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE worker_payments ADD COLUMN IF NOT EXISTS tulas NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE worker_payments ADD COLUMN IF NOT EXISTS notes TEXT;
