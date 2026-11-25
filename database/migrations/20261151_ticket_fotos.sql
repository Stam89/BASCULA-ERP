-- 📷 Fotos del camión tomadas con la tablet (opcionales, pedido del dueño 2026-11-25). El archivo vive fuera de la base.
CREATE TABLE IF NOT EXISTS ticket_fotos (
  id               UUID PRIMARY KEY,
  mobile_ticket_id UUID NOT NULL REFERENCES mobile_synced_tickets(id) ON DELETE CASCADE,
  device_id        TEXT,
  archivo          TEXT NOT NULL,
  bytes            INTEGER NOT NULL,
  tomada_en        TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_fotos_ticket ON ticket_fotos (mobile_ticket_id);
