-- Llenado de polvillo: se paga $0.25 por QQ al encargado de llenar polvillo.
ALTER TABLE processing_batches ADD COLUMN IF NOT EXISTS polvillo_worker_name VARCHAR(140);

ALTER TABLE labor_rates ADD COLUMN IF NOT EXISTS polvillo_per_qq NUMERIC(10,4) NOT NULL DEFAULT 0.25;

UPDATE labor_rates SET polvillo_per_qq = 0.25 WHERE id = 1;
