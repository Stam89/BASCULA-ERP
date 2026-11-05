-- Proceso guardado también para los lotes sin secado (saldo inicial, solo pilada): el lote que quedó a medias por tulas
-- sin pesar se guarda igual que un túnel. Cada borrador es de un túnel o de un lote.
ALTER TABLE milling_drafts ALTER COLUMN drying_report_id DROP NOT NULL;
ALTER TABLE milling_drafts ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES lots(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS milling_drafts_lote_unico ON milling_drafts (lot_id) WHERE lot_id IS NOT NULL;
