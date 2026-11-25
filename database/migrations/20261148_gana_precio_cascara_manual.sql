-- 🏆 Gana: precio de compra de la cáscara escrito a mano mientras esa partida no está liquidada (pedido del dueño 2026-11-24).
-- Es solo para el cuadro: no toca liquidaciones, cuentas ni inventario. Con la liquidación hecha vale el precio liquidado.
ALTER TABLE processing_batch_drying_lots ADD COLUMN IF NOT EXISTS precio_cascara_manual NUMERIC(12,4);
-- Pilada sin partidas enlazadas (un solo lote de Stock): un precio para toda su cáscara.
ALTER TABLE production_yields ADD COLUMN IF NOT EXISTS precio_cascara_manual NUMERIC(12,4);
