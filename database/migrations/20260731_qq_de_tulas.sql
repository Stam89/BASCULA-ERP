-- QQ totales de las tulas en producción (base INDEPENDIENTE para pagar al pilador).
ALTER TABLE production_yields ADD COLUMN IF NOT EXISTS qq_de_tulas NUMERIC(14,3) NOT NULL DEFAULT 0;
