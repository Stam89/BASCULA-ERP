-- Marca si el cuadro de liquidación «Gana» de un lote ya fue compartido por
-- WhatsApp (para pintar la tarjeta de resumen en verde + distintivo). Aditiva.
ALTER TABLE production_yields
  ADD COLUMN IF NOT EXISTS compartido_whatsapp BOOLEAN NOT NULL DEFAULT false;
