-- 📦 Pilar VARIOS lotes desde Stock (pedido del dueño 2026-10-29): un lote guardado sin secado (cáscara seca del saldo
-- inicial) también se enlaza a la pilada en processing_batch_drying_lots, con drying_report_id NULL. Idempotente.
ALTER TABLE processing_batch_drying_lots ALTER COLUMN drying_report_id DROP NOT NULL;
